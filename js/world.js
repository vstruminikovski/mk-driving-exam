'use strict';
/* =========================================================================
   WORLD — road graph, lanes, connectors, crosswalks, lights, city layout
   ========================================================================= */

const World = (() => {
  const LW = CFG.LANE_W, SW = CFG.SIDEWALK_W, R = CFG.ROUND;
  const ARMV = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
  const ARM_ANG = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
  const ROT = ['W', 'S', 'E', 'N']; // counter-clockwise order on screen (right-hand traffic)
  const armOf = v => (Math.abs(v.x) > Math.abs(v.y) ? (v.x > 0 ? 'E' : 'W') : (v.y > 0 ? 'S' : 'N'));

  const NODE_DEF = {
    n00: { t: 'bend' }, n30: { t: 'bend' }, n03: { t: 'bend' }, n33: { t: 'bend' },
    n10: { t: 'prio', major: 'h' }, n20: { t: 'prio', major: 'h' },
    n13: { t: 'prio', major: 'h' }, n23: { t: 'prio', major: 'h' },
    n01: { t: 'prio', major: 'v' }, n31: { t: 'prio', major: 'v' },
    n02: { t: 'prio', major: 'v' }, n32: { t: 'prio', major: 'v' },
    n11: { t: 'light', offset: 0 }, n21: { t: 'light', offset: 17 },
    n12: { t: 'prio', major: 'h', stop: true },
    n22: { t: 'round' },
  };

  const W = {
    nodes: {}, nodeList: [], edges: [], edgeMap: {}, lanes: [], edgeDirs: {}, conns: [],
    crosswalks: [], blocks: [], statics: [], solids: [], trees: [], signs: [], lightPoles: [],
    outerBuildings: [], decorCars: [], bay: null, van: null,
    ARMV, ROT, armOf,
    bounds: null,
  };

  /* ---------------- lights ---------------- */
  const PH = [['G', 'R'], ['Y', 'R'], ['R', 'R'], ['R', 'G'], ['R', 'Y'], ['R', 'R']];
  const PH_DUR = [CFG.LIGHT.green, CFG.LIGHT.yellow, CFG.LIGHT.allRed, CFG.LIGHT.green, CFG.LIGHT.yellow, CFG.LIGHT.allRed];
  const CYCLE = PH_DUR.reduce((a, b) => a + b, 0);
  function lightPhase(node) {
    let t = ((node.light.t % CYCLE) + CYCLE) % CYCLE;
    for (let i = 0; i < 6; i++) {
      if (t < PH_DUR[i]) return { i, rem: PH_DUR[i] - t, el: t };
      t -= PH_DUR[i];
    }
    return { i: 0, rem: PH_DUR[0], el: 0 };
  }
  W.lightState = (node, axis) => PH[lightPhase(node).i][axis === 'h' ? 0 : 1];
  W.lightPhase = lightPhase;
  // time remaining until this axis stops being green (0 if not green)
  W.greenRemaining = (node, axis) => {
    const p = lightPhase(node);
    return PH[p.i][axis === 'h' ? 0 : 1] === 'G' ? p.rem : 0;
  };
  // seconds since yellow began on axis (or -1)
  W.yellowElapsed = (node, axis) => {
    const p = lightPhase(node);
    return PH[p.i][axis === 'h' ? 0 : 1] === 'Y' ? p.el : -1;
  };
  W.setLightPhase = (node, phaseIdx, elapsed = 0) => {
    let t = 0;
    for (let i = 0; i < phaseIdx; i++) t += PH_DUR[i];
    node.light.t = t + elapsed;
  };
  W.pedGreen = cw => {
    if (!cw.signal) return 0;
    const p = lightPhase(cw.signal);
    const roadAxis = cw.edge.axis;
    const st = PH[p.i];
    const roadState = st[roadAxis === 'h' ? 0 : 1], otherState = st[roadAxis === 'h' ? 1 : 0];
    return roadState === 'R' && otherState === 'G' ? p.rem : 0;
  };

  /* ---------------- construction ---------------- */
  function addEdge(a, b, axis, n, limit) {
    const e = { id: a.id + '-' + b.id, a, b, axis, n, hw: n * LW, limit, bay: null, idx: W.edges.length };
    if (axis === 'h') { a.arms.E = e; b.arms.W = e; } else { a.arms.S = e; b.arms.N = e; }
    W.edges.push(e);
    W.edgeMap[e.id] = e;
    return e;
  }

  function turnType(dIn, dOut) {
    const dot = dIn.x * dOut.x + dIn.y * dOut.y;
    if (dot > 0.5) return 'straight';
    const cross = dIn.x * dOut.y - dIn.y * dOut.x;
    return cross > 0 ? 'right' : 'left';
  }
  W.turnType = turnType;

  function laneControl(lane) {
    const n = lane.to;
    if (n.type === 'light') return 'light';
    if (n.type === 'round') return 'round';
    if (n.type === 'bend') return 'none';
    const isMajor = (n.major === 'h') === (lane.edge.axis === 'h');
    return isMajor ? 'major' : (n.stop ? 'stop' : 'yield');
  }

  function addCrosswalk(edge, along, signal) {
    const cx = edge.a.x + edge.d.x * along, cy = edge.a.y + edge.d.y * along;
    const a = edge.axis === 'h' ? 0 : Math.PI / 2;
    const cw = {
      id: W.crosswalks.length, edge, along, x: cx, y: cy, a, hw: edge.hw, signal: signal || null,
      obb: { x: cx, y: cy, a, hl: CFG.CW_W / 2, hw: edge.hw }, lastSpawn: -99,
    };
    W.crosswalks.push(cw);
    for (const lane of W.lanes) {
      if (lane.edge !== edge) continue;
      const sc = (cx - lane.start.x) * lane.d.x + (cy - lane.start.y) * lane.d.y;
      lane.cws.push({ cw, s0: sc - CFG.CW_W / 2, s1: sc + CFG.CW_W / 2 });
      lane.cws.sort((p, q) => p.s0 - q.s0);
    }
    return cw;
  }

  function build() {
    const { XS, YS } = CFG;
    // nodes
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const id = 'n' + c + r, def = NODE_DEF[id];
      const n = { id, c, r, x: XS[c], y: YS[r], type: def.t, major: def.major || null, stop: !!def.stop, arms: {}, hx: 3.5, hy: 3.5, light: null };
      if (def.t === 'light') n.light = { t: def.offset, offset: def.offset };
      W.nodes[id] = n; W.nodeList.push(n);
    }
    const N = (c, r) => W.nodes['n' + c + r];
    // edges
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++)
      addEdge(N(c, r), N(c + 1, r), 'h', r === 1 ? 2 : 1, r === 1 ? 50 : (r === 3 ? 30 : 40));
    for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++)
      addEdge(N(c, r), N(c, r + 1), 'v', 1, 40);

    // node half sizes
    for (const n of W.nodeList) {
      if (n.type === 'round') { n.hx = n.hy = R.box; continue; }
      n.hx = Math.max(n.arms.N ? n.arms.N.hw : 0, n.arms.S ? n.arms.S.hw : 0) || 3.5;
      n.hy = Math.max(n.arms.E ? n.arms.E.hw : 0, n.arms.W ? n.arms.W.hw : 0) || 3.5;
    }
    // edge geometry
    for (const e of W.edges) {
      e.d = e.axis === 'h' ? { x: 1, y: 0 } : { x: 0, y: 1 };
      e.rn = { x: -e.d.y, y: e.d.x };
      e.total = e.axis === 'h' ? e.b.x - e.a.x : e.b.y - e.a.y;
      e.s0 = e.axis === 'h' ? e.a.hx : e.a.hy;
      e.s1 = e.total - (e.axis === 'h' ? e.b.hx : e.b.hy);
    }
    // lanes
    for (const e of W.edges) {
      for (const dir of [1, -1]) {
        const from = dir > 0 ? e.a : e.b, to = dir > 0 ? e.b : e.a;
        const d = { x: e.d.x * dir, y: e.d.y * dir }, rn = { x: -d.y, y: d.x };
        const hf = e.axis === 'h' ? from.hx : from.hy, ht = e.axis === 'h' ? to.hx : to.hy;
        const key = from.id + '>' + to.id;
        const ed = { key, edge: e, dir, from, to, d, rn, lanes: [], inArm: armOf({ x: -d.x, y: -d.y }), outArm: armOf(d), limit: e.limit };
        W.edgeDirs[key] = ed;
        for (let i = 0; i < e.n; i++) {
          const off = (i + 0.5) * LW;
          const start = { x: from.x + d.x * hf + rn.x * off, y: from.y + d.y * hf + rn.y * off };
          const end = { x: to.x - d.x * ht + rn.x * off, y: to.y - d.y * ht + rn.y * off };
          const lane = {
            id: key + '#' + i, key, ed, edge: e, dir, i, n: e.n, from, to, d, rn, off, start, end,
            path: new Path([start, end]), limit: e.limit / 3.6, conns: [], cws: [], isLane: true, blocked: false,
          };
          lane.len = lane.path.len;
          lane.ctrl = laneControl(lane);
          lane.stopS = lane.ctrl === 'light' ? lane.len - 6.5
            : lane.ctrl === 'round' ? lane.len - 0.4
            : (lane.ctrl === 'stop' || lane.ctrl === 'yield') ? lane.len - 0.8 : lane.len;
          ed.lanes.push(lane);
          W.lanes.push(lane);
        }
      }
    }
    // crosswalks
    for (const n of W.nodeList) {
      if (n.type !== 'light' && n.type !== 'round') continue;
      for (const arm of ['N', 'E', 'S', 'W']) {
        const e = n.arms[arm]; if (!e) continue;
        const off = n.type === 'light' ? 3 : 5;
        const along = e.a === n ? e.s0 + off : e.s1 - off;
        addCrosswalk(e, along, n.type === 'light' ? n : null);
      }
    }
    [['n01-n11', 85], ['n10-n20', 85], ['n11-n12', 75], ['n03-n13', 85], ['n20-n21', 75], ['n32-n33', 65]]
      .forEach(([id, along]) => addCrosswalk(W.edgeMap[id], along, null));

    // connectors
    for (const node of W.nodeList) {
      const inbound = Object.values(W.edgeDirs).filter(ed => ed.to === node);
      const outbound = Object.values(W.edgeDirs).filter(ed => ed.from === node);
      for (const ein of inbound) for (const eout of outbound) {
        if (eout.outArm === ein.inArm) continue; // no U-turns
        if (node.type === 'round') {
          addRoundConn(node, ein, eout);
          continue;
        }
        const turn = turnType(ein.d, eout.d);
        for (const lin of ein.lanes) for (const lout of eout.lanes) {
          if (turn === 'right' && !(lin.i === lin.n - 1 && lout.i === lout.n - 1)) continue;
          if (turn === 'left' && !(lin.i === 0 && lout.i === 0)) continue;
          if (turn === 'straight' && lout.i !== Math.min(lin.i, lout.n - 1)) continue;
          addConn(node, lin, lout, turn);
        }
      }
    }

    // lights / parking bay / obstacles
    const eBay = W.edgeMap['n13-n23'];
    const bay = { edge: eBay, x0: 205, x1: 303, y0: 430 + 3.5, depth: 2.5, slots: [], target: 6 };
    bay.y1 = bay.y0 + bay.depth;
    for (let k = 0; k < 14; k++) {
      const x0 = bay.x0 + k * 7;
      bay.slots.push({ x0, x1: x0 + 7, y0: bay.y0, y1: bay.y1, cx: x0 + 3.5, cy: bay.y0 + bay.depth / 2 });
    }
    eBay.bay = bay;
    W.bay = bay;
    const rb = U.rng(77);
    bay.slots.forEach((s, k) => {
      if (k === bay.target) return;
      if (k !== bay.target - 1 && k !== bay.target + 1 && rb() < 0.25) return;
      const L = 4.1 + rb() * 0.5;
      const off = k === bay.target - 1 ? 0.5 : k === bay.target + 1 ? -0.5 : (rb() - 0.5) * 1.2;
      W.statics.push({ x: s.cx + off, y: s.cy + 0.05, a: rb() < 0.85 ? 0 : Math.PI, hl: L / 2, hw: 0.88, L, W: 1.76, color: U.pick(PAL.cars, rb), kind: 'car', isStatic: true, v: 0 });
    });
    // delivery van partially blocking eastbound lane of n02-n12
    W.van = { x: 95, y: 300 + 2.35, a: 0, hl: 2.75, hw: 1.06, L: 5.5, W: 2.12, color: '#f4f6f8', kind: 'van', isStatic: true, hazard: true, v: 0 };
    W.statics.push(W.van);
    W.edgeDirs['n02>n12'].lanes[0].blocked = true;

    buildDecor();
    buildSigns();

    const m = 140;
    W.bounds = { x0: XS[0] - m, y0: YS[0] - m, x1: XS[3] + m, y1: YS[3] + m };
  }

  function addConn(node, lin, lout, turn) {
    let pts;
    const P0 = lin.end, P3 = lout.start;
    if (turn === 'straight') pts = [P0, P3];
    else {
      const C = Math.abs(lin.d.x) > 0.5 ? { x: P3.x, y: P0.y } : { x: P0.x, y: P3.y };
      const R1 = Math.hypot(C.x - P0.x, C.y - P0.y), R2 = Math.hypot(C.x - P3.x, C.y - P3.y);
      pts = U.bezier(P0, { x: P0.x + lin.d.x * 0.55 * R1, y: P0.y + lin.d.y * 0.55 * R1 },
        { x: P3.x - lout.d.x * 0.55 * R2, y: P3.y - lout.d.y * 0.55 * R2 }, P3, 12);
    }
    const limit = node.type === 'bend' ? 7.5 : turn === 'straight' ? Math.min(lin.limit, lout.limit, 12.5) : turn === 'right' ? 5.2 : 6.5;
    const c = {
      id: lin.id + '→' + lout.id, node, from: lin, to: lout, path: new Path(pts), turn, exitIdx: 0, limit, isConn: true,
      inArm: lin.ed.inArm, outArm: lout.ed.outArm,
    };
    c.len = c.path.len;
    lin.conns.push(c); W.conns.push(c);
  }

  function addRoundConn(node, ein, eout) {
    const lin = ein.lanes[0], lout = eout.lanes[0];
    const te = ARM_ANG[ein.inArm] - R.delta, tx = ARM_ANG[eout.outArm] + R.delta;
    let sweep = te - tx;
    while (sweep <= 0.05) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
    const cx = node.x, cy = node.y;
    const E = { x: cx + R.rc * Math.cos(te), y: cy + R.rc * Math.sin(te) }, Te = { x: Math.sin(te), y: -Math.cos(te) };
    const X = { x: cx + R.rc * Math.cos(tx), y: cy + R.rc * Math.sin(tx) }, Tx = { x: Math.sin(tx), y: -Math.cos(tx) };
    const P0 = lin.end, P3 = lout.start;
    const pts = U.bezier(P0, { x: P0.x + lin.d.x * 3.5, y: P0.y + lin.d.y * 3.5 }, { x: E.x - Te.x * 3.5, y: E.y - Te.y * 3.5 }, E, 8);
    const entryEnd = pts.length - 1;
    const n = Math.max(2, Math.ceil(sweep * R.rc / 1.0));
    for (let k = 1; k <= n; k++) {
      const th = te - sweep * k / n;
      pts.push({ x: cx + R.rc * Math.cos(th), y: cy + R.rc * Math.sin(th) });
    }
    const ex = U.bezier(X, { x: X.x + Tx.x * 3.5, y: X.y + Tx.y * 3.5 }, { x: P3.x - lout.d.x * 3.5, y: P3.y - lout.d.y * 3.5 }, P3, 8);
    for (let k = 1; k < ex.length; k++) pts.push(ex[k]);
    const exitIdx = (ROT.indexOf(eout.outArm) - ROT.indexOf(ein.inArm) + 4) % 4;
    const c = {
      id: lin.id + '→' + lout.id, node, from: lin, to: lout, path: new Path(pts), turn: 'round', exitIdx, limit: 6.2,
      isConn: true, inArm: ein.inArm, outArm: eout.outArm,
    };
    c.len = c.path.len;
    c.entryLen = c.path.cum[entryEnd];
    c.exitStart = c.len - new Path(ex).len;
    lin.conns.push(c); W.conns.push(c);
  }

  /* ---------------- city decoration ---------------- */
  function nearRound(x0, y0, x1, y1, r) {
    const n = W.nodes.n22;
    const cx = U.clamp(n.x, x0, x1), cy = U.clamp(n.y, y0, y1);
    return Math.hypot(cx - n.x, cy - n.y) < r;
  }
  function nearCrosswalk(x, y, r) {
    for (const cw of W.crosswalks) if (Math.hypot(cw.x - x, cw.y - y) < r + cw.hw) return true;
    return false;
  }

  function addBuilding(list, x, y, w, h, height, rnd) {
    const b = { x, y, w, h, height, pal: U.pick(PAL.buildings, rnd), detail: Math.floor(rnd() * 4), seed: Math.floor(rnd() * 1e6) };
    list.push(b);
    W.solids.push({ x: x + w / 2, y: y + h / 2, a: 0, hl: w / 2, hw: h / 2, kind: 'building' });
    return b;
  }

  function buildDecor() {
    const { XS, YS } = CFG;
    const hwRow = r => (r === 1 ? 2 * LW : LW);
    const K = 0.28, m = 1.6;
    const parks = { '1,0': 'park', '1,2': 'park' };
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const x0 = XS[c] + LW, x1 = XS[c + 1] - LW, y0 = YS[r] + hwRow(r), y1 = YS[r + 1] - hwRow(r + 1);
      const kind = parks[c + ',' + r] || 'city';
      const rnd = U.rng(1000 + r * 10 + c);
      const I = { x0: x0 + SW, y0: y0 + SW, x1: x1 - SW, y1: y1 - SW };
      const blk = { x0, y0, x1, y1, I, kind, buildings: [], paths: [], ponds: [], lots: [] };
      W.blocks.push(blk);
      if (kind === 'park') {
        const cx = (I.x0 + I.x1) / 2, cy = (I.y0 + I.y1) / 2;
        blk.paths.push({ x0: I.x0, y0: cy - 1.6, x1: I.x1, y1: cy + 1.6 });
        blk.paths.push({ x0: cx - 1.6, y0: I.y0, x1: cx + 1.6, y1: I.y1 });
        blk.plaza = { x: cx, y: cy, r: 11 };
        blk.ponds.push({ x: cx + (I.x1 - cx) * 0.5, y: cy + (I.y1 - cy) * 0.5, rx: 16, ry: 10 });
        for (let i = 0; i < 70; i++) {
          const x = U.lerp(I.x0 + 3, I.x1 - 3, rnd()), y = U.lerp(I.y0 + 3, I.y1 - 3, rnd());
          if (Math.abs(x - cx) < 4.5 || Math.abs(y - cy) < 4.5) continue;
          if (Math.hypot(x - cx, y - cy) < 15) continue;
          const p = blk.ponds[0];
          if (((x - p.x) / (p.rx + 3)) ** 2 + ((y - p.y) / (p.ry + 3)) ** 2 < 1) continue;
          if (nearRound(x - 2, y - 2, x + 2, y + 2, 26)) continue;
          W.trees.push({ x, y, r: 2.2 + rnd() * 1.8, c: U.pick(PAL.trees, rnd) });
        }
        // playground / benches
        blk.benches = [];
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          blk.benches.push({ x: cx + Math.cos(a) * 13, y: cy + Math.sin(a) * 13, a: a + Math.PI / 2 });
        }
      } else {
        const Dn = 16, Ds = 16, Dw = 15, De = 15, maxShift = 24 * K;
        const rowH = (yTop, yBot, fromTop) => {
          let x = I.x0 + m;
          while (x < I.x1 - m - 9) {
            let w = 11 + rnd() * 15;
            if (I.x1 - m - x - w < 10) w = I.x1 - m - x;
            const h = 7 + rnd() * 17;
            if (fromTop) {
              const by = yTop + h * K;
              if (!nearRound(x, by - h * K, x + w, by + Dn, 34)) addBuilding(blk.buildings, x, by, w, Dn - (maxShift - h * K) * 0.3, h, rnd);
            } else {
              if (!nearRound(x, yBot - Ds - h * K, x + w, yBot, 34)) addBuilding(blk.buildings, x, yBot - Ds, w, Ds, h, rnd);
            }
            x += w + 0.8 + (rnd() < 0.25 ? 3 + rnd() * 4 : 0);
          }
        };
        rowH(I.y0 + m, 0, true);
        rowH(0, I.y1 - m, false);
        const colTop = I.y0 + m + maxShift + Dn + 3, colBot = I.y1 - m - Ds - 3;
        const col = (xL, w) => {
          let y = colTop;
          while (y < colBot - 9) {
            const h = 7 + rnd() * 14;
            let hgt = 11 + rnd() * 12;
            if (colBot - y - hgt < 10) hgt = colBot - y;
            const by = y + h * K;
            if (by + hgt - h * K > colBot) break;
            if (!nearRound(xL, by - h * K, xL + w, by + hgt, 34)) addBuilding(blk.buildings, xL, by, w, hgt - h * K, h, rnd);
            y += hgt + 0.8 + (rnd() < 0.3 ? 3 : 0);
          }
        };
        col(I.x0 + m, Dw);
        col(I.x1 - m - De, De);
        // courtyard
        const C = { x0: I.x0 + m + Dw + 4, y0: colTop + 1, x1: I.x1 - m - De - 4, y1: colBot - 1 };
        blk.court = C;
        if (rnd() < 0.6 && C.x1 - C.x0 > 50) {
          const lot = { x0: C.x0 + 8, y0: (C.y0 + C.y1) / 2 - 7, x1: C.x0 + 8 + 40, y1: (C.y0 + C.y1) / 2 + 7 };
          blk.lots.push(lot);
          for (let k = 0; k < 6; k++) {
            if (rnd() < 0.3) continue;
            const x = lot.x0 + 3.5 + k * 6.3, y = lot.y0 + 3.4;
            W.decorCars.push({ x, y, a: Math.PI / 2, L: 4.2, W: 1.75, color: U.pick(PAL.cars, rnd) });
          }
          for (let k = 0; k < 6; k++) {
            if (rnd() < 0.4) continue;
            const x = lot.x0 + 3.5 + k * 6.3, y = lot.y1 - 3.4;
            W.decorCars.push({ x, y, a: -Math.PI / 2, L: 4.2, W: 1.75, color: U.pick(PAL.cars, rnd) });
          }
        }
        for (let i = 0; i < 22; i++) {
          const x = U.lerp(C.x0 + 3, C.x1 - 3, rnd()), y = U.lerp(C.y0 + 3, C.y1 - 3, rnd());
          if (blk.lots.some(l => x > l.x0 - 3 && x < l.x1 + 3 && y > l.y0 - 3 && y < l.y1 + 3)) continue;
          if (nearRound(x - 2, y - 2, x + 2, y + 2, 30)) continue;
          W.trees.push({ x, y, r: 2.0 + rnd() * 1.8, c: U.pick(PAL.trees, rnd) });
        }
      }
      // street trees along sidewalk
      const st = (x, y) => {
        if (nearCrosswalk(x, y, 7)) return;
        if (nearRound(x - 1, y - 1, x + 1, y + 1, 25)) return;
        if (y > 425 && y < 445 && x > 195 && x < 312) return;
        W.trees.push({ x, y, r: 1.9 + rnd() * 0.6, c: U.pick(PAL.trees, rnd), street: true });
      };
      for (let x = x0 + 12; x < x1 - 10; x += 15) { st(x, y0 + 2.7); st(x, y1 - 2.7); }
      for (let y = y0 + 12; y < y1 - 10; y += 15) { st(x0 + 2.7, y); st(x1 - 2.7, y); }
    }

    // outer ring of buildings facing the ring road
    const rnd = U.rng(4242);
    const minX = XS[0] - LW - SW, maxX = XS[3] + LW + SW, minY = YS[0] - LW - SW, maxY = YS[3] + LW + SW;
    let x = minX - 20;
    while (x < maxX + 20) {
      const w = 12 + rnd() * 16, h = 7 + rnd() * 15;
      addBuilding(W.outerBuildings, x, minY - 3 - 17, w, 17, h, rnd);
      x += w + 1 + (rnd() < 0.3 ? 5 : 0);
    }
    x = minX - 20;
    while (x < maxX + 20) {
      const w = 12 + rnd() * 16, h = 7 + rnd() * 15;
      const top = maxY + 6 + h * K;
      addBuilding(W.outerBuildings, x, top, w, 17, h, rnd);
      x += w + 1 + (rnd() < 0.3 ? 5 : 0);
    }
    let y = minY + 4;
    while (y < maxY - 10) {
      const hgt = 12 + rnd() * 14, h = 7 + rnd() * 14;
      addBuilding(W.outerBuildings, minX - 3 - 16, y + h * K, 16, hgt, h, rnd);
      addBuilding(W.outerBuildings, maxX + 3, y + h * K, 16, hgt, h, rnd);
      y += hgt + h * K + 1.5;
    }
    for (let i = 0; i < 160; i++) {
      const tx = U.lerp(minX - 120, maxX + 120, rnd()), ty = U.lerp(minY - 120, maxY + 120, rnd());
      if (tx > minX - 24 && tx < maxX + 24 && ty > minY - 24 && ty < maxY + 28) continue;
      W.trees.push({ x: tx, y: ty, r: 2.4 + rnd() * 2.2, c: U.pick(PAL.trees, rnd) });
    }
  }

  function buildSigns() {
    for (const ed of Object.values(W.edgeDirs)) {
      const lane = ed.lanes[ed.lanes.length - 1];
      const e = ed.edge;
      const at = (s, extra = 1.3) => {
        const cxl = lane.start.x + lane.d.x * s - lane.rn.x * lane.off, cyl = lane.start.y + lane.d.y * s - lane.rn.y * lane.off;
        return { x: cxl + lane.rn.x * (e.hw + extra), y: cyl + lane.rn.y * (e.hw + extra) };
      };
      // speed limit after leaving node
      const p = at(12);
      if (!(e.bay && lane.dir > 0)) W.signs.push({ ...p, kind: 'limit', val: e.limit });
      else W.signs.push({ ...at(12, 4.2), kind: 'limit', val: e.limit });
      const ctrl = lane.ctrl;
      if (ctrl === 'stop' || ctrl === 'yield') W.signs.push({ ...at(lane.stopS - 1.5), kind: ctrl });
      if (ctrl === 'major') W.signs.push({ ...at(lane.len - 32), kind: 'priority' });
      if (ctrl === 'round') W.signs.push({ ...at(lane.len - 24), kind: 'round' });
      if (ctrl === 'light') {
        for (const l of ed.lanes) l.lightPole = true;
        W.lightPoles.push({ ed, node: ed.to, axis: e.axis, pos: at(lane.stopS + 0.4, 0.9), lane });
      }
      for (const c of lane.cws) {
        if (c.cw.signal) continue;
        if (c.s0 < 12 || c.s0 > lane.len - 4 && ctrl !== 'round') { /* near node */ }
        W.signs.push({ ...at(c.s0 - 1.2), kind: 'cw' });
      }
    }
  }

  /* ---------------- queries ---------------- */
  W.locate = function (x, y) {
    for (const n of W.nodeList) {
      const dx = x - n.x, dy = y - n.y;
      if (Math.abs(dx) <= n.hx && Math.abs(dy) <= n.hy) {
        if (n.type === 'round') {
          const r = Math.hypot(dx, dy);
          if (r <= R.island) return { kind: 'island', node: n };
          if (r <= R.outer || Math.abs(dx) <= LW || Math.abs(dy) <= LW) return { kind: 'node', node: n };
          return { kind: 'off' };
        }
        return { kind: 'node', node: n };
      }
    }
    for (const e of W.edges) {
      let along, lat;
      if (e.axis === 'h') { along = x - e.a.x; lat = y - e.a.y; } else { along = y - e.a.y; lat = -(x - e.a.x); }
      if (along < e.s0 || along > e.s1) continue;
      let lim = e.hw;
      if (e.bay && lat > 0 && x >= e.bay.x0 && x <= e.bay.x1) lim = e.hw + e.bay.depth;
      if (Math.abs(lat) > (lat > 0 ? lim : e.hw)) continue;
      return { kind: 'edge', edge: e, along, lat, side: lat >= 0 ? 1 : -1, laneIdx: Math.min(e.n - 1, Math.floor(Math.abs(lat) / LW)), inBay: Math.abs(lat) > e.hw };
    }
    const FR = CFG.FILLET_R;
    for (const n of W.nodeList) {
      if (n.type === 'round') continue;
      const dx = x - n.x, dy = y - n.y;
      if (!n.arms[dx > 0 ? 'E' : 'W'] || !n.arms[dy > 0 ? 'S' : 'N']) continue;
      const ex = Math.abs(dx) - n.hx, ey = Math.abs(dy) - n.hy;
      if (ex > 0 && ey > 0 && ex < FR && ey < FR && (ex - FR) ** 2 + (ey - FR) ** 2 > FR * FR) return { kind: 'node', node: n, fillet: true };
    }
    return { kind: 'off' };
  };
  W.onRoad = (x, y) => { const k = W.locate(x, y).kind; return k === 'edge' || k === 'node'; };

  W.edgeDirFor = (edge, ang) => {
    const dot = Math.cos(ang) * edge.d.x + Math.sin(ang) * edge.d.y;
    return dot >= 0 ? W.edgeDirs[edge.a.id + '>' + edge.b.id] : W.edgeDirs[edge.b.id + '>' + edge.a.id];
  };
  W.laneS = (lane, x, y) => (x - lane.start.x) * lane.d.x + (y - lane.start.y) * lane.d.y;
  W.outbound = node => Object.values(W.edgeDirs).filter(ed => ed.from === node);
  W.nextKeys = key => {
    const ed = W.edgeDirs[key];
    return W.outbound(ed.to).filter(o => o.outArm !== ed.inArm).map(o => o.key);
  };
  W.bfs = (fromKey, toKey) => {
    if (fromKey === toKey) return [];
    const prev = { [fromKey]: null }, q = [fromKey];
    while (q.length) {
      const k = q.shift();
      for (const nk of W.nextKeys(k)) {
        if (nk in prev) continue;
        prev[nk] = k;
        if (nk === toKey) {
          const out = [];
          let c = nk;
          while (c !== fromKey) { out.unshift(c); c = prev[c]; }
          return out;
        }
        q.push(nk);
      }
    }
    return null;
  };
  W.maneuver = (inKey, outKey) => {
    const a = W.edgeDirs[inKey], b = W.edgeDirs[outKey];
    const node = a.to;
    if (node.type === 'round') {
      const exitN = (ROT.indexOf(b.outArm) - ROT.indexOf(a.inArm) + 4) % 4;
      return { node, kind: 'round', exitN };
    }
    return { node, kind: turnType(a.d, b.d) };
  };
  W.connFor = (inKey, outKey, laneIdx) => {
    const a = W.edgeDirs[inKey];
    const lanes = laneIdx != null && a.lanes[laneIdx] ? [a.lanes[laneIdx], ...a.lanes] : a.lanes;
    for (const l of lanes) for (const c of l.conns) if (c.to.key === outKey) return c;
    return null;
  };

  W.update = dt => { for (const n of W.nodeList) if (n.light) n.light.t += dt; };
  W.resetLights = () => { for (const n of W.nodeList) if (n.light) n.light.t = n.light.offset; };

  build();
  return W;
})();

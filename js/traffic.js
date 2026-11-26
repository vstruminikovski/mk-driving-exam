'use strict';
/* =========================================================================
   TRAFFIC — AI vehicles: lane following, IDM car-following, right of way
   ========================================================================= */

const Traffic = (() => {
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const ARM_ANG = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
  const IDM = { a: 1.7, b: 2.6, T: 1.25, s0: 2.2 };

  const T = {
    cars: [], ents: [], nextId: 1, target: CFG.DENSITY.normal, spawnTimer: 0, enabled: true,
  };

  function idmAcc(v, v0, gap, dv, s0 = IDM.s0) {
    const sStar = s0 + Math.max(0, v * IDM.T + (v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
    const g = Math.max(gap, 0.05);
    return IDM.a * (1 - Math.pow(v / Math.max(v0, 0.1), 4) - (sStar / g) * (sStar / g));
  }

  function makeCar(lane, s, opts = {}) {
    const type = opts.type || (Math.random() < 0.12 ? 'van' : 'car');
    const L = type === 'van' ? 5.0 : 3.9 + Math.random() * 0.55;
    const Wd = type === 'van' ? 2.0 : 1.74;
    const car = {
      id: T.nextId++, type, L, W: Wd, color: opts.color || U.pick(PAL.cars),
      chain: [lane], s, v: opts.v != null ? opts.v : lane.limit * 0.7, speedF: opts.speedF || (0.86 + Math.random() * 0.14),
      committed: false, stopDone: false, stopT: 0, ind: 0, braking: false, waitT: 0, ignore: null, ignoreT: 0,
      blockedBy: null, route: opts.route ? opts.route.slice() : null, keep: !!opts.keep, x: 0, y: 0, a: 0, acc: 0,
      conflictCD: 0, scripted: !!opts.scripted,
    };
    planNext(car);
    place(car);
    T.cars.push(car);
    return car;
  }

  function planNext(car) {
    const lane = car.chain[0];
    let opts = lane.conns.filter(c => !c.to.blocked);
    if (!opts.length) opts = lane.conns.slice();
    if (!opts.length) { car.chain = [lane]; return; }
    let conn = null;
    if (car.route && car.route.length) {
      const nk = car.route.shift();
      conn = opts.find(c => c.to.key === nk) || null;
    }
    if (!conn) {
      const w = opts.map(c => c.turn === 'straight' ? 3 : c.turn === 'round' ? (c.exitIdx === 2 ? 2.5 : 1.3) : c.turn === 'right' ? 1.5 : 1.2);
      let tot = w.reduce((a, b) => a + b, 0), r = Math.random() * tot;
      for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) { conn = opts[i]; break; } }
      conn = conn || opts[0];
    }
    car.chain = [lane, conn, conn.to];
  }

  function place(car) {
    const p = car.chain[0].path.at(car.s);
    car.x = p.x; car.y = p.y; car.a = p.a;
  }

  /* ---- entity list used for collision-avoidance scanning ---- */
  function buildEnts() {
    const ents = [];
    const P = Player;
    if (!P.ghost) ents.push({ ref: P, x: P.x, y: P.y, a: P.a, hl: P.hl, hw: P.hw, v: P.v, car: true });
    for (const c of T.cars) ents.push({ ref: c, x: c.x, y: c.y, a: c.a, hl: c.L / 2, hw: c.W / 2, v: c.v, car: true });
    for (const s of World.statics) ents.push({ ref: s, x: s.x, y: s.y, a: s.a, hl: s.hl, hw: s.hw, v: 0, car: true });
    for (const p of Peds.list) if (p.onRoad) ents.push({ ref: p, x: p.x, y: p.y, v: 0, ped: true });
    T.ents = ents;
  }

  function scan(car, look) {
    const cand = [];
    for (const e of T.ents) {
      if (e.ref === car || e.ref === car.ignore) continue;
      if (Math.abs(e.x - car.x) > look + 8 || Math.abs(e.y - car.y) > look + 8) continue;
      cand.push(e);
    }
    if (!cand.length) return null;
    let idx = 0, path = car.chain[0], s = car.s + car.L / 2 + 0.5, d = 0.5;
    const clr = car.W / 2 + 0.42;
    while (d <= look) {
      if (s > path.len) {
        s -= path.len; idx++; path = car.chain[idx];
        if (!path) break;
        continue;
      }
      const p = path.path.at(s);
      for (const e of cand) {
        const c = e.ped ? Math.hypot(e.x - p.x, e.y - p.y) - 0.4 : U.obbClear(e, p.x, p.y);
        if (c < clr) return { gap: d - 0.5, ent: e };
      }
      s += 1.0; d += 1.0;
    }
    return null;
  }

  /* ---- right-of-way checks ---- */
  function playerApproach(node) {
    const P = Player;
    if (P.ghost || P.loc.kind !== 'edge') return null;
    const ed = World.edgeDirFor(P.loc.edge, P.a);
    if (ed.to !== node) return null;
    const lane = ed.lanes[0];
    const dist = lane.len - World.laneS(lane, P.x, P.y) - P.hl;
    return { ed, dist, v: P.v };
  }

  function oncomingClear(car, lane, node) {
    const oppArm = OPP[lane.ed.inArm];
    if (!node.arms[oppArm]) return true;
    for (const c of T.cars) {
      if (c === car) continue;
      const p = c.chain[0];
      if (p.isLane && p.to === node && p.ed.inArm === oppArm) {
        const next = c.chain[1];
        if (next && next.turn === 'left') continue;
        const dist = p.len - c.s - c.L / 2;
        if (c.v > 0.5 && dist < Math.max(10, c.v * 4.2)) return false;
      } else if (p.isConn && p.node === node && p.inArm === oppArm && p.turn !== 'left' && c.s < p.len * 0.75) return false;
    }
    const pa = playerApproach(node);
    if (pa && pa.ed.inArm === oppArm && pa.v > 0.5 && pa.dist < Math.max(12, pa.v * 4.5) && pa.dist > -3) return false;
    const pin = Player.inNode;
    if (pin && pin.node === node && pin.inArm === oppArm && Math.abs(Player.v) > 0.3) return false;
    return true;
  }

  function majorClear(car, node) {
    const majorArms = node.major === 'h' ? ['E', 'W'] : ['N', 'S'];
    for (const c of T.cars) {
      if (c === car) continue;
      const p = c.chain[0];
      if (p.isLane && p.to === node && majorArms.includes(p.ed.inArm)) {
        const dist = p.len - c.s - c.L / 2;
        if (c.v > 0.5 && dist < Math.max(14, c.v * 4.6)) return false;
      }
    }
    const pa = playerApproach(node);
    if (pa && majorArms.includes(pa.ed.inArm) && pa.v > 0.5 && pa.dist < Math.max(15, pa.v * 4.6) && pa.dist > -3) return false;
    return true;
  }

  function boxClear(car, node) {
    for (const c of T.cars) {
      if (c === car) continue;
      const p = c.chain[0];
      if (p.isConn && p.node === node) return false;
    }
    if (Player.loc.kind === 'node' && Player.loc.node === node) return false;
    return true;
  }

  function roundClear(car, node, lane) {
    const R = CFG.ROUND;
    const te = ARM_ANG[lane.ed.inArm] - R.delta;
    for (const c of T.cars) {
      if (c === car) continue;
      const p = c.chain[0];
      if (!(p.isConn && p.node === node)) continue;
      if (p.outArm === lane.ed.inArm && c.s > p.entryLen) continue; // exits before our entry
      const th = Math.atan2(c.y - node.y, c.x - node.x);
      const diff = U.angNorm(th - te);
      if (c.s >= p.entryLen - 2 && diff > -0.35 && diff < 1.8) return false;
      if (Math.hypot(c.x - (node.x + R.rc * Math.cos(te)), c.y - (node.y + R.rc * Math.sin(te))) < 6) return false;
    }
    if (Player.loc.kind === 'node' && Player.loc.node === node) {
      const r = Math.hypot(Player.x - node.x, Player.y - node.y);
      const th = Math.atan2(Player.y - node.y, Player.x - node.x);
      const diff = U.angNorm(th - te);
      if (r > 6 && r < 18 && diff > -0.4 && diff < 1.9) return false;
    }
    return true;
  }

  function exitClear(car, conn) {
    const out = conn.to;
    for (const c of T.cars) {
      if (c === car) continue;
      if (c.chain[0] === out && c.s < c.L / 2 + 4.5 && c.v < 1) return false;
    }
    return true;
  }

  function mayEnter(car, lane, conn, distStop) {
    const node = lane.to;
    if (!exitClear(car, conn)) return false;
    switch (lane.ctrl) {
      case 'light': {
        const st = World.lightState(node, lane.edge.axis);
        if (st === 'R') return false;
        if (st === 'Y') { const need = (car.v * car.v) / (2 * 3.4); if (distStop > need + 1) return false; }
        if (conn.turn === 'left' && !oncomingClear(car, lane, node)) return false;
        return true;
      }
      case 'round': return roundClear(car, node, lane);
      case 'stop': if (!car.stopDone) return false; return majorClear(car, node) && boxClear(car, node);
      case 'yield': return majorClear(car, node) && boxClear(car, node);
      case 'major': return conn.turn === 'left' ? oncomingClear(car, lane, node) : true;
      default: return true;
    }
  }

  function cwBlocked(cw, dist, car) {
    for (const p of Peds.list) {
      if (p.cw !== cw) continue;
      if (p.state === 'cross') return true;
      if (p.state === 'wait' && !cw.signal) {
        const need = (car.v * car.v) / (2 * 3.0);
        if (dist > need) return true;
      }
    }
    return false;
  }

  /* ---- per-car update ---- */
  function updateCar(car, dt, now) {
    const path = car.chain[0];
    let v0 = path.isConn ? path.limit : path.limit * car.speedF;
    const frontS = car.s + car.L / 2;
    if (path.isLane && car.chain[1]) {
      const toEnd = path.len - frontS;
      v0 = Math.min(v0, Math.sqrt(car.chain[1].limit ** 2 + 2 * 1.8 * Math.max(0, toEnd - 2)));
    }
    const look = 10 + car.v * 3.2;
    let acc = IDM.a * (1 - Math.pow(car.v / Math.max(v0, 0.1), 4));
    const lead = scan(car, look);
    car.blockedBy = null;
    if (lead) {
      const e = lead.ent;
      const vAlong = e.ped ? 0 : Math.max(0, e.v * Math.cos(U.angNorm((e.a || 0) - car.a)));
      acc = Math.min(acc, idmAcc(car.v, v0, lead.gap, car.v - vAlong, e.ped ? 1.8 : IDM.s0));
      car.blockedBy = e.ref;
      // forced hard braking because of the candidate → right-of-way conflict
      if (e.ref === Player && car.conflictCD <= 0) {
        const req = (car.v * car.v) / (2 * Math.max(lead.gap - 0.5, 0.3));
        if (req > 3.8 && car.v > 3 && Math.abs(U.angNorm(car.a - Player.a)) > 0.6) {
          car.conflictCD = 4;
          Exam.onConflict(car);
        }
      }
      // mutual-block deadlock breaker
      if (car.v < 0.1 && e.ref && e.ref.blockedBy === car && car.id > e.ref.id && !e.ref.isPlayer) {
        car.ignore = e.ref; car.ignoreT = 2.5;
      }
    }
    if (car.conflictCD > 0) car.conflictCD -= dt;
    if (car.ignoreT > 0) { car.ignoreT -= dt; if (car.ignoreT <= 0) car.ignore = null; }

    // intersection control
    if (path.isLane && !car.committed && car.chain[1]) {
      const distStop = path.stopS - frontS;
      if (path.ctrl === 'stop' && !car.stopDone) {
        if (car.v < 0.25 && distStop < 2.5) { car.stopT += dt; if (car.stopT > 0.9) car.stopDone = true; }
      }
      const ok = mayEnter(car, path, car.chain[1], distStop);
      if (!ok && distStop > -1.5) {
        acc = Math.min(acc, idmAcc(car.v, v0, Math.max(distStop, 0.02), car.v, 0.25));
        car.waitT += dt;
      } else if (distStop < 0.5) {
        car.committed = true; car.waitT = 0;
      }
    }

    // crosswalks ahead on the chain
    let base = -frontS;
    for (let i = 0; i < car.chain.length; i++) {
      const p = car.chain[i];
      if (p.isLane) {
        for (const c of p.cws) {
          const dist = base + c.s0;
          if (dist > look + 4) break;
          if (dist < -0.2) continue;
          if (cwBlocked(c.cw, dist, car)) acc = Math.min(acc, idmAcc(car.v, v0, Math.max(dist - 0.8, 0.02), car.v, 0.4));
        }
      }
      base += p.len;
      if (base > look + 4) break;
    }

    acc = Math.max(acc, -9);
    car.acc = acc;
    car.v = Math.max(0, car.v + acc * dt);
    if (lead && lead.gap < 0.25) car.v = Math.min(car.v, 0);
    car.braking = acc < -0.7 || car.v < 0.15;
    car.s += car.v * dt;

    // advance along chain
    while (car.chain[0] && car.s > car.chain[0].len) {
      car.s -= car.chain[0].len;
      car.chain.shift();
      const np = car.chain[0];
      if (!np) break;
      if (np.isLane) {
        car.committed = false; car.stopDone = false; car.stopT = 0;
        planNext(car);
      }
    }
    if (!car.chain[0]) { car.dead = true; return; }
    place(car);

    // indicators
    const cp = car.chain[0];
    car.ind = 0;
    if (cp.isLane && car.chain[1]) {
      const c = car.chain[1];
      if (cp.len - car.s < 40 && c.turn !== 'round') car.ind = c.turn === 'left' ? -1 : c.turn === 'right' ? 1 : 0;
    } else if (cp.isConn) {
      if (cp.turn === 'round') car.ind = car.s > cp.exitStart - 9 ? 1 : 0;
      else car.ind = cp.turn === 'left' ? -1 : cp.turn === 'right' ? 1 : 0;
    }
  }

  /* ---- spawning ---- */
  const spawnLanes = () => World.lanes.filter(l => !l.blocked);

  function trySpawn(minD, maxD, avoidAhead) {
    const P = Player;
    const lanes = spawnLanes();
    const total = lanes.reduce((a, l) => a + l.len, 0);
    for (let t = 0; t < 14; t++) {
      let r = Math.random() * total, lane = lanes[0];
      for (const l of lanes) { r -= l.len; if (r <= 0) { lane = l; break; } }
      const s = 6 + Math.random() * Math.max(1, lane.len - 22);
      const p = lane.path.at(s);
      const d = Math.hypot(p.x - P.x, p.y - P.y);
      if (d < minD || d > maxD) continue;
      if (lane.cws.some(c => s > c.s0 - 4 && s < c.s1 + 4)) continue;
      if (T.cars.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 12)) continue;
      if (avoidAhead && P.loc.kind === 'edge') {
        const ed = World.edgeDirFor(P.loc.edge, P.a);
        if (lane.ed === ed) {
          const ps = World.laneS(lane, P.x, P.y);
          if (s > ps - 25 && s < ps + 70) continue;
        }
      }
      return makeCar(lane, s, { v: lane.limit * (0.5 + Math.random() * 0.3) });
    }
    return null;
  }

  T.reset = function () {
    T.cars = []; T.ents = []; T.spawnTimer = 0;
  };
  T.populate = function () {
    for (let i = 0; i < T.target * 1.2; i++) trySpawn(40, 230, true);
  };
  T.spawnOn = function (key, laneIdx, s, opts = {}) {
    const ed = World.edgeDirs[key];
    const lane = ed.lanes[Math.min(laneIdx, ed.lanes.length - 1)];
    // clear space
    T.cars = T.cars.filter(c => !(c.chain[0] === lane && Math.abs(c.s - s) < 10));
    return makeCar(lane, s, Object.assign({ scripted: true, keep: true }, opts));
  };
  T.removeOn = function (key) {
    T.cars = T.cars.filter(c => !(c.chain[0].isLane && c.chain[0].key === key));
  };

  T.update = function (dt, now) {
    buildEnts();
    for (const car of T.cars) updateCar(car, dt, now);
    const P = Player;
    T.cars = T.cars.filter(c => {
      if (c.dead) return false;
      const d = Math.hypot(c.x - P.x, c.y - P.y);
      if (d > (c.keep ? 420 : 270)) return false;
      return true;
    });
    if (!T.enabled) return;
    T.spawnTimer -= dt;
    if (T.spawnTimer <= 0 && T.cars.filter(c => !c.scripted).length < T.target) {
      trySpawn(105, 240, false);
      T.spawnTimer = 0.35;
    }
  };

  T.idmAcc = idmAcc;
  return T;
})();

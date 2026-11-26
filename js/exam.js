'use strict';
/* =========================================================================
   EXAM — examiner, navigation, task logic, rule evaluation and scoring
   ========================================================================= */

const Exam = (() => {
  const LW = CFG.LANE_W;
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const ARM_ANG = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };

  const E = {
    mode: 'exam', scen: null, route: [], ri: 0, tasks: [], ti: 0, task: null,
    mistakes: [], score: 100, finished: false, abortAt: 0, t0: 0,
    instruction: { text: '', icon: 'info' }, announcedIdx: -1, maneuver: null,
    indLast: { '-1': -99, '1': -99 }, cd: {}, once: {},
    trk: null, timers: {}, startCheck: true, abortOnCritical: true, hintOn: true,
  };

  const now = () => Game.time;
  const ED = k => World.edgeDirs[k];

  /* ------------------------------------------------------------------ */
  function say(text, icon = 'info', speak = true) {
    E.instruction = { text, icon };
    UI.setInstruction(text, icon);
    if (speak) { Speech.say(text); Sfx.chime(); }
  }
  function good(extra) {
    const t = extra || U.pick(TXT.good);
    UI.toast('✓ ' + t, 'good');
    Sfx.good();
  }
  E.replay = () => { if (E.instruction.text) Speech.say(E.instruction.text); };

  function addMistake(code, detail) {
    if (E.finished) return;
    const def = MISTAKES[code];
    if (!def) return;
    const t = now();
    if (def.sev === 'critical') { if (E.once[code] && t - E.once[code] < 6) return; E.once[code] = t; }
    if (E.cd[code] && t < E.cd[code]) return;
    E.cd[code] = t + (def.sev === 'minor' ? 8 : 5);
    const pen = CFG.SCORING.penalty[def.sev];
    E.mistakes.push({ code, sev: def.sev, text: def.text, detail: detail || '', t: t - E.t0, pen });
    E.score = Math.max(0, E.score - pen);
    UI.toast(def.text, def.sev, pen);
    UI.updateScore();
    if (def.sev === 'critical') {
      Sfx.critical();
      Speech.say(TXT.critical + '. ' + def.text);
      if (E.mode !== 'practice' && E.abortOnCritical) E.abortAt = t + 3.2;
    } else {
      Sfx.warn();
      if (def.sev === 'major') Speech.say(def.text, false);
    }
  }
  E.addMistake = addMistake;

  /* ------------------------------------------------------------------ */
  E.start = function (mode, scen) {
    E.mode = mode; E.scen = scen;
    E.route = scen.route.slice(); E.ri = 0;
    E.tasks = scen.tasks.map(d => ({ def: d, state: 'pending' }));
    E.ti = 0; E.task = null; E.mistakes = []; E.score = CFG.SCORING.start; E.finished = false; E.abortAt = 0;
    E.t0 = now(); E.announcedIdx = -1; E.maneuver = null; E.cd = {}; E.once = {};
    E.indLast = { '-1': -99, '1': -99 }; E.timers = {}; E.startCheck = true;
    E.trk = { key: scen.start.key, edge: ED(scen.start.key).edge, inNode: null, entry: null, prevFrontS: scen.start.s, laneIdx: scen.start.lane, laneT: 0, stopSeen: false, stoppedT: 0 };
    Player.inNode = null;
    E.curEdge = ED(scen.start.key).edge; E.turnText = ''; E.lastHit = 0;
    for (const cw of World.crosswalks) cw.wasOver = false;
    Render.hint = null; Render.highlights = [];
    if (mode === 'practice') extendRoute();
    const intro = mode === 'exam' ? TXT.examStart : mode === 'practice' ? TXT.practiceStart : (scen.intro || TXT.examStart);
    say(intro, mode === 'practice' ? 'info' : 'flag');
    UI.updateScore();
  };

  function extendRoute() {
    while (E.route.length < E.ri + 3) {
      const last = E.route[E.route.length - 1];
      const opts = World.nextKeys(last);
      const w = opts.map(k => (World.maneuver(last, k).kind === 'straight' ? 1.2 : 1));
      let r = Math.random() * w.reduce((a, b) => a + b, 0), pick = opts[0];
      for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) { pick = opts[i]; break; } }
      E.route.push(pick);
    }
  }

  E.progress = () => {
    if (E.mode === 'practice') return null;
    const total = E.tasks.filter(t => t.def.type !== 'spawn' && t.def.type !== 'peds').length + Math.max(0, E.route.length - 1);
    const done = E.tasks.filter(t => t.def.type !== 'spawn' && t.def.type !== 'peds' && (t.state === 'done' || t.state === 'failed')).length + E.ri;
    return { done: Math.min(done, total), total };
  };

  /* ---------------- navigation ---------------- */
  function updateNav() {
    const T = E.trk, P = Player;
    if (E.mode === 'practice') extendRoute();
    if (E.ri + 1 >= E.route.length) { Render.hint = null; return; }
    if (T.key !== E.route[E.ri] || P.loc.kind !== 'edge') return;
    const ed = ED(E.route[E.ri]);
    const dist = ed.lanes[0].len - T.frontS;
    const m = World.maneuver(E.route[E.ri], E.route[E.ri + 1]);
    if (E.announcedIdx !== E.ri) {
      const busy = E.task && E.task.busy;
      if (m.node.type === 'bend') { E.announcedIdx = E.ri; E.maneuver = null; return; }
      if (dist < 78 && (!busy || dist < 38)) {
        E.announcedIdx = E.ri;
        E.maneuver = m;
        // a T-junction where the road simply continues still gets a clear instruction
        E.turnText = TXT.turn(m.node.type, m.kind, m.exitN);
        E.turnIcon = m.kind === 'round' ? 'round' : m.kind;
        say(E.turnText, E.turnIcon);
      }
    }
    // route hint (optional assist)
    if (E.hintOn && E.announcedIdx === E.ri && E.maneuver) {
      const laneIdx = m.kind === 'left' ? 0 : m.kind === 'right' ? ed.lanes.length - 1 : Math.max(0, Math.min(T.laneIdx, ed.lanes.length - 1));
      const conn = World.connFor(E.route[E.ri], E.route[E.ri + 1], laneIdx);
      if (conn) {
        const lane = conn.from, pts = [];
        const s0 = Math.max(T.frontS + 2, lane.len - 30);
        for (let s = s0; s < lane.len; s += 3) pts.push(lane.path.at(s));
        pts.push(...conn.path.pts);
        const out = conn.to;
        for (let s = 2; s <= 16; s += 3) pts.push(out.path.at(s));
        Render.hint = { pts };
      }
    } else Render.hint = null;
  }

  function routeExit(newKey) {
    if (E.ri + 1 >= E.route.length) {
      E.route.push(newKey); E.ri++; return;
    }
    const expected = E.route[E.ri + 1];
    if (newKey === expected) { E.ri++; return; }
    if (E.mode === 'practice') {
      E.route = E.route.slice(0, E.ri + 1).concat([newKey]);
      E.ri++;
      extendRoute();
      UI.toast('Новата рута е пресметана.', 'info');
      return;
    }
    addMistake('wrongTurn');
    const det = World.bfs(newKey, expected);
    const rest = E.route.slice(E.ri + 2);
    E.route = E.route.slice(0, E.ri + 1).concat([newKey], det || [], rest);
    E.ri++;
    E.announcedIdx = -1;
  }

  /* ---------------- rule helpers ---------------- */
  const indUsed = (side, since) => E.indLast[side] >= since || Player.indicator === side;
  const mirrorSince = since => Player.mirrorT >= since;

  function timer(name, cond, dt) {
    E.timers[name] = cond ? (E.timers[name] || 0) + dt : 0;
    return E.timers[name];
  }

  /* ---------------- node enter / exit ---------------- */
  function onNodeEnter(node) {
    const T = E.trk;
    const ed = T.key ? ED(T.key) : null;
    const valid = ed && ed.to === node;
    T.inNode = node;
    T.entry = { node, fromKey: valid ? T.key : null, inArm: valid ? ed.inArm : null, laneIdx: T.laneIdx, t: now() };
    Player.inNode = { node, inArm: T.entry.inArm };
    if (!valid) return;
    const lane = ed.lanes[0];
    // right-of-way at entry
    if (lane.ctrl === 'stop' || lane.ctrl === 'yield') {
      const majorArms = node.major === 'h' ? ['E', 'W'] : ['N', 'S'];
      for (const c of Traffic.cars) {
        const p = c.chain[0];
        if (!(p.isLane && p.to === node && majorArms.includes(p.ed.inArm))) continue;
        const dist = p.len - c.s - c.L / 2;
        if (c.v > 2 && dist < 32 && dist / c.v < 2.7) { addMistake('vehYield'); break; }
      }
    } else if (lane.ctrl === 'round') {
      const R = CFG.ROUND, te = ARM_ANG[ed.inArm] - R.delta;
      for (const c of Traffic.cars) {
        const p = c.chain[0];
        if (!(p.isConn && p.node === node)) continue;
        if (p.outArm === ed.inArm) continue;
        if (c.s < p.entryLen - 1 || c.v < 2) continue;
        const th = Math.atan2(c.y - node.y, c.x - node.x);
        const diff = U.angNorm(th - te);
        if (diff > -0.2 && diff < 1.25) { addMistake('roundYield'); break; }
      }
    }
  }

  function onNodeExit(newKey) {
    const T = E.trk, en = T.entry;
    T.inNode = null; T.entry = null; Player.inNode = null;
    Render.hint = null;
    const nd = ED(newKey);
    if (!en || !en.fromKey || nd.from !== en.node) {
      T.key = newKey; T.edge = nd.edge;
      return;
    }
    const node = en.node;
    const m = World.maneuver(en.fromKey, newKey);
    const inEd = ED(en.fromKey);
    if (node.type !== 'bend') {
      const since = en.t - 6;
      if (m.kind === 'left' || m.kind === 'right') {
        const side = m.kind === 'left' ? -1 : 1;
        if (!indUsed(side, since)) addMistake(indUsed(-side, since) ? 'indWrong' : side < 0 ? 'indLeft' : 'indRight');
        if (!mirrorSince(en.t - 10)) addMistake('mirror');
        if (inEd.lanes.length === 2 && en.laneIdx >= 0) {
          if ((m.kind === 'left' && en.laneIdx !== 0) || (m.kind === 'right' && en.laneIdx !== 1)) addMistake('wrongLaneTurn');
        }
      } else if (m.kind === 'round') {
        if (!indUsed(1, en.t - 1)) addMistake('indRight');
      } else if (m.kind === 'straight') {
        if (Player.indicator !== 0) addMistake('indWrong');
      }
    }
    T.key = newKey; T.edge = nd.edge; T.stopSeen = false;
    routeExit(newKey);
  }

  /* ---------------- per-frame tracking & rules ---------------- */
  function track(dt) {
    const P = Player, loc = P.loc, T = E.trk, t = now();
    if (P.indicator) E.indLast[P.indicator] = t;

    if (loc.kind === 'edge') {
      const ed = World.edgeDirFor(loc.edge, P.a);
      if (T.inNode) onNodeExit(ed.key);
      if (T.key !== ed.key) {
        // turned around mid-block
        if (T.edge === loc.edge && Math.abs(P.v) > 0.5) {
          T.uturnT = (T.uturnT || 0) + dt;
          if (T.uturnT > 1.5) {
            T.uturnT = 0;
            T.key = ed.key;
            if (E.mode !== 'practice' && E.ri + 1 < E.route.length) {
              addMistake('wrongTurn');
              const det = World.bfs(ed.key, E.route[E.ri + 1]) || [];
              E.route = E.route.slice(0, E.ri).concat([ed.key], det, E.route.slice(E.ri + 2));
              E.announcedIdx = -1;
            } else { E.route = E.route.slice(0, E.ri).concat([ed.key]); extendRoute(); }
          }
        } else if (T.edge !== loc.edge) { T.key = ed.key; T.edge = loc.edge; }
        if (T.key !== ed.key) return;
      } else T.uturnT = 0;
      const lane = ed.lanes[0];
      const f = P.front();
      const frontS = World.laneS(lane, f.x, f.y);
      T.frontS = frontS;
      const ownSide = loc.side === ed.dir;
      const laneIdx = ownSide ? loc.laneIdx : -1;
      const aligned = Math.cos(U.angNorm(P.a - Math.atan2(ed.d.y, ed.d.x))) > 0.8;

      // stop-line events
      if (aligned && ownSide && T.prevFrontS < lane.stopS && frontS >= lane.stopS && P.v > 0.3) {
        if (lane.ctrl === 'light') {
          const st = World.lightState(lane.to, lane.edge.axis);
          if (st === 'R') addMistake('redLight');
          else if (st === 'Y' && World.yellowElapsed(lane.to, lane.edge.axis) > 1.0) addMistake('yellowLight');
        } else if (lane.ctrl === 'stop' && !T.stopSeen) addMistake('stopSign');
      }
      if (lane.ctrl === 'stop' && frontS > lane.stopS - 9 && frontS < lane.stopS + 0.8 && Math.abs(P.v) < 0.4) T.stopSeen = true;

      // lane change on multi-lane roads
      if (ed.lanes.length > 1 && laneIdx >= 0 && T.laneIdx >= 0 && laneIdx !== T.laneIdx && Math.abs(P.v) > 2) {
        const side = laneIdx > T.laneIdx ? 1 : -1;
        if (!indUsed(side, t - 4)) addMistake(side > 0 ? 'indRight' : 'indLeft');
        if (!mirrorSince(t - 8)) addMistake('mirror');
        const ps = World.laneS(lane, P.x, P.y);
        for (const c of Traffic.cars) {
          if (c.chain[0] !== ed.lanes[laneIdx]) continue;
          const rel = c.s - ps;
          if (rel > -13 && rel < 5 && (rel > -4 || c.v > P.v - 0.5)) { addMistake('laneUnsafe'); break; }
        }
      }
      if (laneIdx !== T.laneIdx) T.laneIdx = laneIdx;

      // straddling lane divider
      const nearDivider = ed.lanes.length > 1 && ownSide && Math.abs(Math.abs(loc.lat) - LW) < 0.55;
      if (timer('straddle', nearDivider && P.v > 3 && !(E.task && E.task.def.type === 'lane' && E.task.state === 'active'), dt) > 3.2) { addMistake('straddle'); E.timers.straddle = 0; }

      // wrong side
      const intoOpp = !ownSide && Math.abs(loc.lat) > 1.0;
      const inObstacleZone = loc.edge.id === 'n02-n12' && loc.along > 50 && loc.along < 122;
      const lim = inObstacleZone ? 12 : 2.0;
      if (timer('wrongWay', intoOpp && Math.abs(P.v) > 0.5, dt) > lim) { addMistake('wrongWay'); E.timers.wrongWay = -6; }

      // following distance
      let close = false;
      if (P.v > 6 && laneIdx >= 0) {
        const ps = World.laneS(lane, P.x, P.y);
        for (const c of Traffic.cars) {
          if (c.chain[0] !== ed.lanes[laneIdx]) continue;
          const gap = c.s - c.L / 2 - (ps + P.hl);
          if (gap > 0 && gap / P.v < 0.85) { close = true; break; }
        }
      }
      if (timer('dist', close, dt) > 2.5) { addMistake('distance'); E.timers.dist = 0; }

      T.prevFrontS = frontS;
      E.curEdge = loc.edge;
    } else if (loc.kind === 'node' || loc.kind === 'island') {
      if (!T.inNode && loc.node) onNodeEnter(loc.node);
    }
  }

  function rules(dt) {
    const P = Player, t = now(), loc = P.loc;
    // speed
    const lim = (E.curEdge ? E.curEdge.limit : 50);
    const kmh = Math.abs(P.v) * 3.6;
    if (timer('speedHard', kmh > lim + 20, dt) > 1.0) { addMistake('speedingHard'); E.timers.speedHard = -10; }
    if (timer('speed', kmh > lim + 5, dt) > 2.0) { addMistake('speeding'); E.timers.speed = -8; }

    // collisions
    const hit = P.collidedWith;
    if (hit) {
      const fresh = hit !== E.contactObj || t - E.contactT > 1.5;
      E.contactObj = hit; E.contactT = t;
      if (fresh && (!E.lastHit || t - E.lastHit > 2.5)) {
        E.lastHit = t;
        Sfx.crash();
        if (hit.state !== undefined && hit.path) addMistake('collisionPed');
        else if (hit.isStatic || hit.kind === 'building') addMistake('collisionObj');
        else addMistake('collisionCar');
      }
    }

    // off road / curb / island
    if (loc.kind === 'island') addMistake('island');
    if (timer('off', loc.kind === 'off', dt) > 0.3) { addMistake('offRoad'); E.timers.off = -5; }
    else if (loc.kind !== 'off') {
      let cornerOff = false;
      // corners pulled in slightly: only a real wheel-on-curb counts
      for (const c of U.obbCorners({ x: P.x, y: P.y, a: P.a, hl: P.hl - 0.3, hw: P.hw - 0.25 })) if (!World.onRoad(c.x, c.y)) { cornerOff = true; break; }
      if (timer('curb', cornerOff, dt) > 0.35) { addMistake('curb'); E.timers.curb = -4; }
    }

    // pedestrians on crossings
    const me = P.obb();
    for (const cw of World.crosswalks) {
      if (Math.abs(cw.x - P.x) > 22 || Math.abs(cw.y - P.y) > 22) continue;
      const over = U.obbOverlap(me, { x: cw.x, y: cw.y, a: cw.a, hl: 2.1, hw: cw.hw });
      const rn = cw.edge.rn;
      const myLat = (P.x - cw.x) * rn.x + (P.y - cw.y) * rn.y;
      if (over && Math.abs(P.v) > 0.3) {
        for (const p of Peds.list) {
          if (p.cw !== cw) continue;
          if (p.state === 'cross') {
            const pLat = (p.x - cw.x) * rn.x + (p.y - cw.y) * rn.y;
            if (Math.abs(pLat - myLat) < 5.2 && !p.flagged) { p.flagged = true; addMistake('pedYield'); }
          }
        }
      }
      if (over && !cw.wasOver) {
        cw.wasOver = true;
        if (!cw.signal && P.v > 2.8) {
          // waiting pedestrian on the driver's half of the road (or very close to the driver's path)
          if (Peds.list.some(p => {
            if (p.cw !== cw || p.state !== 'wait' || p.waitT < 0.6) return false;
            const pLat = (p.x - cw.x) * rn.x + (p.y - cw.y) * rn.y;
            return Math.sign(pLat) === Math.sign(myLat) || Math.abs(pLat - myLat) < 6;
          })) addMistake('pedWaiting');
        }
      } else if (!over) cw.wasOver = false;
    }

    // moving off at the start
    if (E.startCheck && Math.abs(P.v) > 0.6) {
      E.startCheck = false;
      if (E.mode !== 'practice' && !mirrorSince(t - 12)) addMistake('mirror');
    }
  }

  E.onConflict = function (car) {
    if (E.finished) return;
    const P = Player, loc = P.loc;
    if (loc.kind === 'node') addMistake(loc.node.type === 'round' ? 'roundYield' : 'vehYield');
    else if (loc.kind === 'edge') {
      const ed = World.edgeDirFor(loc.edge, P.a);
      if (loc.side !== ed.dir) addMistake('oncoming');
      else if (car.chain[0].isConn) addMistake('vehYield');
    }
  };

  /* ---------------- tasks ---------------- */
  function cwFor(def) {
    const e = World.edgeMap[def.cwEdge];
    let best = null, bd = 1e9;
    for (const cw of World.crosswalks) {
      if (cw.edge !== e) continue;
      const d = def.along != null ? Math.abs(cw.along - def.along) : (def.end === 'a' ? cw.along : e.total - cw.along);
      if (d < bd) { bd = d; best = cw; }
    }
    return best;
  }
  function cwS(lane, cw) { return (cw.x - lane.start.x) * lane.d.x + (cw.y - lane.start.y) * lane.d.y - CFG.CW_W / 2; }

  const H = {
    spawn: {
      start(t) {
        for (const s of t.def.spawns) Traffic.spawnOn(s.key, s.lane, s.s, { v: s.v, route: s.route });
        t.state = 'done';
      },
    },
    peds: {
      start(t) {
        const cw = cwFor(t.def);
        for (let i = 0; i < (t.def.count || 1); i++) {
          const p = Peds.spawnCrosser(cw, { atCurb: true, side: i % 2 ? -1 : 1 });
          p.alpha = 1; p.speed = 1.0 + Math.random() * 0.2;
          p.x += (Math.random() - 0.5) * 0.6;
        }
        t.state = 'done';
      },
    },
    reach: {
      start(t) { t.silent = true; },
      update(t) { if (E.trk.key === t.def.key && E.trk.frontS >= t.def.s) t.state = 'done'; },
    },
    lane: {
      start(t) { t.busy = true; say(t.def.toLane > 0 ? TXT.laneRight : TXT.laneLeft, 'lane'); },
      update(t, dt) {
        const T = E.trk;
        if (T.key === t.def.key && T.laneIdx === t.def.toLane && Player.loc.kind === 'edge' && Math.abs(Math.abs(Player.loc.lat) - (t.def.toLane + 0.5) * LW) < 1.0) {
          t.hold = (t.hold || 0) + dt;
          if (t.hold > 1.0) { t.state = 'done'; good(); }
        } else t.hold = 0;
      },
      onNode(t) { addMistake('laneTask'); t.state = 'failed'; },
    },
    stopCw: {
      start(t) {
        t.busy = true; t.cw = cwFor(t.def);
        Render.highlights.push({ type: 'cw', cw: t.cw, owner: t });
        say(TXT.stopCw, 'stop');
      },
      update(t, dt) {
        const T = E.trk;
        if (T.key !== t.def.key) return;
        const lane = ED(T.key).lanes[0];
        const d = cwS(lane, t.cw) - T.frontS;
        if (Math.abs(Player.v) < 0.25 && d > -0.4 && d < 9) {
          t.hold = (t.hold || 0) + dt;
          if (t.hold > 1.0) { t.state = 'done'; good('Добро. Продолжете.'); say('Добро. Продолжете.', 'straight', true); }
        } else if (d < -1.5) { addMistake('stopTask'); t.state = 'failed'; }
      },
      onNode(t) { addMistake('stopTask'); t.state = 'failed'; },
    },
    yieldPed: {
      at(t) { const cw = cwFor(t.def); const lane = ED(t.def.key).lanes[0]; return cwS(lane, cw) - 72; },
      start(t) {
        t.busy = true;
        const cw = t.cw = cwFor(t.def);
        const ed = ED(t.def.key);
        const p = Peds.spawnCrosser(cw, { atCurb: true, side: ed.dir, forced: true,
          trigger: () => Math.hypot(Player.x - cw.x, Player.y - cw.y) < 40 || Math.abs(Player.v) < 0.5 && Math.hypot(Player.x - cw.x, Player.y - cw.y) < 60 });
        p.alpha = 1; p.speed = 1.05;
        t.ped = p;
        Render.highlights.push({ type: 'cw', cw, owner: t });
        say(TXT.yieldPed, 'ped');
      },
      update(t) {
        const lane = ED(t.def.key).lanes[0];
        const passed = E.trk.key !== t.def.key || E.trk.frontS > cwS(lane, t.cw) + 8;
        if (t.ped.done && !t.okSaid) { t.okSaid = true; }
        if (passed) { t.state = 'done'; if (!t.ped.flagged) good(); }
      },
    },
    yieldVeh: {
      start(t) {
        t.busy = true;
        const ed = ED(t.def.key), node = ed.to;
        const d = ed.d, left = { x: d.y, y: -d.x };
        const leftArm = World.armOf(left), rightArm = OPP[leftArm];
        const distP = ed.lanes[0].len - E.trk.frontS;
        const tp = distP / 7 + 3.0;
        const mk = (arm, extraT) => {
          const e = node.arms[arm]; if (!e) return;
          const other = e.a === node ? e.b : e.a;
          const key = other.id + '>' + node.id;
          const lane = ED(key).lanes[0];
          const s = U.clamp(lane.len - 9.5 * (tp + extraT), 4, lane.len - 15);
          const straight = World.nextKeys(key).find(k => World.maneuver(key, k).kind === 'straight');
          Traffic.spawnOn(key, 0, s, { v: 9.5, route: straight ? [straight] : null, speedF: 1 });
        };
        mk(leftArm, 0);
        mk(rightArm, 2.2);
        say(TXT.yieldVeh, 'car');
      },
      onNode(t) { t.inNodeSeen = true; },
      update(t) {
        if (t.inNodeSeen && E.trk.key !== t.def.key && !E.trk.inNode) { t.state = 'done'; if (!E.mistakes.some(m => m.code === 'vehYield')) good(); }
      },
    },
    obstacle: {
      start(t) {
        t.busy = true;
        Traffic.removeOn('n12>n02');
        Traffic.spawnOn('n12>n02', 0, 6, { v: 9.5, speedF: 1 });
        Traffic.spawnOn('n22>n12', 0, 112, { v: 9, route: ['n12>n02'], speedF: 1 });
        say(TXT.obstacle, 'obstacle');
        t.phase = 0;
      },
      update(t, dt) {
        const P = Player, loc = P.loc, van = World.van, now_ = now();
        if (loc.kind !== 'edge' || loc.edge.id !== 'n02-n12') return;
        const opp = loc.lat < -0.6;
        if (t.phase === 0 && opp) {
          t.phase = 1;
          if (!indUsed(-1, now_ - 5)) addMistake('indLeft');
          if (!mirrorSince(now_ - 9)) addMistake('mirror');
        }
        if (P.x > van.x + van.hl + P.hl + 2 && loc.lat > 0.6 && Math.cos(P.a) > 0.9) {
          t.state = 'done';
          if (t.phase === 0) { /* squeezed past without leaving lane — unlikely */ }
          good();
        }
      },
      onNode(t) { addMistake('obstacleTask'); t.state = 'failed'; },
    },
    pullOver: {
      start(t) { t.busy = true; t.t0 = now(); t.phase = 'approach'; say(TXT.pullOver, 'pull'); },
      update(t, dt) {
        const P = Player, loc = P.loc;
        if (t.phase === 'approach') {
          if (Math.abs(P.v) < 0.08 && loc.kind === 'edge' && E.trk.key === t.def.key) {
            t.hold = (t.hold || 0) + dt;
            if (t.hold > 1.0) {
              const ed = ED(t.def.key), e = ed.edge;
              const latDir = loc.lat * ed.dir;
              const hd = Math.abs(U.angNorm(P.a - Math.atan2(ed.d.y, ed.d.x)));
              const gap = e.hw - (latDir + P.hw * Math.cos(hd) + P.hl * Math.sin(hd));
              if (!indUsed(1, t.t0)) addMistake('indRight');
              if (!mirrorSince(t.t0 - 3)) addMistake('mirror');
              if (gap > 0.95 || hd > 0.22) addMistake('pullOver', gap > 0.95 ? 'Предалеку од тротоарот.' : 'Возилото не е паралелно.');
              else good('Добро запревте.');
              t.phase = 'stopped'; t.tStop = now();
            }
          } else t.hold = 0;
        } else if (t.phase === 'stopped') {
          if (E.ti >= E.tasks.length - 1) { t.state = 'done'; return; }
          if (now() - t.tStop > 2.0) { t.phase = 'moveoff'; say(TXT.moveOff, 'flag'); t.tMo = now(); }
        } else if (t.phase === 'moveoff') {
          if (Math.abs(P.v) > 0.6) {
            if (!indUsed(-1, now() - 6)) addMistake('indLeft');
            if (!mirrorSince(t.tMo - 4)) addMistake('mirror');
            t.state = 'done';
            t.busy = false;
          }
        }
      },
      onNode(t) { if (t.phase === 'approach') { addMistake('pullOverMiss'); t.state = 'failed'; } },
    },
    park: {
      start(t) {
        t.busy = true; t.t0 = now();
        const slot = World.bay.slots[World.bay.target];
        t.slot = slot;
        Render.highlights.push({ type: 'rect', x0: slot.x0 + 0.15, y0: slot.y0 - 0.1, x1: slot.x1 - 0.15, y1: slot.y1 - 0.1, owner: t });
        say(TXT.park, 'park');
      },
      update(t, dt) {
        const P = Player;
        if (now() - t.t0 > 150) { addMistake('parkingTime'); t.state = 'failed'; return; }
        if (Math.abs(P.v) < 0.05) {
          t.hold = (t.hold || 0) + dt;
          if (t.hold > 1.4 && !t.checked) {
            t.checked = true;
            const s = t.slot;
            const inside = P.corners().every(c => c.x > s.x0 - 0.45 && c.x < s.x1 + 0.45 && c.y > s.y0 - 0.55 && c.y < s.y1 + 0.2);
            const parallel = Math.abs(Math.sin(P.a)) < 0.13;
            if (inside && parallel) {
              t.state = 'done';
              Render.highlights = Render.highlights.filter(h => h.owner !== t);
              say(TXT.parkOk, 'park');
              Sfx.good();
            } else {
              const nearSlot = Math.abs(P.x - (s.x0 + s.x1) / 2) < 6 && P.y > s.y0 - 3;
              if (nearSlot) UI.toast(inside ? 'Исправете го возилото паралелно со тротоарот.' : 'Возилото не е целосно во означеното место.', 'info');
            }
          }
        } else { t.hold = 0; t.checked = false; }
      },
      onNode(t) { addMistake('parking'); t.state = 'failed'; },
    },
  };

  function updateTasks(dt) {
    // activate pending
    if (!E.task && E.ti < E.tasks.length) {
      const t = E.tasks[E.ti], d = t.def, h = H[d.type];
      const at = h.at ? h.at(t) : (d.at || 0);
      if (E.trk.key === d.key && Player.loc.kind === 'edge' && E.trk.frontS >= at) {
        t.state = 'active'; E.task = t; t.tStart = now();
        h.start(t);
      }
    }
    const t = E.task;
    if (t) {
      const h = H[t.def.type];
      if (t.state === 'active' && h.update) h.update(t, dt);
      if (t.state === 'done' || t.state === 'failed') {
        Render.highlights = Render.highlights.filter(x => x.owner !== t);
        E.task = null; E.ti++;
        // after a task, re-issue the pending turn instruction if the panel shows something else
        if (E.announcedIdx === E.ri && E.turnText && E.instruction.text !== E.turnText && E.ri + 1 < E.route.length) {
          setTimeout(() => { if (!E.finished && E.announcedIdx === E.ri) say(E.turnText, E.turnIcon); }, 1300);
        }
      }
    }
    if (E.ti >= E.tasks.length && !E.task && E.mode !== 'practice' && !E.finished) finish(false);
  }

  E.onNodeEnterTask = function () {
    const t = E.task;
    if (t && t.state === 'active' && H[t.def.type].onNode) H[t.def.type].onNode(t);
  };

  function finish(aborted) {
    if (E.finished) return;
    E.finished = true;
    const crit = E.mistakes.filter(m => m.sev === 'critical').length;
    const passed = !aborted && crit === 0 && E.score >= CFG.SCORING.pass;
    say(aborted ? TXT.aborted : (E.mode === 'exam' ? TXT.examEnd : TXT.scenEnd), aborted ? 'info' : 'flag');
    setTimeout(() => Game.showResults({
      passed, aborted, score: E.score, mistakes: E.mistakes.slice(), critical: crit,
      duration: now() - E.t0, title: E.scen.title, mode: E.mode, scenId: E.scen.id,
    }), aborted ? 600 : 1600);
  }

  E.update = function (dt) {
    if (E.finished) return;
    const wasInNode = !!E.trk.inNode;
    track(dt);
    if (!wasInNode && E.trk.inNode) E.onNodeEnterTask();
    updateNav();
    if (E.mode !== 'practice' || true) updateTasks(dt);
    rules(dt);
    if (E.abortAt && now() >= E.abortAt) finish(true);
    // safety: route exhausted while tasks pending
    if (E.mode !== 'practice' && E.ri >= E.route.length - 1 && E.trk.inNode && E.ti < E.tasks.length) {
      const t = E.tasks[E.ti];
      if (t.state === 'pending' && E.trk.key !== t.def.key) finish(false);
    }
  };

  return E;
})();

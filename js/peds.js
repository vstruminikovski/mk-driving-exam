'use strict';
/* =========================================================================
   PEDESTRIANS — sidewalk walkers and crosswalk users
   ========================================================================= */

const Peds = (() => {
  const LW = CFG.LANE_W;
  const P = { list: [], timer: 0, walkTimer: 0, max: 26 };

  function makePed(path, opts = {}) {
    const p = {
      path, idx: 0, x: path[0].x, y: path[0].y, a: 0,
      speed: opts.speed || (1.15 + Math.random() * 0.35),
      color: U.pick(PAL.peds), hair: U.pick(['#2d2a26', '#5a3e2b', '#c99a5b', '#1e1e1e', '#8a8a8a']),
      phase: Math.random() * 6, state: 'walk', cw: opts.cw || null, crossIdx: opts.crossIdx ?? -1,
      alpha: 0, fade: 1, onRoad: false, forced: !!opts.forced, waitT: 0, trigger: opts.trigger || null, done: false,
    };
    P.list.push(p);
    return p;
  }

  function crossPath(cw, side) {
    const e = cw.edge, rn = e.rn, d = e.d;
    const s = side; // +1 start on rn side
    const curb = cw.hw + 0.7, walk = cw.hw + 1.8;
    const along = (Math.random() < 0.5 ? 1 : -1);
    const ox = (Math.random() - 0.5) * 1.4;
    const cx = cw.x + d.x * ox, cy = cw.y + d.y * ox;
    return [
      { x: cx + rn.x * walk * s + d.x * 9 * along, y: cy + rn.y * walk * s + d.y * 9 * along },
      { x: cx + rn.x * curb * s, y: cy + rn.y * curb * s },
      { x: cx - rn.x * curb * s, y: cy - rn.y * curb * s },
      { x: cx - rn.x * walk * s - d.x * 9 * along, y: cy - rn.y * walk * s - d.y * 9 * along },
    ];
  }

  P.spawnCrosser = function (cw, opts = {}) {
    const side = opts.side || (Math.random() < 0.5 ? 1 : -1);
    const path = crossPath(cw, side);
    if (opts.atCurb) path.shift();
    return makePed(path, Object.assign({ cw, crossIdx: opts.atCurb ? 0 : 1 }, opts));
  };

  function spawnWalker() {
    const pl = Player;
    for (let t = 0; t < 8; t++) {
      const e = U.pick(World.edges);
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = e.hw + 1.75 + (e.bay && side > 0 ? e.bay.depth : 0);
      const a0 = e.s0 + 2, a1 = e.s1 - 2;
      const p0 = { x: e.a.x + e.d.x * a0 + e.rn.x * off * side, y: e.a.y + e.d.y * a0 + e.rn.y * off * side };
      const p1 = { x: e.a.x + e.d.x * a1 + e.rn.x * off * side, y: e.a.y + e.d.y * a1 + e.rn.y * off * side };
      const t0 = Math.random();
      const start = { x: U.lerp(p0.x, p1.x, t0), y: U.lerp(p0.y, p1.y, t0) };
      if (Math.hypot(start.x - pl.x, start.y - pl.y) > 120) continue;
      if (Math.hypot(start.x - pl.x, start.y - pl.y) < 25) continue;
      const end = Math.random() < 0.5 ? p0 : p1;
      // keep roundabout plaza clear
      const n = World.nodes.n22;
      if (Math.hypot(start.x - n.x, start.y - n.y) < 28) continue;
      makePed([start, end]);
      return;
    }
  }

  function spawnCrosserNear() {
    const pl = Player;
    const options = World.crosswalks.filter(cw => {
      const d = Math.hypot(cw.x - pl.x, cw.y - pl.y);
      return d > 30 && d < 130 && Game.time - cw.lastSpawn > 7;
    });
    if (!options.length) return;
    const cw = U.pick(options);
    cw.lastSpawn = Game.time;
    P.spawnCrosser(cw);
  }

  function vehicleThreat(cw) {
    // uncontrolled crosswalk: is any vehicle too close / fast to step out?
    const all = Traffic.cars.map(c => ({ x: c.x, y: c.y, a: c.a, v: c.v })).concat(Player.ghost ? [] : [{ x: Player.x, y: Player.y, a: Player.a, v: Player.v }]);
    for (const c of all) {
      const loc = U.toLocal(c.x, c.y, c.a, cw.x, cw.y);
      if (Math.abs(loc.l) > cw.hw + 3) continue;
      // vehicle body on the crosswalk
      if (Math.abs(loc.f) < 4.5) return true;
      if (loc.f < 0 || loc.f > 45) continue;
      if (c.v < 1.0) continue;
      if (loc.f / c.v < 4.6) return true;
    }
    return false;
  }

  function bodyAhead(p, nx, ny) {
    // vehicle directly in front of the pedestrian (don't walk into cars)
    const check = (x, y, a, hl, hw) => U.obbClear({ x, y, a, hl, hw }, nx, ny) < 0.7;
    if (!Player.ghost && check(Player.x, Player.y, Player.a, Player.hl, Player.hw)) return true;
    for (const c of Traffic.cars) {
      if (Math.abs(c.x - nx) > 6 || Math.abs(c.y - ny) > 6) continue;
      if (check(c.x, c.y, c.a, c.L / 2, c.W / 2)) return true;
    }
    return false;
  }

  function updatePed(p, dt) {
    p.alpha = Math.min(1, p.alpha + dt * 2.5) * p.fade;
    if (p.idx >= p.path.length - 1) {
      p.fade -= dt * 2;
      if (p.fade <= 0) p.dead = true;
      p.alpha = Math.max(0, p.fade);
      return;
    }
    const target = p.path[p.idx + 1];
    // at crosswalk curb → decide
    if (p.cw && p.idx === p.crossIdx && p.state !== 'cross') {
      p.state = 'wait';
      p.waitT += dt;
      let go;
      if (p.forced) go = p.trigger ? p.trigger() : true;
      else if (p.cw.signal) go = World.pedGreen(p.cw) > (2 * p.cw.hw + 1.4) / (p.speed * 1.15) + 0.8;
      else go = !vehicleThreat(p.cw) || p.waitT > 25;
      if (!go) { p.onRoad = false; return; }
      p.state = 'cross';
    }
    const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy);
    let sp = p.speed;
    if (p.state === 'cross') sp *= 1.15;
    if (p.state === 'cross' && p.cw && p.cw.signal && World.pedGreen(p.cw) <= 0) sp *= 1.5; // hurry
    const step = sp * dt;
    const nx = p.x + (dx / d) * Math.min(step + 0.6, d), ny = p.y + (dy / d) * Math.min(step + 0.6, d);
    if (p.state === 'cross' && bodyAhead(p, nx, ny)) { p.phase += 0; return; }
    p.a = Math.atan2(dy, dx);
    if (d <= step) {
      p.x = target.x; p.y = target.y; p.idx++;
      if (p.state === 'cross' && p.idx > p.crossIdx) { p.state = 'walk'; p.done = true; }
    } else {
      p.x += (dx / d) * step; p.y += (dy / d) * step;
    }
    p.phase += dt * sp * 5.5;
    p.onRoad = p.state === 'cross';
  }

  P.reset = function () { P.list = []; P.timer = 1; P.walkTimer = 0; };

  P.populate = function () {
    for (let i = 0; i < 14; i++) spawnWalker();
    for (const p of P.list) p.alpha = 1;
  };

  P.update = function (dt) {
    for (const p of P.list) updatePed(p, dt);
    const pl = Player;
    P.list = P.list.filter(p => !p.dead && (p.forced || Math.hypot(p.x - pl.x, p.y - pl.y) < 170));
    P.timer -= dt;
    if (P.timer <= 0) {
      if (P.list.length < P.max) spawnCrosserNear();
      P.timer = 2.2 + Math.random() * 2.5;
    }
    P.walkTimer -= dt;
    if (P.walkTimer <= 0) {
      if (P.list.filter(p => !p.cw).length < 16) spawnWalker();
      P.walkTimer = 1.0;
    }
  };

  return P;
})();

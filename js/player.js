'use strict';
/* =========================================================================
   PLAYER — candidate vehicle physics (automatic transmission)
   ========================================================================= */

const Player = {
  x: 0, y: 0, a: 0, v: 0, steer: 0,
  L: CFG.PLAYER.L, W: CFG.PLAYER.W,
  indicator: 0, indOnAt: 0, indHeading: 0,
  mirrorT: -99, braking: false, reversing: false,
  loc: { kind: 'off' }, hl: CFG.PLAYER.L / 2, hw: CFG.PLAYER.W / 2,
  collidedWith: null, kind: 'player', isPlayer: true,

  reset(x, y, a) {
    Object.assign(this, { x, y, a, v: 0, steer: 0, indicator: 0, mirrorT: -99, braking: false, reversing: false });
    this.loc = World.locate(x, y);
  },

  setIndicator(side, now) {
    if (this.indicator === side) this.indicator = 0;
    else { this.indicator = side; this.indOnAt = now; this.indHeading = this.a; }
    Sfx.indicatorToggle(this.indicator !== 0);
  },

  checkMirror(now) {
    this.mirrorT = now;
    Sfx.mirror();
  },

  obb() { return { x: this.x, y: this.y, a: this.a, hl: this.hl, hw: this.hw }; },

  update(dt, inp, now) {
    const P = CFG.PLAYER;
    const prev = { x: this.x, y: this.y, a: this.a };
    let v = this.v;
    this.braking = false;
    this.reversing = false;

    // longitudinal (automatic: hold brake at standstill → reverse)
    if (inp.brake) {
      if (v > 0.05) { v = Math.max(0, v - P.brake * 1.2 * dt); this.braking = true; }
      else if (v < -0.05) { v = Math.min(0, v + P.brake * 1.2 * dt); this.braking = true; }
      else { v = 0; this.braking = true; }
    } else if (inp.up && !inp.down) {
      if (v < -0.05) { v = Math.min(0, v + P.brake * dt); this.braking = true; }
      else v += P.accel * (1 - Math.pow(Math.max(v, 0) / P.vmax, 2)) * dt;
    } else if (inp.down && !inp.up) {
      if (v > 0.05) { v = Math.max(0, v - P.brake * dt); this.braking = true; }
      else { v = Math.max(-P.reverseMax, v - 1.8 * dt); this.reversing = true; }
    } else {
      const drag = 0.45 + 0.012 * v * v;
      if (v > 0) v = Math.max(0, v - drag * dt);
      else if (v < 0) v = Math.min(0, v + drag * 2 * dt);
    }
    if (v < 0) this.reversing = true;
    this.v = v;

    // steering
    const speedK = U.clamp(Math.abs(v) / 18, 0, 1);
    const maxSteer = U.lerp(0.62, 0.2, speedK);
    const target = inp.steer * maxSteer;
    const rate = inp.steer !== 0 ? 2.6 : 3.6;
    const d = target - this.steer;
    this.steer += U.clamp(d, -rate * dt, rate * dt);

    // kinematic bicycle
    const omega = (v / P.wheelBase) * Math.tan(this.steer);
    this.a = U.angNorm(this.a + omega * dt);
    this.x += Math.cos(this.a) * v * dt;
    this.y += Math.sin(this.a) * v * dt;

    // indicator self-cancel after completing a turn
    if (this.indicator !== 0) {
      const turned = Math.abs(U.angNorm(this.a - this.indHeading));
      if (turned > 1.1 && Math.abs(this.steer) < 0.08) this.indicator = 0;
    }

    // collisions
    this.collidedWith = null;
    const me = this.obb();
    const hit = Player.findCollision(me);
    const prevObb = { x: prev.x, y: prev.y, a: prev.a, hl: this.hl, hw: this.hw };
    if (hit && Player.findCollision(prevObb) === hit) {
      // already in contact before moving (something drove into us) — allow escaping
    } else if (hit) {
      this.x = prev.x; this.y = prev.y; this.a = prev.a;
      this.v = -this.v * 0.15;
      this.collidedWith = hit;
    }
    this.loc = World.locate(this.x, this.y);
  },

  findCollision(me) {
    for (const c of Traffic.cars) {
      if (Math.abs(c.x - me.x) > 8 || Math.abs(c.y - me.y) > 8) continue;
      if (U.obbOverlap(me, { x: c.x, y: c.y, a: c.a, hl: c.L / 2, hw: c.W / 2 })) return c;
    }
    for (const s of World.statics) {
      if (Math.abs(s.x - me.x) > 8 || Math.abs(s.y - me.y) > 8) continue;
      if (U.obbOverlap(me, s)) return s;
    }
    for (const p of Peds.list) {
      if (Math.abs(p.x - me.x) > 4 || Math.abs(p.y - me.y) > 4) continue;
      if (U.obbClear(me, p.x, p.y) < 0.3) return p;
    }
    for (const b of World.solids) {
      if (Math.abs(b.x - me.x) > b.hl + 4 || Math.abs(b.y - me.y) > b.hw + 4) continue;
      if (U.obbOverlap(me, b)) return b;
    }
    return null;
  },

  corners() { return U.obbCorners(this.obb()); },
  front() { return { x: this.x + Math.cos(this.a) * this.hl, y: this.y + Math.sin(this.a) * this.hl }; },
};

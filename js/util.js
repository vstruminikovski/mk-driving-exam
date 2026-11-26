'use strict';
/* =========================================================================
   UTIL — math, geometry, paths, RNG
   ========================================================================= */

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
  angNorm(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  },
  rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  pick(arr, r = Math.random) { return arr[Math.floor(r() * arr.length) % arr.length]; },
  bezier(p0, p1, p2, p3, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
      out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
    }
    return out;
  },
  // Oriented box: {x,y,a,hl,hw}
  obbAxes(o) {
    const c = Math.cos(o.a), s = Math.sin(o.a);
    return [{ x: c, y: s }, { x: -s, y: c }];
  },
  obbCorners(o) {
    const c = Math.cos(o.a), s = Math.sin(o.a);
    const fx = c * o.hl, fy = s * o.hl, rx = -s * o.hw, ry = c * o.hw;
    return [
      { x: o.x + fx + rx, y: o.y + fy + ry },
      { x: o.x + fx - rx, y: o.y + fy - ry },
      { x: o.x - fx - rx, y: o.y - fy - ry },
      { x: o.x - fx + rx, y: o.y - fy + ry },
    ];
  },
  obbOverlap(a, b) {
    const ca = U.obbCorners(a), cb = U.obbCorners(b);
    const axes = U.obbAxes(a).concat(U.obbAxes(b));
    for (const ax of axes) {
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const p of ca) { const d = p.x * ax.x + p.y * ax.y; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const p of cb) { const d = p.x * ax.x + p.y * ax.y; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      if (amax < bmin || bmax < amin) return false;
    }
    return true;
  },
  // distance from point to OBB surface (0 if inside)
  obbClear(o, px, py) {
    const dx = px - o.x, dy = py - o.y;
    const c = Math.cos(o.a), s = Math.sin(o.a);
    const lx = Math.abs(dx * c + dy * s) - o.hl;
    const ly = Math.abs(-dx * s + dy * c) - o.hw;
    const ex = lx > 0 ? lx : 0, ey = ly > 0 ? ly : 0;
    return Math.hypot(ex, ey);
  },
  // local coords of point relative to pose
  toLocal(x, y, a, px, py) {
    const dx = px - x, dy = py - y, c = Math.cos(a), s = Math.sin(a);
    return { f: dx * c + dy * s, l: -dx * s + dy * c };
  },
};

/* Polyline path with arc-length parametrisation */
class Path {
  constructor(pts) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    this.len = this.cum[this.cum.length - 1];
  }
  at(s) {
    const pts = this.pts, cum = this.cum;
    if (s <= 0) {
      const a = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      return { x: pts[0].x + Math.cos(a) * s, y: pts[0].y + Math.sin(a) * s, a };
    }
    if (s >= this.len) {
      const n = pts.length - 1;
      const a = Math.atan2(pts[n].y - pts[n - 1].y, pts[n].x - pts[n - 1].x);
      const e = s - this.len;
      return { x: pts[n].x + Math.cos(a) * e, y: pts[n].y + Math.sin(a) * e, a };
    }
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1e-6;
    const t = (s - cum[lo]) / seg;
    const p = pts[lo], q = pts[hi];
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, a: Math.atan2(q.y - p.y, q.x - p.x) };
  }
}

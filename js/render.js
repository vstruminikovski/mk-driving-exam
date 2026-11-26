'use strict';
/* =========================================================================
   RENDER — minimalist top-down city on HTML5 Canvas
   ========================================================================= */

const Render = (() => {
  const LW = CFG.LANE_W, SW = CFG.SIDEWALK_W;
  let cv, ctx, dpr = 1, w = 0, h = 0;
  const cam = { x: 0, y: 0, scale: 9, ax: 0, ay: 0 };
  const view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const R = { cam, hint: null, highlights: [], mirrorFlash: -99, zoom: 1, anchorY: 0.5 };
  let sortedBuildings = [];
  let time = 0;

  R.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    window.addEventListener('resize', R.resize);
    R.resize();
    const all = [];
    for (const b of World.blocks) all.push(...b.buildings);
    all.push(...World.outerBuildings);
    sortedBuildings = all.sort((a, b) => (a.y + a.h) - (b.y + b.h));
  };
  R.resize = function () {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
  };

  R.updateCamera = function (dt, instant) {
    const P = Player;
    const base = Math.min(w, h) / 78;
    const sp = Math.abs(P.v);
    const targetScale = U.clamp(base * R.zoom * (1 - Math.min(sp / 16, 1) * 0.18), 3.5, 16);
    const look = Math.min(sp, 18) * 1.25 * Math.sign(P.v || 1);
    const tx = P.x + Math.cos(P.a) * look, ty = P.y + Math.sin(P.a) * look;
    const k = instant ? 1 : 1 - Math.exp(-dt * 3.5);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    cam.scale += (targetScale - cam.scale) * (instant ? 1 : 1 - Math.exp(-dt * 2));
    cam.ax = w / 2; cam.ay = h * R.anchorY;
  };

  /* ---------- helpers ---------- */
  function rr(x, y, ww, hh, r) {
    r = Math.min(r, ww / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, r);
    ctx.arcTo(x + ww, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + ww, y, r);
    ctx.closePath();
  }
  function fillRR(x, y, ww, hh, r, c) { ctx.fillStyle = c; rr(x, y, ww, hh, r); ctx.fill(); }
  function circle(x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  const vis = (x0, y0, x1, y1) => x1 >= view.x0 && x0 <= view.x1 && y1 >= view.y0 && y0 <= view.y1;
  const visP = (x, y, m) => x + m >= view.x0 && x - m <= view.x1 && y + m >= view.y0 && y - m <= view.y1;
  const textAng = d => Math.atan2(d.x, -d.y);

  /* ---------- ground & roads ---------- */
  function drawGround() {
    const { XS, YS } = CFG;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(view.x0 - 2, view.y0 - 2, view.x1 - view.x0 + 4, view.y1 - view.y0 + 4);
    const minX = XS[0] - LW, maxX = XS[3] + LW, minY = YS[0] - LW, maxY = YS[3] + LW;
    fillRR(minX - SW, minY - SW, maxX - minX + 2 * SW, maxY - minY + 2 * SW, 12, PAL.sidewalk);
    const bay = World.bay;
    fillRR(bay.x0 - 7, bay.y0, bay.x1 - bay.x0 + 14, bay.depth + SW, 3, PAL.sidewalk);
    fillRR(minX - 0.35, minY - 0.35, maxX - minX + 0.7, maxY - minY + 0.7, 8.35, PAL.curb);
    fillRR(bay.x0 - 0.35, bay.y0 - 1, bay.x1 - bay.x0 + 0.7, bay.depth + 1.35, 0.8, PAL.curb);
    fillRR(minX, minY, maxX - minX, maxY - minY, 8, PAL.asphalt);
    fillRR(bay.x0, bay.y0 - 1, bay.x1 - bay.x0, bay.depth + 1, 0.6, PAL.asphaltDark);

    for (const b of World.blocks) {
      if (!vis(b.x0, b.y0, b.x1, b.y1)) continue;
      fillRR(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, CFG.FILLET_R, PAL.curb);
      fillRR(b.x0 + 0.35, b.y0 + 0.35, b.x1 - b.x0 - 0.7, b.y1 - b.y0 - 0.7, CFG.FILLET_R - 0.35, PAL.sidewalk);
      const I = b.I;
      fillRR(I.x0, I.y0, I.x1 - I.x0, I.y1 - I.y0, 2.5, b.kind === 'park' ? PAL.park : PAL.courtyard);
      if (b.kind === 'park') drawPark(b);
      for (const lot of b.lots) {
        fillRR(lot.x0, lot.y0, lot.x1 - lot.x0, lot.y1 - lot.y0, 1.2, '#c4c8cf');
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.14;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const x = lot.x0 + 0.35 + k * 6.3;
          ctx.moveTo(x, lot.y0 + 0.5); ctx.lineTo(x, lot.y0 + 5.6);
          ctx.moveTo(x, lot.y1 - 0.5); ctx.lineTo(x, lot.y1 - 5.6);
        }
        ctx.stroke();
      }
    }
    // roundabout
    const n = World.nodes.n22, RD = CFG.ROUND;
    if (visP(n.x, n.y, 30)) {
      circle(n.x, n.y, RD.outer + SW, PAL.sidewalk);
      circle(n.x, n.y, RD.outer + 0.35, PAL.curb);
      circle(n.x, n.y, RD.outer, PAL.asphalt);
      ctx.fillStyle = PAL.asphalt;
      ctx.fillRect(n.x - LW, n.y - RD.box - 2, 2 * LW, 2 * RD.box + 4);
      ctx.fillRect(n.x - RD.box - 2, n.y - LW, 2 * RD.box + 4, 2 * LW);
      ctx.strokeStyle = PAL.curb; ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = Math.sqrt(RD.outer * RD.outer - LW * LW);
        ctx.moveTo(n.x + sx * (LW + 0.17), n.y + sy * a); ctx.lineTo(n.x + sx * (LW + 0.17), n.y + sy * (RD.box + 0.3));
        ctx.moveTo(n.x + sx * a, n.y + sy * (LW + 0.17)); ctx.lineTo(n.x + sx * (RD.box + 0.3), n.y + sy * (LW + 0.17));
      }
      ctx.stroke();
      circle(n.x, n.y, RD.island + 1.2, '#6b7280');
      circle(n.x, n.y, RD.island + 0.4, PAL.curb);
      circle(n.x, n.y, RD.island, '#9fd08a');
      circle(n.x, n.y, RD.island - 2.2, '#b4dd9c');
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        circle(n.x + Math.cos(a) * 4.6, n.y + Math.sin(a) * 4.6, 0.55, i % 2 ? '#ff8fab' : '#ffd166');
      }
    }
  }

  function drawPark(b) {
    for (const p of b.paths) fillRR(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0, 1.5, PAL.parkPath);
    if (b.plaza) {
      circle(b.plaza.x, b.plaza.y, b.plaza.r, PAL.parkPath);
      circle(b.plaza.x, b.plaza.y, 4.2, '#d7cdb2');
      circle(b.plaza.x, b.plaza.y, 3.6, PAL.water);
      circle(b.plaza.x, b.plaza.y, 1.2, '#c4ecf7');
    }
    for (const p of b.ponds) {
      ctx.fillStyle = '#7fbfd6';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx + 0.6, p.ry + 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.water;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.ellipse(p.x - 3, p.y - 2, 4, 1.4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    for (const be of b.benches || []) {
      ctx.save(); ctx.translate(be.x, be.y); ctx.rotate(be.a);
      fillRR(-0.9, -0.3, 1.8, 0.6, 0.15, '#b08a5a');
      ctx.restore();
    }
  }

  function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

  function drawMarkings() {
    ctx.lineCap = 'butt';
    for (const e of World.edges) {
      const P = (al, lat) => ({ x: e.a.x + e.d.x * al + e.rn.x * lat, y: e.a.y + e.d.y * al + e.rn.y * lat });
      const pa = P(e.s0, 0), pb = P(e.s1, 0);
      if (!vis(Math.min(pa.x, pb.x) - 8, Math.min(pa.y, pb.y) - 8, Math.max(pa.x, pb.x) + 8, Math.max(pa.y, pb.y) + 8)) continue;
      ctx.strokeStyle = PAL.marking;
      const seg = (a0, a1, lat, dash, lw) => {
        if (a1 <= a0) return;
        const p0 = P(a0, lat), p1 = P(a1, lat);
        ctx.lineWidth = lw;
        ctx.setLineDash(dash || []);
        line(p0.x, p0.y, p1.x, p1.y);
      };
      if (e.n === 1) {
        const la = e.a.type === 'bend' ? 0 : 14, lb = e.b.type === 'bend' ? 0 : 14;
        seg(e.s0 + la, e.s1 - lb, 0, [3, 4], 0.17);
        seg(e.s0, e.s0 + la, 0, null, 0.17);
        seg(e.s1 - lb, e.s1, 0, null, 0.17);
      } else {
        seg(e.s0, e.s1, -0.18, null, 0.15);
        seg(e.s0, e.s1, 0.18, null, 0.15);
        seg(e.s0, e.s1 - 26, LW, [3, 4], 0.16);
        seg(e.s1 - 26, e.s1, LW, null, 0.16);
        seg(e.s0 + 26, e.s1, -LW, [3, 4], 0.16);
        seg(e.s0, e.s0 + 26, -LW, null, 0.16);
      }
      ctx.setLineDash([]);
      // bay markings
      if (e.bay) {
        const b = e.bay;
        ctx.strokeStyle = PAL.markingDim; ctx.lineWidth = 0.13;
        ctx.beginPath();
        for (let k = 0; k <= b.slots.length; k++) {
          const x = b.x0 + k * 7;
          ctx.moveTo(x, b.y0 - 0.3); ctx.lineTo(x, b.y1);
        }
        ctx.moveTo(b.x0, b.y0 - 0.3); ctx.lineTo(b.x1, b.y0 - 0.3);
        ctx.stroke();
      }
    }
    // stop lines / yield teeth / turn arrows
    for (const ed of Object.values(World.edgeDirs)) {
      for (const lane of ed.lanes) {
        const s = lane.stopS;
        const c = lane.path.at(s);
        if (!visP(c.x, c.y, 12)) continue;
        const ctrl = lane.ctrl;
        if (ctrl === 'light' || ctrl === 'stop') {
          ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.atan2(lane.d.y, lane.d.x));
          ctx.fillStyle = PAL.marking; ctx.fillRect(-0.25, -LW / 2, 0.5, LW);
          if (ctrl === 'light') {
            const st = World.lightState(lane.to, lane.edge.axis);
            ctx.fillStyle = st === 'G' ? 'rgba(46,213,115,0.55)' : st === 'Y' ? 'rgba(255,190,40,0.6)' : 'rgba(255,71,87,0.6)';
            ctx.fillRect(-0.55, -LW / 2 + 0.25, 0.5, LW - 0.5);
          }
          ctx.restore();
          if (ctrl === 'stop') {
            const t = lane.path.at(s - 4.5);
            ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(textAng(lane.d));
            ctx.fillStyle = PAL.marking; ctx.font = 'bold 1.9px Manrope, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.scale(1, 1.6); ctx.fillText('STOP', 0, 0);
            ctx.restore();
          }
        } else if (ctrl === 'yield' || ctrl === 'round') {
          const t = lane.path.at(lane.len - 0.6);
          ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(Math.atan2(lane.d.y, lane.d.x));
          ctx.fillStyle = PAL.marking;
          for (let k = -1; k <= 1; k++) {
            const y = k * 1.1;
            ctx.beginPath(); ctx.moveTo(0.3, y - 0.42); ctx.lineTo(0.3, y + 0.42); ctx.lineTo(-0.7, y); ctx.closePath(); ctx.fill();
          }
          ctx.restore();
        }
        if (lane.n === 2 && ctrl === 'light') {
          const t = lane.path.at(lane.stopS - 14);
          drawArrow(t.x, t.y, lane.d, lane.i === 0 ? 'left' : 'right');
        }
      }
    }
    // crosswalks
    ctx.fillStyle = PAL.marking;
    for (const cw of World.crosswalks) {
      if (!visP(cw.x, cw.y, 16)) continue;
      ctx.save(); ctx.translate(cw.x, cw.y); ctx.rotate(cw.a);
      for (let y = -cw.hw + 0.45; y < cw.hw - 0.3; y += 1.05) ctx.fillRect(-2, y, 4, 0.55);
      ctx.restore();
    }
    // roundabout splitter islands
    const n = World.nodes.n22;
    if (visP(n.x, n.y, 30)) {
      for (const arm of ['N', 'E', 'S', 'W']) {
        const v = World.ARMV[arm];
        ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(Math.atan2(v.y, v.x));
        ctx.fillStyle = 'rgba(246,243,234,0.85)';
        ctx.beginPath(); ctx.moveTo(16.4, 0); ctx.quadraticCurveTo(19.5, -0.6, 23.5, 0); ctx.quadraticCurveTo(19.5, 0.6, 16.4, 0); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(246,243,234,0.35)'; ctx.lineWidth = 0.14; ctx.setLineDash([2, 2.5]);
      ctx.beginPath(); ctx.arc(n.x, n.y, CFG.ROUND.rc, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawArrow(x, y, d, kind) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(textAng(d));
    ctx.strokeStyle = 'rgba(246,243,234,0.85)'; ctx.fillStyle = 'rgba(246,243,234,0.85)';
    ctx.lineWidth = 0.32; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 2.6); ctx.lineTo(0, -1.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -2.5); ctx.lineTo(-0.6, -1.3); ctx.lineTo(0.6, -1.3); ctx.closePath(); ctx.fill();
    const sx = kind === 'left' ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(0, 1.0); ctx.quadraticCurveTo(0, -0.2, sx * 1.0, -0.2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx * 1.75, -0.2); ctx.lineTo(sx * 0.95, -0.75); ctx.lineTo(sx * 0.95, 0.35); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ---------- guidance overlays ---------- */
  function drawHint() {
    const hn = R.hint;
    if (!hn || !hn.pts || hn.pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(80,200,255,0.22)'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(hn.pts[0].x, hn.pts[0].y);
    for (const p of hn.pts) ctx.lineTo(p.x, p.y);
    ctx.stroke();
    // chevrons
    const path = new Path(hn.pts);
    const off = (time * 6) % 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 0.32;
    for (let s = off; s < path.len - 1; s += 4) {
      const p = path.at(s);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.beginPath(); ctx.moveTo(-0.5, -0.7); ctx.lineTo(0.3, 0); ctx.lineTo(-0.5, 0.7); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHighlights() {
    for (const hl of R.highlights) {
      const pulse = 0.55 + 0.45 * Math.sin(time * 4);
      if (hl.type === 'rect') {
        ctx.save();
        ctx.fillStyle = `rgba(80,200,255,${0.14 + 0.1 * pulse})`;
        rr(hl.x0, hl.y0, hl.x1 - hl.x0, hl.y1 - hl.y0, 0.5); ctx.fill();
        ctx.strokeStyle = `rgba(80,200,255,${0.6 + 0.4 * pulse})`; ctx.lineWidth = 0.25; ctx.setLineDash([0.8, 0.6]);
        ctx.stroke(); ctx.setLineDash([]);
        ctx.restore();
      } else if (hl.type === 'cw') {
        ctx.save(); ctx.translate(hl.cw.x, hl.cw.y); ctx.rotate(hl.cw.a);
        ctx.strokeStyle = `rgba(255,200,60,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 0.3;
        rr(-2.3, -hl.cw.hw, 4.6, hl.cw.hw * 2, 0.4); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* ---------- vehicles ---------- */
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  const shadeCache = {};
  const sh = (hex, k) => shadeCache[hex + k] || (shadeCache[hex + k] = shade(hex, k));

  function drawVehicle(x, y, a, L, Wd, color, o = {}) {
    // shadow
    ctx.save();
    ctx.translate(x + 0.35, y + 0.5); ctx.rotate(a);
    fillRR(-L / 2, -Wd / 2, L, Wd, 0.6, PAL.shadow);
    ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    if (o.player) {
      ctx.fillStyle = 'rgba(80,170,255,0.20)';
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.85, Wd * 1.25, 0, 0, Math.PI * 2); ctx.fill();
    }
    const van = o.type === 'van';
    fillRR(-L / 2, -Wd / 2, L, Wd, van ? 0.4 : 0.62, sh(color, -0.18));
    fillRR(-L / 2 + 0.08, -Wd / 2 + 0.08, L - 0.16, Wd - 0.16, van ? 0.35 : 0.56, color);
    // glass + roof
    const glass = '#2f3b4c';
    if (van) {
      fillRR(L / 2 - 1.35, -Wd / 2 + 0.2, 0.55, Wd - 0.4, 0.15, glass);
      fillRR(-L / 2 + 0.25, -Wd / 2 + 0.2, L - 1.75, Wd - 0.4, 0.25, sh(color, 0.18));
    } else {
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.moveTo(L * 0.30, -Wd / 2 + 0.22); ctx.lineTo(L * 0.14, -Wd / 2 + 0.3); ctx.lineTo(L * 0.14, Wd / 2 - 0.3); ctx.lineTo(L * 0.30, Wd / 2 - 0.22);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-L * 0.36, -Wd / 2 + 0.26); ctx.lineTo(-L * 0.26, -Wd / 2 + 0.32); ctx.lineTo(-L * 0.26, Wd / 2 - 0.32); ctx.lineTo(-L * 0.36, Wd / 2 - 0.26);
      ctx.closePath(); ctx.fill();
      fillRR(-L * 0.26, -Wd / 2 + 0.3, L * 0.40, Wd - 0.6, 0.3, sh(color, 0.16));
    }
    if (o.player) {
      fillRR(-0.35, -0.42, 0.75, 0.84, 0.12, '#ffd43b');
      ctx.fillStyle = '#1c3d7a'; ctx.font = 'bold 0.62px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillText('Л', 0, 0.03); ctx.restore();
    }
    // lights
    ctx.fillStyle = '#fff6d6';
    ctx.fillRect(L / 2 - 0.22, -Wd / 2 + 0.18, 0.18, 0.42);
    ctx.fillRect(L / 2 - 0.22, Wd / 2 - 0.6, 0.18, 0.42);
    const brake = o.brake;
    ctx.fillStyle = brake ? '#ff3b3b' : '#b8323a';
    ctx.fillRect(-L / 2 + 0.04, -Wd / 2 + 0.18, 0.18, 0.4);
    ctx.fillRect(-L / 2 + 0.04, Wd / 2 - 0.58, 0.18, 0.4);
    if (brake) {
      ctx.fillStyle = 'rgba(255,60,60,0.28)';
      ctx.beginPath(); ctx.arc(-L / 2 - 0.2, -Wd / 2 + 0.4, 0.6, 0, Math.PI * 2); ctx.arc(-L / 2 - 0.2, Wd / 2 - 0.4, 0.6, 0, Math.PI * 2); ctx.fill();
    }
    if (o.reverse) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(-L / 2 + 0.04, -0.2, 0.16, 0.4);
    }
    const blink = Math.floor(time * 2.6) % 2 === 0;
    if (blink && (o.ind || o.hazard)) {
      ctx.fillStyle = '#ffa502';
      const sides = o.hazard ? [-1, 1] : [o.ind];
      for (const sd of sides) {
        const yy = sd * (Wd / 2 - 0.12);
        ctx.beginPath(); ctx.arc(L / 2 - 0.3, yy, 0.24, 0, Math.PI * 2); ctx.arc(-L / 2 + 0.3, yy, 0.24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,165,2,0.25)';
        ctx.beginPath(); ctx.arc(L / 2 - 0.3, yy, 0.75, 0, Math.PI * 2); ctx.arc(-L / 2 + 0.3, yy, 0.75, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffa502';
      }
    }
    ctx.restore();
  }

  function drawPed(p) {
    if (p.alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(p.x, p.y); ctx.rotate(p.a);
    const k = 1.45;
    ctx.scale(k, k);
    circle(0.12, 0.16, 0.36, PAL.shadow);
    const sw = Math.sin(p.phase) * 0.22 * (p.state === 'wait' ? 0 : 1);
    circle(sw, -0.13, 0.1, '#3a3f4b');
    circle(-sw, 0.13, 0.1, '#3a3f4b');
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.17, 0.3, 0, 0, Math.PI * 2); ctx.fill();
    circle(0.02, 0, 0.14, p.hair);
    ctx.restore();
    if (p.state === 'wait' && !(p.cw && p.cw.signal)) {
      const pulse = (time * 1.4) % 1;
      ctx.strokeStyle = `rgba(255,190,40,${0.7 * (1 - pulse)})`; ctx.lineWidth = 0.18;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.7 + pulse * 1.3, 0, Math.PI * 2); ctx.stroke();
    }
  }

  /* ---------- trees & buildings ---------- */
  function drawTrees() {
    for (const t of World.trees) if (visP(t.x, t.y, t.r + 2)) circle(t.x + t.r * 0.35, t.y + t.r * 0.45, t.r, 'rgba(30,50,30,0.17)');
    for (const t of World.trees) {
      if (!visP(t.x, t.y, t.r + 1)) continue;
      circle(t.x, t.y, t.r, t.c);
      circle(t.x - t.r * 0.22, t.y - t.r * 0.25, t.r * 0.62, 'rgba(255,255,255,0.13)');
    }
  }

  function drawBuilding(b) {
    const off = b.height * 0.28;
    if (!vis(b.x - 1, b.y - off - 1, b.x + b.w + off, b.y + b.h + 3)) return;
    fillRR(b.x + 0.9, b.y + 0.2, b.w + Math.min(off * 0.22, 1.6), b.h + 0.9, 1.2, 'rgba(30,35,50,0.13)');
    fillRR(b.x, b.y, b.w, b.h, 0.9, b.pal.wall);
    // windows on visible façade
    const floors = Math.max(1, Math.round(b.height / 3.4));
    const fh = off / floors;
    ctx.fillStyle = 'rgba(255,255,255,0.33)';
    for (let f = 0; f < floors; f++) {
      const y = b.y + b.h - off + f * fh + fh * 0.3;
      for (let x = b.x + 1.0; x < b.x + b.w - 1.4; x += 2.6) ctx.fillRect(x, y, 1.3, Math.max(fh * 0.42, 0.25));
    }
    const ry = b.y - off;
    fillRR(b.x, ry, b.w, b.h, 0.9, b.pal.roof);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.22;
    rr(b.x + 0.7, ry + 0.7, b.w - 1.4, b.h - 1.4, 0.5); ctx.stroke();
    const r = U.rng(b.seed);
    if (b.detail === 0) {
      fillRR(b.x + b.w * 0.2, ry + b.h * 0.25, 2.2, 1.6, 0.25, sh(b.pal.roof, -0.12));
      fillRR(b.x + b.w * 0.6, ry + b.h * 0.55, 1.6, 1.6, 0.25, sh(b.pal.roof, -0.12));
    } else if (b.detail === 1) {
      fillRR(b.x + 1.6, ry + 1.6, b.w - 3.2, b.h - 3.2, 0.8, '#9ccf86');
      for (let i = 0; i < 4; i++) circle(b.x + 2.5 + r() * (b.w - 5), ry + 2.5 + r() * (b.h - 5), 0.9, '#6fb35a');
    } else if (b.detail === 2) {
      fillRR(b.x + b.w / 2 - 2, ry + b.h / 2 - 1.5, 4, 3, 0.3, 'rgba(120,180,220,0.55)');
    } else {
      ctx.fillStyle = sh(b.pal.roof, -0.08);
      for (let x = b.x + 1.5; x < b.x + b.w - 2; x += 3) ctx.fillRect(x, ry + 1.4, 1.6, b.h - 2.8);
    }
  }

  /* ---------- signals & signs ---------- */
  function drawLights() {
    for (const lp of World.lightPoles) {
      if (!visP(lp.pos.x, lp.pos.y, 12)) continue;
      const st = World.lightState(lp.node, lp.axis);
      const lane = lp.lane, e = lp.ed.edge;
      ctx.save(); ctx.translate(lp.pos.x, lp.pos.y); ctx.rotate(Math.atan2(lane.d.y, lane.d.x));
      const reach = -(e.hw + 0.9) + (e.n === 2 ? LW : LW / 2);
      ctx.strokeStyle = '#3d4250'; ctx.lineWidth = 0.28; ctx.lineCap = 'round';
      line(0, 0, 0, reach);
      circle(0.15, 0.2, 0.42, PAL.shadow);
      circle(0, 0, 0.36, '#3d4250');
      ctx.translate(0, reach);
      fillRR(-1.45, -0.6, 2.9, 1.2, 0.45, '#2b2f3a');
      const lamps = [['R', 0.9, '#ff4757'], ['Y', 0, '#ffbe28'], ['G', -0.9, '#2ed573']];
      for (const [k, x, col] of lamps) {
        const on = st === k;
        if (on) circle(x, 0, 1.25, hexA(col, 0.28));
        circle(x, 0, 0.36, on ? col : '#454b58');
      }
      ctx.restore();
    }
    // pedestrian signals
    for (const cw of World.crosswalks) {
      if (!cw.signal || !visP(cw.x, cw.y, 14)) continue;
      const g = World.pedGreen(cw) > 0;
      for (const sd of [1, -1]) {
        const x = cw.x + cw.edge.rn.x * (cw.hw + 1.0) * sd + cw.edge.d.x * 2.9 * sd;
        const y = cw.y + cw.edge.rn.y * (cw.hw + 1.0) * sd + cw.edge.d.y * 2.9 * sd;
        fillRR(x - 0.4, y - 0.4, 0.8, 0.8, 0.15, '#2b2f3a');
        circle(x, y, 0.24, g ? '#2ed573' : '#ff4757');
      }
    }
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function drawSigns() {
    const S = 1.0;
    for (const s of World.signs) {
      if (!visP(s.x, s.y, 3)) continue;
      circle(s.x + 0.2, s.y + 0.35, 0.3, PAL.shadow);
      ctx.save(); ctx.translate(s.x, s.y);
      switch (s.kind) {
        case 'limit':
          circle(0, 0, S, '#ffffff'); ctx.strokeStyle = '#e03131'; ctx.lineWidth = 0.22;
          ctx.beginPath(); ctx.arc(0, 0, S - 0.12, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#1e1e1e'; ctx.font = 'bold 0.85px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(s.val), 0, 0.05);
          break;
        case 'stop': {
          ctx.fillStyle = '#e03131'; ctx.beginPath();
          for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(Math.cos(a) * S, Math.sin(a) * S); }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.1; ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 0.52px Manrope, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('STOP', 0, 0.03);
          break;
        }
        case 'yield':
          ctx.fillStyle = '#e03131'; ctx.beginPath(); ctx.moveTo(-S, -0.7); ctx.lineTo(S, -0.7); ctx.lineTo(0, 1.0); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-0.62, -0.48); ctx.lineTo(0.62, -0.48); ctx.lineTo(0, 0.58); ctx.closePath(); ctx.fill();
          break;
        case 'priority':
          ctx.rotate(Math.PI / 4);
          fillRR(-0.72, -0.72, 1.44, 1.44, 0.1, '#ffffff');
          fillRR(-0.5, -0.5, 1.0, 1.0, 0.06, '#fcc419');
          break;
        case 'cw':
          fillRR(-0.85, -0.85, 1.7, 1.7, 0.18, '#1971c2');
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -0.62); ctx.lineTo(0.66, 0.55); ctx.lineTo(-0.66, 0.55); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#1e1e1e'; circle(0, -0.12, 0.12, '#1e1e1e'); ctx.fillRect(-0.06, 0, 0.12, 0.38);
          break;
        case 'round':
          circle(0, 0, S, '#1971c2');
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.17;
          for (let i = 0; i < 3; i++) {
            const a0 = i * 2.094 + 0.3;
            ctx.beginPath(); ctx.arc(0, 0, 0.52, a0, a0 + 1.4); ctx.stroke();
            const ax = Math.cos(a0) * 0.52, ay = Math.sin(a0) * 0.52;
            circle(ax, ay, 0.13, '#fff');
          }
          break;
      }
      ctx.restore();
    }
  }

  function drawMirrorFlash() {
    const t = time - R.mirrorFlash;
    if (t > 1.6) return;
    const P = Player, a = 1 - t / 1.6;
    const all = Traffic.cars.map(c => ({ x: c.x, y: c.y, L: c.L }));
    for (const c of all) {
      const l = U.toLocal(P.x, P.y, P.a, c.x, c.y);
      if (l.f > 2 || l.f < -45 || Math.abs(l.l) > 9) continue;
      ctx.strokeStyle = `rgba(80,200,255,${0.85 * a})`; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.L * 0.75 + t * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(80,200,255,${0.35 * a})`; ctx.lineWidth = 0.25;
    ctx.beginPath();
    ctx.moveTo(P.x, P.y);
    ctx.arc(P.x, P.y, 28, P.a + Math.PI - 0.32, P.a + Math.PI + 0.32);
    ctx.closePath(); ctx.stroke();
  }

  /* ---------- frame ---------- */
  R.draw = function (t) {
    time = t;
    const s = cam.scale;
    view.x0 = cam.x - cam.ax / s; view.x1 = cam.x + (w - cam.ax) / s;
    view.y0 = cam.y - cam.ay / s - 8; view.y1 = cam.y + (h - cam.ay) / s + 8;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.ax - cam.x * s), dpr * (cam.ay - cam.y * s));

    drawGround();
    drawMarkings();
    drawHighlights();
    drawHint();

    // decorative parked cars
    for (const c of World.decorCars) if (visP(c.x, c.y, 4)) drawVehicle(c.x, c.y, c.a, c.L, c.W, c.color);
    for (const c of World.statics) if (visP(c.x, c.y, 5)) drawVehicle(c.x, c.y, c.a, c.L, c.W, c.color, { type: c.kind, hazard: c.hazard });
    for (const c of Traffic.cars) if (visP(c.x, c.y, 6)) drawVehicle(c.x, c.y, c.a, c.L, c.W, c.color, { type: c.type, brake: c.braking, ind: c.ind });
    const P = Player;
    if (!P.ghost) drawVehicle(P.x, P.y, P.a, P.L, P.W, '#f8f9fb', { player: true, brake: P.braking || (Math.abs(P.v) < 0.05), ind: P.indicator, reverse: P.reversing });
    for (const p of Peds.list) if (visP(p.x, p.y, 2)) drawPed(p);
    drawMirrorFlash();

    drawTrees();
    for (const b of sortedBuildings) drawBuilding(b);
    drawLights();
    drawSigns();
  };

  return R;
})();

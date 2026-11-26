'use strict';
/* =========================================================================
   MAIN — game state machine and loop
   ========================================================================= */

const Game = {
  state: 'menu', time: 0, lastScen: null, lastMode: null, last: 0, lastBlink: 0, menuT: 0,

  init() {
    Speech.init();
    Render.init(document.getElementById('game'));
    UI.init();
    Settings.apply();
    Game.toMenu();
    requestAnimationFrame(ts => { Game.last = ts; requestAnimationFrame(Game.frame); });
    window.addEventListener('pointerdown', () => Sfx.unlock(), { once: true });
  },

  toMenu() {
    Speech.stop();
    Game.state = 'menu';
    World.resetLights();
    Player.ghost = true;
    Player.reset(255, 150, 0);
    Player.loc = { kind: 'off' };
    Traffic.reset(); Peds.reset();
    Traffic.populate(); Peds.populate();
    Render.hint = null; Render.highlights = [];
    Render.updateCamera(0, true);
    UI.show('menu');
  },

  start(mode, scen) {
    Speech.stop();
    Game.lastScen = scen; Game.lastMode = mode;
    World.resetLights();
    if (scen.light) World.setLightPhase(World.nodes[scen.light.node], scen.light.phase, scen.light.el);
    Traffic.reset(); Peds.reset();
    const ed = World.edgeDirs[scen.start.key];
    const lane = ed.lanes[Math.min(scen.start.lane, ed.lanes.length - 1)];
    const p = lane.path.at(scen.start.s);
    Player.ghost = false;
    Player.reset(p.x, p.y, p.a);
    Traffic.populate(); Peds.populate();
    Object.assign(UI.input, { up: false, down: false, brake: false, steerL: false, steerR: false });
    Exam.start(mode, scen);
    document.getElementById('scenTitle').textContent = mode === 'practice' ? 'Вежбање' : scen.title;
    document.getElementById('hud').classList.toggle('practice', mode === 'practice');
    Render.updateCamera(0, true);
    Game.state = 'playing';
    UI.show(null);
  },

  restart() { if (Game.lastScen) Game.start(Game.lastMode, Game.lastScen); else Game.toMenu(); },
  pause() { if (Game.state !== 'playing') return; Game.state = 'paused'; UI.show('pause'); },
  resume() {
    if (Game.state !== 'paused') return;
    Object.assign(UI.input, { up: false, down: false, brake: false, steerL: false, steerR: false });
    Game.state = 'playing'; UI.show(null);
  },
  mirror() {
    if (Game.state !== 'playing') return;
    Player.checkMirror(Game.time);
    Render.mirrorFlash = Game.time;
  },

  showResults(r) {
    if (Game.state !== 'playing') return;
    Game.state = 'results';
    UI.showResults(r);
    if (r.passed) { Sfx.pass(); Speech.say('Положивте.', false); }
    else { Sfx.fail(); Speech.say('Не положивте.', false); }
  },

  step(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
    const playing = Game.state === 'playing';
    const inp = playing ? UI.getInput() : { up: false, down: false, brake: true, steer: 0 };
    for (let i = 0; i < n; i++) {
      Game.time += h;
      if (!Player.ghost) Player.update(h, inp, Game.time);
      World.update(h);
      Traffic.update(h, Game.time);
      Peds.update(h);
      if (playing && Game.state === 'playing') Exam.update(h);
    }
  },

  menuStep(dt) {
    Game.menuT += dt;
    const t = Game.menuT;
    Player.x = 255 + 175 * Math.sin(t * 0.021);
    Player.y = 215 + 120 * Math.sin(t * 0.033 + 1);
    Player.a = 0; Player.v = 0;
    Game.step(dt);
  },

  frame(ts) {
    const dt = Math.min((ts - Game.last) / 1000, 0.05);
    Game.last = ts;
    if (Game.state === 'playing' || Game.state === 'results') Game.step(dt);
    else if (Game.state === 'menu') Game.menuStep(dt);
    Render.updateCamera(dt, false);
    Render.draw(Game.time);
    if (Game.state === 'playing') {
      UI.updateHUD();
      const b = Math.floor(Game.time * 2.6) % 2;
      if (Player.indicator && b !== Game.lastBlink) Sfx.tick(b === 0);
      Game.lastBlink = b;
    }
    Sfx.engine(Player.v, Game.state === 'playing');
    requestAnimationFrame(Game.frame);
  },
};

window.addEventListener('DOMContentLoaded', () => Game.init());

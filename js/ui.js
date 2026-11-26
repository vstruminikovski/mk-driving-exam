'use strict';
/* =========================================================================
   UI — menus, HUD, examiner panel, toasts, input (keyboard + touch)
   ========================================================================= */

const ICONS = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 20v-7a3 3 0 0 0-3-3H6" /><path d="M9 6 5 10l4 4" /></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 20v-7a3 3 0 0 1 3-3h6" /><path d="m15 6 4 4-4 4" /></svg>',
  straight: '<svg viewBox="0 0 24 24"><path d="M12 20V5" /><path d="m7 9 5-5 5 5" /></svg>',
  round: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" /><path d="M12 21v-4.5M12 7.5V3M3 12h4.5M16.5 12H21" /><path d="m18 9.5 3 2.5-3 2.5" /></svg>',
  stop: '<svg viewBox="0 0 24 24"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" /><path d="M8 12h8" /></svg>',
  ped: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2" /><path d="m9 21 2-6-2-3 1-4h4l2 4M13 15l2 6M14 8l3 3" /></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v3H3z" /><circle cx="7.5" cy="13" r="1" /><circle cx="16.5" cy="13" r="1" /></svg>',
  lane: '<svg viewBox="0 0 24 24"><path d="M6 21V3M18 21V3" stroke-dasharray="0" /><path d="M12 21v-3M12 14v-3M12 7V4" /><path d="M9 18c0-5 6-5 6-10" /><path d="m13 7 2-2 2 2" /></svg>',
  park: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M10 17V7h3.5a3 3 0 0 1 0 6H10" /></svg>',
  pull: '<svg viewBox="0 0 24 24"><path d="M20 3v18" /><path d="M8 20v-6a4 4 0 0 1 4-4h4" /><path d="m14 7 3 3-3 3" /></svg>',
  obstacle: '<svg viewBox="0 0 24 24"><rect x="13" y="4" width="6" height="9" rx="1.5" /><path d="M8 21v-5c0-3 5-3 5-6V9" /><path d="m6 18 2 3 2-3" /></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></svg>',
  light: '<svg viewBox="0 0 24 24"><rect x="8" y="2.5" width="8" height="19" rx="3" /><circle cx="12" cy="7" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="17" r="1.6" /></svg>',
};

const Settings = (() => {
  const def = { voice: true, voiceChoice: 'auto', rate: 1, sfx: true, engine: true, density: 'normal', hint: true, abort: true, touch: 'auto', zoom: 1 };
  let s = Object.assign({}, def);
  try { const raw = localStorage.getItem('mkexam.settings'); if (raw) s = Object.assign(s, JSON.parse(raw)); } catch (e) {}
  s.save = () => { try { const c = Object.assign({}, s); delete c.save; delete c.apply; localStorage.setItem('mkexam.settings', JSON.stringify(c)); } catch (e) {} };
  s.apply = () => {
    Speech.enabled = s.voice; Speech.rate = s.rate; Speech.setChoice(s.voiceChoice);
    Sfx.enabled = s.sfx; Sfx.engineOn = s.engine;
    Traffic.target = CFG.DENSITY[s.density] || CFG.DENSITY.normal;
    Exam.hintOn = s.hint; Exam.abortOnCritical = s.abort;
    Render.zoom = s.zoom;
    UI.applyTouchMode();
  };
  return s;
})();

const Best = {
  get(id) { try { return JSON.parse(localStorage.getItem('mkexam.best') || '{}')[id] || null; } catch (e) { return null; } },
  set(id, res) {
    try {
      const all = JSON.parse(localStorage.getItem('mkexam.best') || '{}');
      const prev = all[id];
      if (!prev || res.score > prev.score || (res.passed && !prev.passed)) all[id] = { score: res.score, passed: res.passed };
      localStorage.setItem('mkexam.best', JSON.stringify(all));
    } catch (e) {}
  },
};

const UI = (() => {
  const $ = id => document.getElementById(id);
  const ui = {};
  const input = { up: false, down: false, brake: false, steerL: false, steerR: false, touch: { up: false, down: false, brake: false, l: false, r: false } };
  ui.input = input;

  ui.getInput = () => {
    const t = input.touch;
    const l = input.steerL || t.l, r = input.steerR || t.r;
    return { up: input.up || t.up, down: input.down || t.down, brake: input.brake || t.brake, steer: (r ? 1 : 0) - (l ? 1 : 0) };
  };

  /* ---------------- screens ---------------- */
  const screens = ['menu', 'scenarios', 'controls', 'settings', 'pause', 'results'];
  ui.show = function (name) {
    for (const s of screens) $(s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', !(name === null || name === 'pause'));
    document.body.classList.toggle('in-game', name === null || name === 'pause');
  };

  /* ---------------- HUD ---------------- */
  let lastSpd = -1, lastLim = -1, lastInd = 99;
  ui.updateHUD = function () {
    const P = Player;
    const spd = Math.round(Math.abs(P.v) * 3.6);
    if (spd !== lastSpd) { $('spd').textContent = spd; lastSpd = spd; }
    const lim = Exam.curEdge ? Exam.curEdge.limit : 50;
    if (lim !== lastLim) { $('limitSign').textContent = lim; lastLim = lim; }
    $('speedCard').classList.toggle('over', spd > lim + 5);
    const blink = Math.floor(Game.time * 2.6) % 2 === 0;
    const ind = P.indicator * (blink ? 1 : 2);
    if (ind !== lastInd) {
      $('indL').classList.toggle('on', P.indicator === -1 && blink);
      $('indR').classList.toggle('on', P.indicator === 1 && blink);
      $('indL').classList.toggle('armed', P.indicator === -1);
      $('indR').classList.toggle('armed', P.indicator === 1);
      lastInd = ind;
    }
    $('gear').textContent = P.v < -0.05 || (UI.getInput().down && Math.abs(P.v) < 0.1) ? 'R' : 'D';
    $('mirrorBadge').classList.toggle('on', Game.time - P.mirrorT < 1.8);
    const pr = Exam.progress();
    if (pr) {
      $('progBar').style.width = (100 * pr.done / Math.max(1, pr.total)) + '%';
      $('progText').textContent = `Напредок ${pr.done}/${pr.total}`;
    }
  };
  ui.updateScore = function () {
    const n = Exam.mistakes.length, c = Exam.mistakes.filter(m => m.sev === 'critical').length;
    $('scoreVal').textContent = Exam.score;
    $('mistakeCount').textContent = `${n} ${n === 1 ? 'грешка' : 'грешки'}${c ? ` · ${c} крит.` : ''}`;
    $('scoreCard').classList.toggle('bad', c > 0 || Exam.score < CFG.SCORING.pass);
  };
  ui.setInstruction = function (text, icon) {
    const el = $('exText');
    el.textContent = text;
    $('exIcon').innerHTML = ICONS[icon] || ICONS.info;
    const box = $('examiner');
    box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
  };
  ui.toast = function (text, sev, pen) {
    const wrap = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + (sev || 'info');
    const label = sev === 'critical' ? 'Критична грешка' : sev === 'major' ? 'Сериозна грешка' : sev === 'minor' ? 'Грешка' : '';
    d.innerHTML = (label ? `<b>${label}${pen ? ` −${pen}` : ''}</b>` : '') + `<span></span>`;
    d.querySelector('span').textContent = text;
    wrap.appendChild(d);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(() => d.classList.add('out'), sev === 'critical' ? 4200 : 3000);
    setTimeout(() => d.remove(), sev === 'critical' ? 4700 : 3500);
  };

  /* ---------------- scenario list ---------------- */
  function buildScenarioList() {
    const g = $('scenGrid');
    g.innerHTML = '';
    SCENARIOS.forEach((sc, i) => {
      const b = Best.get(sc.id);
      const card = document.createElement('button');
      card.className = 'scen-card';
      card.innerHTML = `<div class="scen-top"><span class="scen-num">${i + 1}</span><span class="scen-ic">${ICONS[sc.icon] || ICONS.info}</span></div>
        <h3></h3><p></p>${b ? `<div class="best ${b.passed ? 'ok' : 'no'}">${b.passed ? 'Положено' : 'Не е положено'} · ${b.score} б.</div>` : '<div class="best">Не е обидено</div>'}`;
      card.querySelector('h3').textContent = sc.title;
      card.querySelector('p').textContent = sc.desc;
      card.onclick = () => { Sfx.unlock(); Sfx.click(); Game.start('scenario', sc); };
      g.appendChild(card);
    });
  }

  /* ---------------- results ---------------- */
  ui.showResults = function (r) {
    ui.show('results');
    const box = $('results');
    box.classList.toggle('passed', r.passed);
    $('resVerdict').textContent = r.passed ? 'ПОЛОЖИВТЕ' : 'НЕ ПОЛОЖИВТЕ';
    $('resTitle').textContent = r.title + (r.aborted ? ' — прекинат' : '');
    $('resScore').textContent = r.score;
    $('resMistakes').textContent = r.mistakes.length;
    $('resCritical').textContent = r.critical;
    const mm = Math.floor(r.duration / 60), ss = Math.floor(r.duration % 60);
    $('resTime').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    const list = $('resList');
    list.innerHTML = '';
    if (!r.mistakes.length) {
      list.innerHTML = '<div class="res-empty">Без грешки — одлично возење!</div>';
    } else {
      const groups = {};
      for (const m of r.mistakes) {
        groups[m.code] = groups[m.code] || { ...m, count: 0, pts: 0 };
        groups[m.code].count++; groups[m.code].pts += m.pen;
      }
      const order = { critical: 0, major: 1, minor: 2 };
      Object.values(groups).sort((a, b) => order[a.sev] - order[b.sev]).forEach(g => {
        const row = document.createElement('div');
        row.className = 'res-row ' + g.sev;
        const sevTxt = g.sev === 'critical' ? 'Критична' : g.sev === 'major' ? 'Сериозна' : 'Мала';
        row.innerHTML = `<div class="res-sev">${sevTxt}</div><div class="res-main"><div class="res-text"></div><div class="res-tip"></div></div><div class="res-count">${g.count > 1 ? '×' + g.count : ''}<small>−${g.pts}</small></div>`;
        row.querySelector('.res-text').textContent = g.text + (g.detail ? ' ' + g.detail : '');
        row.querySelector('.res-tip').textContent = MISTAKES[g.code].tip;
        list.appendChild(row);
      });
    }
    let summary;
    if (r.passed) summary = r.mistakes.length ? 'Испитот е положен, но обрнете внимание на забелешките подолу.' : 'Совршено возење без забелешки.';
    else if (r.critical) summary = 'Направена е критична грешка, поради што испитот не е положен.';
    else summary = `Освоени се ${r.score} бодови, а потребни се најмалку ${CFG.SCORING.pass}.`;
    $('resSummary').textContent = summary;
    const idx = SCENARIOS.findIndex(s => s.id === r.scenId);
    $('btnNext').classList.toggle('hidden', !(r.mode === 'scenario' && idx >= 0 && idx < SCENARIOS.length - 1));
    if (r.mode !== 'practice') Best.set(r.scenId, r);
  };

  /* ---------------- settings ---------------- */
  ui.refreshVoiceList = function () {
    const sel = $('setVoiceChoice');
    if (!sel) return;
    const cur = Settings.voiceChoice;
    sel.innerHTML = '<option value="auto">Автоматски (само македонски)</option>';
    for (const v of Speech.cyrillicVoices()) {
      if (/^mk/i.test(v.lang)) continue;
      const o = document.createElement('option');
      o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang}) — резервен`;
      sel.appendChild(o);
    }
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'auto';
    const st = $('voiceStatus');
    if (!Speech.supported) st.textContent = 'Прелистувачот не поддржува говор. Упатствата се прикажуваат како текст.';
    else if (Speech.available) st.textContent = `Пронајден македонски глас: ${Speech.voices.find(v => /^mk/i.test(v.lang)).name}.`;
    else st.textContent = 'Македонски (mk-MK) глас не е инсталиран. Упатствата се прикажуваат како текст. Можете рачно да изберете резервен кирилски глас.';
    st.classList.toggle('warn', !Speech.available);
  };

  function bindSettings() {
    const bindToggle = (id, key) => {
      const el = $(id);
      el.checked = !!Settings[key];
      el.onchange = () => { Settings[key] = el.checked; Settings.save(); Settings.apply(); };
    };
    bindToggle('setVoice', 'voice'); bindToggle('setSfx', 'sfx'); bindToggle('setEngine', 'engine');
    bindToggle('setHint', 'hint'); bindToggle('setAbort', 'abort');
    const bindSel = (id, key, num) => {
      const el = $(id);
      el.value = String(Settings[key]);
      el.onchange = () => { Settings[key] = num ? parseFloat(el.value) : el.value; Settings.save(); Settings.apply(); };
    };
    bindSel('setDensity', 'density'); bindSel('setTouch', 'touch'); bindSel('setRate', 'rate', true); bindSel('setZoom', 'zoom', true);
    $('setVoiceChoice').onchange = e => { Settings.voiceChoice = e.target.value; Settings.save(); Settings.apply(); };
    $('btnTestVoice').onclick = () => {
      Sfx.unlock();
      if (!Speech.voice) { UI.toast('Нема избран глас — упатствата ќе бидат само текст.', 'info'); return; }
      const prev = Speech.enabled; Speech.enabled = true;
      Speech.say('На следната раскрсница свртете лево.');
      Speech.enabled = prev;
    };
  }

  ui.applyTouchMode = function () {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const on = Settings.touch === 'on' || (Settings.touch === 'auto' && (coarse || 'ontouchstart' in window && navigator.maxTouchPoints > 0));
    document.body.classList.toggle('touch', on);
    Render.anchorY = on ? 0.4 : 0.5;
  };

  /* ---------------- input ---------------- */
  function bindKeys() {
    const map = (code, v) => {
      switch (code) {
        case 'KeyW': case 'ArrowUp': input.up = v; return true;
        case 'KeyS': case 'ArrowDown': input.down = v; return true;
        case 'KeyA': case 'ArrowLeft': input.steerL = v; return true;
        case 'KeyD': case 'ArrowRight': input.steerR = v; return true;
        case 'Space': input.brake = v; return true;
      }
      return false;
    };
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT')) return;
      if (Game.state === 'playing') {
        if (map(e.code, true)) { e.preventDefault(); }
        if (e.repeat) return;
        if (e.code === 'KeyZ') Player.setIndicator(-1, Game.time);
        else if (e.code === 'KeyX') Player.setIndicator(1, Game.time);
        else if (e.code === 'KeyQ') Game.mirror();
        else if (e.code === 'KeyR') Exam.replay();
        else if (e.code === 'Escape' || e.code === 'KeyP') Game.pause();
      } else if (Game.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) Game.resume();
    });
    window.addEventListener('keyup', e => { map(e.code, false); });
    window.addEventListener('blur', () => { Object.assign(input, { up: false, down: false, brake: false, steerL: false, steerR: false }); });
  }

  function bindTouch() {
    const hold = (id, key) => {
      const el = $(id);
      const on = e => { e.preventDefault(); Sfx.unlock(); input.touch[key] = true; el.classList.add('down'); };
      const off = e => { e.preventDefault(); input.touch[key] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', e => e.preventDefault());
    };
    hold('tL', 'l'); hold('tR', 'r'); hold('tGas', 'up'); hold('tBrake', 'down');
    const tap = (id, fn) => $(id).addEventListener('pointerdown', e => { e.preventDefault(); Sfx.unlock(); fn(); });
    tap('tIndL', () => Player.setIndicator(-1, Game.time));
    tap('tIndR', () => Player.setIndicator(1, Game.time));
    tap('tMirror', () => Game.mirror());
  }

  ui.init = function () {
    const click = (id, fn) => $(id).addEventListener('click', () => { Sfx.unlock(); Sfx.click(); fn(); });
    click('btnExam', () => Game.start('exam', FULL_EXAM));
    click('btnPractice', () => Game.start('practice', PRACTICE));
    click('btnScen', () => { buildScenarioList(); ui.show('scenarios'); });
    click('btnControls', () => ui.show('controls'));
    click('btnSettings', () => { ui.refreshVoiceList(); ui.show('settings'); });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => { Sfx.click(); ui.show('menu'); }));
    click('btnPause', () => Game.pause());
    click('btnReplay', () => Exam.replay());
    click('btnResume', () => Game.resume());
    click('btnRestart', () => Game.restart());
    click('btnPauseMenu', () => Game.toMenu());
    click('btnRetry', () => Game.restart());
    click('btnResMenu', () => Game.toMenu());
    click('btnNext', () => {
      const idx = SCENARIOS.findIndex(s => s.id === Game.lastScen.id);
      Game.start('scenario', SCENARIOS[idx + 1]);
    });
    bindKeys(); bindTouch(); bindSettings();
    document.addEventListener('visibilitychange', () => { if (document.hidden && Game.state === 'playing') Game.pause(); });
  };

  return ui;
})();

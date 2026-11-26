'use strict';
/* =========================================================================
   AUDIO — Web Audio sound effects + Speech Synthesis examiner voice
   ========================================================================= */

const Sfx = (() => {
  let ctx = null, master = null, engine = null, engGain = null, engFilter = null;
  const S = { enabled: true, engineOn: true };

  S.unlock = function () {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      engine = ctx.createOscillator(); engine.type = 'sawtooth'; engine.frequency.value = 40;
      engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 260;
      engGain = ctx.createGain(); engGain.gain.value = 0;
      engine.connect(engFilter); engFilter.connect(engGain); engGain.connect(master);
      engine.start();
    } catch (e) { ctx = null; }
  };

  function tone(freq, dur, type = 'sine', vol = 0.25, when = 0, slide = 0) {
    if (!ctx || !S.enabled) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol = 0.4) {
    if (!ctx || !S.enabled) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }

  S.tick = on => tone(on ? 1650 : 1250, 0.035, 'square', 0.05);
  S.indicatorToggle = on => tone(on ? 900 : 600, 0.05, 'triangle', 0.08);
  S.mirror = () => { tone(1200, 0.06, 'sine', 0.12); tone(1600, 0.08, 'sine', 0.1, 0.06); };
  S.chime = () => { tone(784, 0.18, 'sine', 0.16); tone(1046, 0.25, 'sine', 0.14, 0.12); };
  S.good = () => { tone(880, 0.12, 'sine', 0.14); tone(1320, 0.18, 'sine', 0.12, 0.09); };
  S.warn = () => { tone(520, 0.16, 'triangle', 0.2); tone(390, 0.24, 'triangle', 0.2, 0.15); };
  S.critical = () => { tone(300, 0.35, 'sawtooth', 0.15, 0, -120); tone(220, 0.45, 'sawtooth', 0.15, 0.3, -80); };
  S.crash = () => { noise(0.5, 0.6); tone(90, 0.3, 'sine', 0.4, 0, -40); };
  S.pass = () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'sine', 0.16, i * 0.12)); };
  S.fail = () => { [440, 370, 311].forEach((f, i) => tone(f, 0.35, 'triangle', 0.16, i * 0.18)); };
  S.click = () => tone(700, 0.04, 'triangle', 0.08);

  S.engine = function (v, active) {
    if (!ctx || !engGain) return;
    const on = S.enabled && S.engineOn && active;
    const sp = Math.abs(v);
    engine.frequency.setTargetAtTime(38 + sp * 4.2, ctx.currentTime, 0.1);
    engFilter.frequency.setTargetAtTime(200 + sp * 25, ctx.currentTime, 0.1);
    engGain.gain.setTargetAtTime(on ? 0.035 + Math.min(sp, 20) * 0.002 : 0, ctx.currentTime, 0.15);
  };
  return S;
})();

const Speech = (() => {
  const SP = { enabled: true, voice: null, voices: [], rate: 1.0, choice: 'auto', available: false, last: '' };
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  function load() {
    if (!supported) return;
    SP.voices = speechSynthesis.getVoices() || [];
    pick();
    if (typeof UI !== 'undefined' && UI.refreshVoiceList) UI.refreshVoiceList();
  }
  function pick() {
    SP.voice = null;
    if (SP.choice && SP.choice !== 'auto') {
      SP.voice = SP.voices.find(v => v.voiceURI === SP.choice) || null;
    }
    if (!SP.voice) {
      // Genuine Macedonian only — never silently fall back to another language.
      SP.voice = SP.voices.find(v => /^mk([-_]|$)/i.test(v.lang)) || null;
    }
    SP.available = !!SP.voices.find(v => /^mk([-_]|$)/i.test(v.lang));
  }
  SP.init = function () {
    if (!supported) return;
    load();
    speechSynthesis.onvoiceschanged = load;
    setTimeout(load, 600);
    setTimeout(load, 2000);
  };
  SP.setChoice = c => { SP.choice = c; pick(); };
  SP.cyrillicVoices = () => SP.voices.filter(v => /^(mk|sr|bg|ru|uk|be)([-_]|$)/i.test(v.lang));
  SP.supported = supported;

  SP.say = function (text, interrupt = true) {
    SP.last = text;
    if (!supported || !SP.enabled || !SP.voice) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = SP.voice; u.lang = SP.voice.lang; u.rate = SP.rate; u.pitch = 1;
      speechSynthesis.speak(u);
    } catch (e) { /* speech is optional */ }
  };
  SP.stop = () => { if (supported) try { speechSynthesis.cancel(); } catch (e) {} };
  return SP;
})();

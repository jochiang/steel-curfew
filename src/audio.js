// Synthesized sound effects (WebAudio, no asset files). The game pushes events onto run.events;
// play() drains them once per frame. Busy sounds (shots, hits, pickups) are rate-limited so a
// crowded screen doesn't turn into a wall of noise.

let ac = null, master = null, noise = null, muted = false, comp = null;
const unlockHooks = [];
/** Run fn(ac, out) once audio is unlocked (out = the shared compressor, for the music engine) */
export function onAudioReady(fn) { if (ac) fn(ac, comp); else unlockHooks.push(fn); }
try { muted = localStorage.getItem("mech.muted") === "1"; } catch {}

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.55;
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp).connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    for (const fn of unlockHooks.splice(0)) fn(ac, comp);
  }
  if (ac.state === "suspended") ac.resume();
}
for (const ev of ["pointerdown", "keydown", "touchend"]) addEventListener(ev, unlock, { capture: true, passive: true });

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("mech.muted", m ? "1" : "0"); } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.02);
}

// ---------------------------------------------------------------- voices
function env(g, t, a, peak, d, hold = 0) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  if (hold) g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
}
function tone(type, f0, f1, dur, vol, { attack = 0.004, when = 0 } = {}) {
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, attack, vol, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + attack + dur + 0.02);
}
function hiss(dur, vol, { type = "bandpass", f0 = 1200, f1 = f0, q = 0.8, attack = 0.004, when = 0, hold = 0 } = {}) {
  const t = ac.currentTime + when, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + hold + dur);
  env(g, t, attack, vol, dur, hold);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random()); s.stop(t + attack + hold + dur + 0.02);
}

const last = {};
const gate = (k, ms) => { const now = performance.now(); if (now - (last[k] ?? -Infinity) < ms) return false; last[k] = now; return true; };
let pickupChain = 0, pickupAt = 0;

// Weapons are pitched low with a sine "thump" under each hit for weight; a triangle an octave up
// keeps that weight audible on phone speakers, which can't reproduce the fundamental.
const SFX = {
  shot: () => gate("shot", 55) && (tone("square", 300, 90, 0.05, 0.04), tone("sine", 120, 50, 0.07, 0.1), tone("triangle", 240, 96, 0.04, 0.04),
    hiss(0.012, 0.05, { f0: 3200, q: 0.9 }), hiss(0.05, 0.06, { type: "lowpass", f0: 1800, f1: 400 })),
  flak: () => gate("flak", 90) && (hiss(0.015, 0.08, { f0: 2800, q: 0.8 }), hiss(0.14, 0.22, { type: "lowpass", f0: 1400, f1: 150 }),
    tone("triangle", 95, 38, 0.12, 0.16), tone("sine", 70, 32, 0.14, 0.18)),
  swing: (e) => gate("swing", 70) && (e.heavy
    ? (tone("sine", 80, 32, 0.16, 0.32), tone("triangle", 160, 60, 0.1, 0.1), hiss(0.09, 0.12, { type: "lowpass", f0: 500, f1: 150 }))
    : (hiss(0.08, 0.08, { f0: 1600, f1: 600, q: 1.2 }), tone("sine", 90, 50, 0.05, 0.08))),
  hit: () => gate("hit", 35) && tone("square", 520 + Math.random() * 120, 260, 0.025, 0.022),
  boom: (e) => gate("boom", 40) && (hiss(0.2 + e.r * 0.02, 0.14 + Math.min(0.2, e.r * 0.015), { type: "lowpass", f0: 1000, f1: 80 }),
    tone("sine", 110 - e.r * 3, 30, 0.18 + e.r * 0.012, 0.22), tone("triangle", 220 - e.r * 6, 60, 0.12, 0.08)),
  beam: () => { tone("sawtooth", 700, 70, 0.45, 0.12, { attack: 0.01 }); tone("sine", 65, 26, 0.4, 0.4); tone("triangle", 130, 50, 0.3, 0.12); hiss(0.4, 0.1, { f0: 2200, f1: 400, q: 0.7 }); },
  nova: () => { tone("sine", 95, 24, 0.5, 0.5); tone("triangle", 190, 48, 0.3, 0.12); hiss(0.4, 0.18, { type: "lowpass", f0: 1800, f1: 100 }); },
  vent: (e) => { hiss(e.dur * 0.35, 0.08, { type: "highpass", f0: 3500, f1: 1500, attack: 0.05, hold: e.dur * 0.6 }); tone("sine", 160, 80, 0.2, 0.06, { when: 0.02 }); },
  collapse: (e) => {
    const s = Math.min(1, (e.size || 6) / 16);
    hiss(0.7 + s * 0.6, 0.18 + s * 0.12, { type: "lowpass", f0: 700, f1: 60, attack: 0.02 });
    tone("sine", 55, 28, 0.9 + s * 0.4, 0.3); tone("triangle", 110, 45, 0.5, 0.1);
    hiss(0.5, 0.1, { type: "lowpass", f0: 400, f1: 80, when: 0.18 });
  },
  tink: () => gate("tink", 45) && (tone("square", 1700 + Math.random() * 400, 1100, 0.02, 0.018), hiss(0.02, 0.025, { f0: 5200, q: 2 })),
  reload: () => gate("reload", 150) && (tone("square", 230, 110, 0.05, 0.05), hiss(0.04, 0.05, { type: "lowpass", f0: 900 }), tone("square", 300, 160, 0.04, 0.04, { when: 0.12 })),
  reloaded: () => gate("reloaded", 150) && tone("square", 420, 520, 0.03, 0.03),
  casing: () => gate("casing", 90) && tone("triangle", 2600 + Math.random() * 900, 2400, 0.012, 0.012),
  punch: () => gate("punch", 80) && (tone("sine", 95, 32, 0.2, 0.4), tone("square", 170, 55, 0.07, 0.09), hiss(0.14, 0.2, { type: "lowpass", f0: 1400, f1: 180 }), hiss(0.03, 0.08, { f0: 3500, q: 1 })),
  saw: () => gate("saw", 85) && (tone("sawtooth", 130 + Math.random() * 30, 170, 0.09, 0.05), hiss(0.09, 0.06, { f0: 2600, q: 1.5 }), tone("square", 1400, 900, 0.02, 0.015)),
  missile: () => gate("missile", 70) && (hiss(0.18, 0.08, { f0: 700, f1: 2200, q: 1.2 }), tone("sine", 140, 70, 0.08, 0.08)),
  flame: () => gate("flame", 90) && (hiss(0.14, 0.07, { type: "lowpass", f0: 1100, f1: 500 }), Math.random() < 0.5 && hiss(0.015, 0.05, { f0: 3000 + Math.random() * 2000, q: 3, when: Math.random() * 0.08 })),
  rail: () => { tone("square", 1600, 180, 0.05, 0.08); tone("sine", 70, 24, 0.5, 0.45); tone("triangle", 140, 45, 0.35, 0.12); hiss(0.3, 0.14, { f0: 3000, f1: 300, q: 0.8 }); },
  lob: (e) => gate("lob", 90) && (tone("sine", 95, 45, 0.12, 0.14), hiss(0.05, 0.06, { type: "lowpass", f0: 900 }),
    tone("sine", 1500, 520, Math.max(0.3, (e.dur || 1.2) - 0.15), 0.018, { when: 0.12, attack: 0.2 })),   // falling whistle
  fuse: () => gate("fuse", 60) && (tone("square", 1400, 1400, 0.04, 0.03), tone("square", 1400, 1400, 0.04, 0.03, { when: 0.12 })),
  crunch: () => gate("crunch", 60) && (hiss(0.08, 0.12, { f0: 1100, f1: 500, q: 2 }), tone("square", 180, 60, 0.06, 0.05)),
  levelup: () => [523, 784, 1047].forEach((f, i) => tone("square", f, f, 0.1, 0.05, { when: i * 0.06 })),
  charged: () => { tone("sine", 660, 660, 0.08, 0.06); tone("sine", 990, 990, 0.12, 0.05, { when: 0.07 }); },
  pickup: () => {
    const now = performance.now();
    pickupChain = now - pickupAt < 250 ? Math.min(pickupChain + 1, 12) : 0; pickupAt = now;
    if (!gate("pickup", 45)) return;
    tone("square", 880 * 2 ** (pickupChain / 12), 880 * 2 ** (pickupChain / 12), 0.04, 0.035);
  },
  hurt: () => gate("hurt", 120) && (tone("square", 150, 70, 0.16, 0.12), hiss(0.1, 0.1, { type: "lowpass", f0: 900 })),
  enemyShot: () => gate("eshot", 120) && tone("triangle", 420, 700, 0.08, 0.04),
  spawnBoss: () => {
    hiss(0.06, 0.2, { f0: 2500, q: 0.5 });                                                   // the crack...
    hiss(2.2, 0.2, { type: "lowpass", f0: 400, f1: 60, attack: 0.12, when: 0.05, hold: 0.4 });   // ...and the rolling thunder
    tone("sine", 45, 30, 2, 0.25, { attack: 0.1, when: 0.05 });
    tone("sawtooth", 70, 55, 1.2, 0.16, { attack: 0.08, when: 0.5 }); tone("sawtooth", 105, 82, 1.2, 0.09, { attack: 0.08, when: 0.5 });
  },
  waveStart: () => { tone("triangle", 440, 440, 0.08, 0.08); tone("triangle", 660, 660, 0.12, 0.08, { when: 0.09 }); },
  waveClear: () => [523, 659, 784, 1047].forEach((f, i) => tone("triangle", f, f, 0.14, 0.08, { when: i * 0.07 })),
  dead: () => { tone("sawtooth", 300, 40, 1.1, 0.16); hiss(0.9, 0.12, { type: "lowpass", f0: 1500, f1: 80 }); },
  buy: () => { tone("square", 700, 700, 0.04, 0.05); tone("square", 1050, 1050, 0.06, 0.05, { when: 0.05 }); },
  click: () => tone("square", 1200, 1200, 0.015, 0.03),
};

/** Play and clear queued game events */
export function play(events) {
  if (!ac || muted || ac.state !== "running") { events.length = 0; return; }
  for (const e of events) SFX[e.type]?.(e);
  events.length = 0;
}
export function ui(type) { if (ac && !muted && ac.state === "running") SFX[type]?.({}); }

/** Test hook: render one effect offline and measure it (peak, RMS, audible length). */
export async function probe(type, e = {}, filter = null) {
  const saved = [ac, master, noise, Math.random];
  const off = new OfflineAudioContext(1, 44100 * 2, 44100);
  let seed = 12345;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);   // repeatable noise
  ac = off; master = off.createGain(); master.gain.value = 0.55;
  if (filter) { const f = off.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = 0.7; master.connect(f).connect(off.destination); }
  else master.connect(off.destination);
  noise = off.createBuffer(1, off.sampleRate, off.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (const k in last) delete last[k];
  try { SFX[type](e); } finally { [ac, master, noise, Math.random] = saved; }
  const d = (await off.startRendering()).getChannelData(0);
  let peak = 0, sum = 0, end = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; if (v > 0.01) end = i; }
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / (end + 1)).toFixed(3), ms: Math.round((end / 44100) * 1000), energy: sum };
}
export const SFX_NAMES = Object.keys(SFX);

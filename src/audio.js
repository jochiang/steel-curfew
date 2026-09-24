// Synthesized sound effects (WebAudio, no asset files). The game pushes events onto run.events;
// play() drains them once per frame. Busy sounds (shots, hits, pickups) are rate-limited so a
// crowded screen doesn't turn into a wall of noise.

let ac = null, master = null, noise = null, muted = false;
try { muted = localStorage.getItem("mech.muted") === "1"; } catch {}

export function unlock() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.55;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp).connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

const SFX = {
  shot: () => gate("shot", 55) && (tone("square", 520, 140, 0.05, 0.05), hiss(0.04, 0.08, { f0: 2400, q: 0.6 })),
  flak: () => gate("flak", 90) && (hiss(0.12, 0.22, { type: "lowpass", f0: 2200, f1: 300 }), tone("triangle", 140, 60, 0.1, 0.12)),
  swing: (e) => gate("swing", 70) && (e.heavy
    ? (tone("sine", 110, 45, 0.14, 0.28), hiss(0.08, 0.1, { f0: 700, f1: 300 }))
    : hiss(0.07, 0.07, { f0: 3000, f1: 1200, q: 1.5 })),
  hit: () => gate("hit", 35) && tone("square", 900 + Math.random() * 300, 500, 0.025, 0.025),
  boom: (e) => gate("boom", 40) && (hiss(0.18 + e.r * 0.02, 0.14 + Math.min(0.2, e.r * 0.015), { type: "lowpass", f0: 1600, f1: 120 }),
    tone("sine", 160 - e.r * 4, 40, 0.16 + e.r * 0.01, 0.16)),
  beam: () => { tone("sawtooth", 1300, 160, 0.45, 0.13, { attack: 0.01 }); tone("sine", 90, 35, 0.35, 0.35); hiss(0.4, 0.12, { f0: 4000, f1: 800, q: 0.7 }); },
  nova: () => { tone("sine", 140, 32, 0.45, 0.45); hiss(0.35, 0.16, { type: "lowpass", f0: 3000, f1: 200 }); tone("triangle", 600, 150, 0.25, 0.06); },
  vent: (e) => { hiss(e.dur * 0.35, 0.08, { type: "highpass", f0: 5000, f1: 2200, attack: 0.05, hold: e.dur * 0.6 }); tone("sine", 220, 110, 0.18, 0.05, { when: 0.02 }); },
  charged: () => { tone("sine", 660, 660, 0.08, 0.06); tone("sine", 990, 990, 0.12, 0.05, { when: 0.07 }); },
  pickup: () => {
    const now = performance.now();
    pickupChain = now - pickupAt < 250 ? Math.min(pickupChain + 1, 12) : 0; pickupAt = now;
    if (!gate("pickup", 45)) return;
    tone("square", 880 * 2 ** (pickupChain / 12), 880 * 2 ** (pickupChain / 12), 0.04, 0.035);
  },
  hurt: () => gate("hurt", 120) && (tone("square", 150, 70, 0.16, 0.12), hiss(0.1, 0.1, { type: "lowpass", f0: 900 })),
  enemyShot: () => gate("eshot", 120) && tone("triangle", 420, 700, 0.08, 0.04),
  spawnBoss: () => { tone("sawtooth", 70, 55, 1.2, 0.18, { attack: 0.08 }); tone("sawtooth", 105, 82, 1.2, 0.1, { attack: 0.08 }); },
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
export async function probe(type, e = {}) {
  const saved = [ac, master, noise];
  const off = new OfflineAudioContext(1, 44100 * 2, 44100);
  ac = off; master = off.createGain(); master.gain.value = 0.55; master.connect(off.destination);
  noise = off.createBuffer(1, off.sampleRate, off.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  for (const k in last) delete last[k];
  try { SFX[type](e); } finally { [ac, master, noise] = saved; }
  const d = (await off.startRendering()).getChannelData(0);
  let peak = 0, sum = 0, end = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; if (v > 0.01) end = i; }
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / (end + 1)).toFixed(3), ms: Math.round((end / 44100) * 1000) };
}
export const SFX_NAMES = Object.keys(SFX);

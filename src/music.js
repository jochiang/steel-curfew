// Adaptive chiptune score, synthesized live (no audio files). One clock drives everything: a
// look-ahead scheduler places notes on a 16th-note grid at 138 BPM. The arrangement is a set of
// stems (pad, bass, drums, lead, arp, boss, stinger), each on its own gain, and the game only
// moves those gains and asks for sections. Stems fade, sections change on 4-bar phrase
// boundaries, stingers land on the next beat, so nothing ever cuts.
//
// Style: heroic, martial, brass-forward (in the spirit of Total Annihilation's score), done with
// pulse waves, triangle strings, a marching snare and timpani. Key of D minor.

import { onAudioReady } from "./audio.js";

const BPM = 138, STEP = 60 / BPM / 4;   // seconds per 16th
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------------------------------------------------------------- harmony
const CHORDS = {   // [root midi (octave 3), intervals]
  Dm: [50, [0, 3, 7]], Bb: [46, [0, 4, 7]], F: [53, [0, 4, 7]], C: [48, [0, 4, 7]],
  Gm: [55, [0, 3, 7]], A: [57, [0, 4, 7]], Eb: [51, [0, 4, 7]], D: [50, [0, 4, 7]],
};
const PROG = {
  calm: ["F", "C", "Dm", "Bb"],       // title / hangar
  heroic: ["Dm", "Bb", "F", "C"],     // the fight
  tension: ["Dm", "Gm", "A", "A"],    // late waves, heavy pressure
  boss: ["Dm", "Eb", "Dm", "A"],      // the flat-two makes it loom
};

// Motifs: per bar, [step, midi, length in steps]. Two phrases per section, alternating.
const MOTIF = {
  heroic: [
    [[[0, 69, 2], [2, 74, 4], [6, 74, 1], [7, 76, 1], [8, 77, 4], [12, 76, 2], [14, 74, 2]],
     [[0, 77, 4], [4, 74, 4], [8, 70, 8]],
     [[0, 69, 2], [2, 72, 4], [6, 72, 1], [7, 74, 1], [8, 77, 4], [12, 81, 4]],
     [[0, 79, 8], [8, 76, 4], [12, 72, 4]]],
    [[[0, 74, 2], [2, 77, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 76, 4]],
     [[0, 74, 6], [6, 77, 2], [8, 74, 4], [12, 70, 4]],
     [[0, 72, 2], [2, 77, 2], [4, 81, 4], [8, 84, 4], [12, 81, 4]],
     [[0, 79, 12], [12, 76, 4]]],
  ],
  tension: [
    [[[0, 74, 3], [3, 74, 1], [4, 77, 2], [6, 81, 4], [10, 79, 2], [12, 77, 2], [14, 76, 2]],
     [[0, 74, 4], [4, 70, 4], [8, 67, 4], [12, 70, 2], [14, 74, 2]],
     [[0, 73, 4], [4, 76, 4], [8, 81, 4], [12, 79, 2], [14, 76, 2]],
     [[0, 73, 8], [8, 69, 8]]],
    [[[0, 81, 2], [2, 79, 2], [4, 77, 2], [6, 76, 2], [8, 77, 4], [12, 74, 4]],
     [[0, 79, 4], [4, 77, 2], [6, 74, 2], [8, 70, 4], [12, 74, 4]],
     [[0, 76, 2], [2, 79, 2], [4, 81, 4], [8, 85, 4], [12, 81, 4]],
     [[0, 76, 4], [4, 73, 4], [8, 69, 8]]],
  ],
  boss: [
    [[[0, 62, 6], [6, 62, 2], [8, 63, 4], [12, 62, 4]],
     [[0, 63, 4], [4, 67, 4], [8, 70, 4], [12, 69, 4]],
     [[0, 62, 4], [4, 65, 4], [8, 69, 4], [12, 68, 4]],
     [[0, 69, 8], [8, 73, 8]]],
    [[[0, 74, 4], [4, 72, 2], [6, 70, 2], [8, 69, 4], [12, 62, 4]],
     [[0, 63, 6], [6, 67, 2], [8, 70, 6], [14, 72, 2]],
     [[0, 74, 4], [4, 77, 4], [8, 74, 4], [12, 68, 4]],
     [[0, 69, 4], [4, 73, 4], [8, 76, 8]]],
  ],
  calm: [
    [[[0, 81, 8], [8, 84, 4], [12, 81, 4]], [[0, 79, 8], [8, 76, 8]], [[0, 77, 8], [8, 81, 4], [12, 74, 4]], [[0, 77, 16]]],
    [[[0, 72, 4], [4, 77, 4], [8, 81, 8]], [[0, 79, 4], [4, 76, 4], [8, 72, 8]], [[0, 74, 4], [4, 77, 4], [8, 81, 4], [12, 79, 4]], [[0, 77, 12]]],
  ],
};

// ---------------------------------------------------------------- instruments
function makeGraph(ac, out) {
  const bus = ac.createGain(); bus.gain.value = 0;
  const filt = ac.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 18000; filt.Q.value = 0.5;
  bus.connect(filt).connect(out);
  const stems = {};
  for (const k of ["pad", "bass", "drums", "lead", "arp", "boss", "sting"]) {
    stems[k] = ac.createGain(); stems[k].gain.value = k === "sting" ? 1 : 0; stems[k].connect(bus);
  }
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate), nd = noise.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < nd.length; i++) nd[i] = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const waves = {};
  const pulse = (duty) => {
    if (!waves[duty]) {
      const n = 32, re = new Float32Array(n), im = new Float32Array(n);
      for (let i = 1; i < n; i++) re[i] = (2 / (i * Math.PI)) * Math.sin(Math.PI * i * duty);
      waves[duty] = ac.createPeriodicWave(re, im);
    }
    return waves[duty];
  };
  return { ac, bus, filt, stems, noise, pulse };
}

/** A pitched note. dest: stem gain. opts: wave ("tri"|"sq"|duty number), attack, release, vol,
 *  cutoff (lowpass), bright (filter opens on attack, for brass), vib (vibrato cents), glide. */
function note(G, dest, midi, t, dur, { wave = "sq", vol = 0.1, attack = 0.006, release = 0.08, cutoff = 0, bright = 0, vib = 0, glide = 0 } = {}) {
  const { ac } = G, o = ac.createOscillator(), g = ac.createGain();
  if (typeof wave === "number") o.setPeriodicWave(G.pulse(wave)); else o.type = wave === "tri" ? "triangle" : wave === "saw" ? "sawtooth" : wave === "sine" ? "sine" : "square";
  const f = mtof(midi);
  o.frequency.setValueAtTime(glide ? f * glide : f, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  let tail = g;
  if (cutoff || bright) {
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(cutoff || 800, t);
    if (bright) { lp.frequency.linearRampToValueAtTime(bright, t + attack + 0.05); lp.frequency.setTargetAtTime(cutoff || 800, t + attack + 0.08, dur * 0.6); }
    o.connect(lp).connect(g);
  } else o.connect(g);
  if (vib) {
    const lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 5.6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + Math.min(0.25, dur));
    lfo.connect(lg).connect(o.detune); lfo.start(t); lfo.stop(t + dur + release + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.setTargetAtTime(vol * 0.75, t + attack, dur * 0.5);
  g.gain.setTargetAtTime(0.0001, t + dur, release / 3);
  tail.connect(dest);
  o.start(t); o.stop(t + dur + release + 0.05);
}

function hit(G, dest, t, { f0 = 1800, f1 = f0, type = "bandpass", q = 1, dur = 0.08, vol = 0.1 }) {
  const { ac } = G, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = G.noise; fl.type = type; fl.Q.value = q;
  fl.frequency.setValueAtTime(f0, t); if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(dest);
  s.start(t, (t * 7.3) % 0.8); s.stop(t + dur + 0.02);
}
function drum(G, dest, kind, t, v = 1) {
  const { ac } = G;
  if (kind === "kick" || kind === "timp" || kind === "heart") {
    const o = ac.createOscillator(), g = ac.createGain(), base = kind === "timp" ? v.f : kind === "heart" ? 70 : 110;
    o.type = "sine";
    o.frequency.setValueAtTime(base * (kind === "timp" ? 1.25 : 2.2), t);
    o.frequency.exponentialRampToValueAtTime(kind === "timp" ? base : 40, t + (kind === "timp" ? 0.12 : 0.09));
    const vol = (kind === "timp" ? 0.24 : kind === "heart" ? 0.28 : 0.36) * (typeof v === "number" ? v : v.v ?? 1), len = kind === "timp" ? 0.55 : 0.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(dest); o.start(t); o.stop(t + len + 0.02);
    if (kind === "timp") hit(G, dest, t, { f0: 400, type: "lowpass", dur: 0.12, vol: 0.06 * (v.v ?? 1) });
  } else if (kind === "snare") {
    hit(G, dest, t, { f0: 1900, q: 0.7, dur: 0.11, vol: 0.12 * v });
    note(G, dest, 55, t, 0.03, { wave: "tri", vol: 0.08 * v, release: 0.04 });
  } else if (kind === "hat") hit(G, dest, t, { f0: 8000, type: "highpass", dur: 0.035, vol: 0.05 * v });
  else if (kind === "crash") hit(G, dest, t, { f0: 6000, f1: 3000, type: "highpass", dur: 1.2, vol: 0.09 * v });
}

// ---------------------------------------------------------------- the arrangement
function scheduleStep(G, S, t) {
  const step = S.step % 16, bar = Math.floor(S.step / 16);
  // sections change only on phrase boundaries (the boss may cut in at any bar)
  if (step === 0 && S.next && (S.pos === 0 || S.urgent)) { S.section = S.next; S.next = null; S.urgent = false; S.pos = 0; S.phrase = 0; }
  const pos = S.pos;   // bar within the 4-bar phrase
  if (step === 15) { S.pos = (S.pos + 1) % 4; if (S.pos === 0) S.phrase++; }
  const sec = S.section, prog = PROG[sec], [root, iv] = CHORDS[prog[pos]];
  const i = S.intensity, st = G.stems, calm = sec === "calm", boss = sec === "boss";

  // pad: the chord, held for the bar (strings)
  if (step === 0) for (const k of iv) {
    note(G, st.pad, root + 12 + k, t, STEP * 16, { wave: "tri", vol: 0.05, attack: 0.25, release: 0.4 });
    note(G, st.pad, root + k, t, STEP * 16, { wave: 0.25, vol: 0.018, attack: 0.3, release: 0.4, cutoff: 1200 });
  }
  // bass: marching eighths (calm: half notes; boss: driving sixteenths)
  if (calm) { if (step === 0 || step === 8) note(G, st.bass, root - 12 + (step ? 7 : 0), t, STEP * 7, { wave: "tri", vol: 0.13, release: 0.2 }); }
  else if (boss) note(G, st.bass, root - 12 + (step % 4 === 3 ? 7 : step === 8 ? 12 : 0), t, STEP * 0.9, { wave: 0.5, vol: 0.07, cutoff: 700, release: 0.03 });
  else if (i > 0.5) {   // gallop: da-da-DUM on every beat
    const b = step % 4;
    if (b !== 3) note(G, st.bass, root - 12 + (b === 2 ? [0, 7, 12, 7][step >> 2] : 0), t, STEP * (b === 2 ? 1.7 : 0.8), { wave: 0.5, vol: b === 2 ? 0.085 : 0.06, cutoff: 950, release: 0.03 });
  } else if (step % 2 === 0) note(G, st.bass, root - 12 + [0, 0, 7, 0, 12, 0, 7, 0][step / 2], t, STEP * 1.6, { wave: 0.5, vol: 0.08, cutoff: 900, release: 0.04 });

  // drums: marching snare, kick, hats; a roll into every phrase; heartbeat when hurt
  if (!calm) {
    if (step === 0 || step === 8 || (i > 0.5 && (step === 4 || step === 12)) || (i > 0.75 && step === 10) || (boss && (step === 3 || step === 11 || step === 14))) drum(G, st.drums, "kick", t);
    if (step === 4 || step === 12) drum(G, st.drums, "snare", t, 1);
    if (i > 0.5 && (step === 14 || step === 15 || step === 7)) drum(G, st.drums, "snare", t, 0.35);
    if (pos === 3 && step >= 12) drum(G, st.drums, "snare", t, 0.4 + (step - 12) * 0.15);
    if (i < 0.25 ? step % 4 === 2 : i < 0.45 ? step % 2 === 0 : true) drum(G, st.drums, "hat", t, step % 4 === 2 ? 1 : step % 2 ? 0.45 : 0.7);
    if (bar % 8 === 0 && step === 0 && i > 0.6) drum(G, st.drums, "crash", t, 0.7);
  }
  if (S.danger > 0.5 && (step === 0 || step === 3)) drum(G, st.drums, "heart", t, step ? 0.6 : 1);

  // lead: the theme (brass); calm plays it softly on a music-box voice
  const phrase = MOTIF[sec][S.phrase % 2][pos];
  for (const [s, m, len] of phrase) if (s === step) {
    if (calm) note(G, st.lead, m, t, STEP * len * 0.9, { wave: "tri", vol: 0.06, release: 0.5 });
    else note(G, st.lead, m, t, STEP * len * 0.92, { wave: 0.5, vol: 0.07, attack: 0.02, cutoff: 900, bright: 3200, vib: 14, glide: 0.985 });
    if (!calm) note(G, st.lead, m - 12, t, STEP * len * 0.92, { wave: 0.25, vol: 0.03, attack: 0.03, cutoff: 700, bright: 1800 });
  }
  // arp: high pulses on the chord tones (calm: a slow music box)
  if (calm ? step % 4 === 0 : true) {
    const tones = [0, iv[1], iv[2], 12, iv[2] + 12, iv[1] + 12], idx = calm ? (step / 4 + (S.pos % 2) * 2) % tones.length : [0, 1, 2, 3, 2, 1, 2, 4][step % 8];
    note(G, st.arp, root + 24 + tones[idx % tones.length], t, STEP * (calm ? 3.5 : 0.7), { wave: calm ? "tri" : 0.125, vol: calm ? 0.035 : 0.028, release: calm ? 0.45 : 0.03 });
  }
  // boss: timpani and low brass stabs
  if (boss || S.targets.boss > 0) {
    if (step === 0 || step === 8 || (pos === 3 && step >= 8 && step % 2 === 0)) drum(G, st.boss, "timp", t, { f: mtof(root - 24 + (step === 8 ? 7 : 0)), v: pos === 3 && step > 8 ? 0.6 + (step - 8) * 0.06 : 1 });
    if (step === 0 || (pos % 2 === 1 && step === 10)) for (const k of [0, 7]) note(G, st.boss, root - 12 + k, t, STEP * 5, { wave: 0.5, vol: 0.06, attack: 0.04, cutoff: 500, bright: 1600 });
  }

  // stingers wait for the next beat
  if (S.stingers.length && step % 4 === 0) for (const sting of S.stingers.splice(0)) sting(G, t);
}

// ---------------------------------------------------------------- stingers
const brass = (G, m, t, len, vol = 0.09) => {
  note(G, G.stems.sting, m, t, len, { wave: 0.5, vol, attack: 0.02, cutoff: 1000, bright: 3600, vib: 12 });
  note(G, G.stems.sting, m - 12, t, len, { wave: 0.25, vol: vol * 0.45, attack: 0.03, cutoff: 800, bright: 2000 });
};
const STINGERS = {
  clear: (G, t) => {   // rising fanfare that resolves to D major
    [[0, 69], [1, 74], [2, 78], [3, 81]].forEach(([k, m]) => brass(G, m, t + k * STEP * 2, STEP * 1.8));
    for (const m of [74, 78, 81, 86]) brass(G, m, t + STEP * 8, STEP * 12, 0.06);
    drum(G, G.stems.sting, "crash", t + STEP * 8, 1); drum(G, G.stems.sting, "kick", t + STEP * 8, 1);
    for (let k = 0; k < 6; k++) drum(G, G.stems.sting, "snare", t + k * STEP, 0.4 + k * 0.1);
  },
  boss: (G, t) => {   // the boss lands: low brass and a timpani roll
    for (const m of [38, 45, 50]) brass(G, m, t, STEP * 14, 0.08);
    for (let k = 0; k < 12; k++) drum(G, G.stems.sting, "timp", t + k * STEP, { f: mtof(38), v: 0.4 + k * 0.05 });
    drum(G, G.stems.sting, "crash", t + STEP * 12, 1);
  },
  dead: (G, t) => {   // falling minor line
    [81, 79, 77, 76, 74].forEach((m, k) => brass(G, m, t + k * STEP * 3, STEP * 2.8, 0.07));
    for (const m of [50, 53, 57]) note(G, G.stems.sting, m, t + STEP * 15, STEP * 16, { wave: "tri", vol: 0.07, attack: 0.1, release: 0.8 });
  },
  won: (G, t) => {   // full fanfare
    [[0, 74], [2, 78], [4, 81], [6, 86], [10, 81], [12, 86]].forEach(([k, m]) => brass(G, m, t + k * STEP, STEP * 1.8));
    for (const m of [62, 66, 69, 74, 78, 81]) brass(G, m, t + STEP * 16, STEP * 20, 0.05);
    drum(G, G.stems.sting, "crash", t + STEP * 16, 1.2);
    for (let k = 0; k < 16; k++) drum(G, G.stems.sting, "snare", t + k * STEP, 0.3 + k * 0.04);
  },
};

// ---------------------------------------------------------------- context -> stem levels
const LEVELS = {
  title:  { pad: 0.9, bass: 0.6, drums: 0, lead: 0.8, arp: 0.9, boss: 0 },
  hangar: { pad: 0.9, bass: 0.7, drums: 0, lead: 0.7, arp: 0.8, boss: 0 },
};
function targetsFor(c, S) {
  if (c.mode === "title" || c.mode === "hangar") return LEVELS[c.mode];
  if (c.mode === "over") return { pad: 0.5, bass: 0, drums: 0, lead: 0, arp: 0, boss: 0 };
  const i = S.intensity;
  return {
    pad: 0.8, bass: 0.55 + 0.45 * i,
    drums: i > 0.12 || c.boss ? 0.55 + 0.45 * i : 0.25,
    lead: i > 0.35 || c.boss ? 0.9 : 0,
    arp: i > 0.62 ? 0.8 : 0,
    boss: c.boss ? 1 : 0,
  };
}
function sectionFor(c, S) {
  if (c.mode !== "combat") return "calm";
  if (c.boss) return "boss";
  return S.intensity > 0.7 || c.darkness > 0.72 ? "tension" : "heroic";
}

// ---------------------------------------------------------------- live engine
// Music volume 0..1 (the settings slider); 0 stops the scheduler. Default 0.6 of the old level, so the
// effects sit on top (user: "the music is louder than the effects by a fair bit").
const BUS = 0.5;
let G = null, timer = 0, enabled = true, vol = 0.6;
try {
  const v = localStorage.getItem("mech.vol.music");
  vol = v != null ? Math.max(0, Math.min(1, +v)) : localStorage.getItem("mech.music") === "0" ? 0 : 0.6;   // the old on/off switch carries over
} catch {}
enabled = vol > 0;
const S = { step: 0, section: "calm", next: null, urgent: false, phrase: 0, pos: 0, intensity: 0, danger: 0, targets: {}, stingers: [], nextT: 0, mode: "title" };

onAudioReady((ac, out) => { G = makeGraph(ac, out); if (enabled) start(); });

function start() {
  if (!G || timer) return;
  S.nextT = G.ac.currentTime + 0.12;
  G.bus.gain.setTargetAtTime(BUS * vol, G.ac.currentTime, 0.5);
  timer = setInterval(tick, 25);
}
function stop() {
  if (!G) return;
  G.bus.gain.setTargetAtTime(0, G.ac.currentTime, 0.15);
  clearInterval(timer); timer = 0;
}
function tick() {
  if (document.hidden) { S.nextT = G.ac.currentTime + 0.1; return; }
  const ahead = G.ac.currentTime + 0.15;
  if (S.nextT < G.ac.currentTime - 0.3) S.nextT = G.ac.currentTime + 0.05;   // fell behind (tab throttled): rejoin
  while (S.nextT < ahead) { scheduleStep(G, S, S.nextT); S.nextT += STEP; S.step++; }
}

export const musicEnabled = () => enabled;
export const musicVolume = () => vol;
export function setMusicVolume(v) {
  vol = Math.max(0, Math.min(1, v)); enabled = vol > 0;
  try { localStorage.setItem("mech.vol.music", String(vol)); } catch {}
  if (!enabled) stop(); else if (!timer) start(); else if (G) G.bus.gain.setTargetAtTime(BUS * vol, G.ac.currentTime, 0.1);
}
export function setMusicEnabled(on) {
  enabled = on;
  try { localStorage.setItem("mech.music", on ? "1" : "0"); } catch {}
  on ? start() : stop();
}

/** Called every frame with the game's situation. c: { mode: title|hangar|combat|over, threat 0..1,
 *  boss, danger 0..1, vent, paused, darkness } */
export function updateMusic(c, dt) {
  // intensity rises fast and falls slowly, so the music doesn't flicker with the fight
  const want = c.mode === "combat" ? c.threat : 0;
  S.intensity += (want - S.intensity) * Math.min(1, dt * (want > S.intensity ? 1.5 : 0.25));
  S.danger = c.danger || 0;
  const sec = sectionFor(c, S);
  if (sec !== S.section && sec !== S.next) { S.next = sec; S.urgent = sec === "boss"; }
  S.targets = targetsFor(c, S);
  if (!G || !timer) return;
  const now = G.ac.currentTime;
  for (const [k, v] of Object.entries(S.targets)) G.stems[k].gain.setTargetAtTime(v, now, 1.2);
  // muffle the music while paused or venting (the coolant roar takes over)
  G.filt.frequency.setTargetAtTime(c.paused ? 700 : c.vent ? 1400 : 18000, now, 0.25);
  G.bus.gain.setTargetAtTime((c.paused ? 0.3 : BUS) * vol, now, 0.3);
}

/** Queue a stinger (clear | boss | dead | won); it lands on the next beat. */
export function stinger(kind) { if (STINGERS[kind]) S.stingers.push(STINGERS[kind]); }

// ---------------------------------------------------------------- offline preview (for listening tests)
/** Render a scripted timeline to an AudioBuffer: timeline = [[bar, context, stinger?], ...] */
export async function renderPreview(timeline, bars) {
  const sr = 44100, dur = bars * 16 * STEP + 3;
  const off = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const comp = off.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6; comp.connect(off.destination);
  const g = makeGraph(off, comp);
  g.bus.gain.value = 0.5;
  const s = { step: 0, section: "calm", next: null, urgent: false, phrase: 0, pos: 0, intensity: 0, danger: 0, targets: {}, stingers: [] };
  let ti = 0, ctx = timeline[0][1];
  for (let step = 0; step < bars * 16; step++) {
    const bar = Math.floor(step / 16), t = step * STEP + 0.05;
    while (ti < timeline.length && timeline[ti][0] <= bar && step % 16 === 0) {
      ctx = timeline[ti][1];
      if (timeline[ti][2]) s.stingers.push(STINGERS[timeline[ti][2]]);
      ti++;
    }
    for (let k = 0; k < 4; k++) {   // follow the intensity like the live engine does (4 updates per step)
      const want = ctx.mode === "combat" ? ctx.threat : 0;
      s.intensity += (want - s.intensity) * Math.min(1, (STEP / 4) * (want > s.intensity ? 1.5 : 0.25));
    }
    s.danger = ctx.danger || 0;
    const sec = sectionFor(ctx, s);
    if (sec !== s.section && sec !== s.next) { s.next = sec; s.urgent = sec === "boss"; }
    s.targets = targetsFor(ctx, s);
    for (const [k, v] of Object.entries(s.targets)) g.stems[k].gain.setTargetAtTime(v, t, 1.2);
    g.filt.frequency.setTargetAtTime(ctx.vent ? 1400 : 18000, t, 0.25);
    s.step = step;
    scheduleStep(g, s, t);
  }
  return off.startRendering();
}

/** Debug/test readout */
export const musicState = () => ({ running: !!timer, section: S.section, next: S.next, intensity: +S.intensity.toFixed(2), targets: S.targets, bar: Math.floor(S.step / 16) });

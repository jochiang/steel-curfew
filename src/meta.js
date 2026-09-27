// Between-run progression and saves, kept in this browser's localStorage. Every access is guarded:
// storage can be missing, full or blocked (private windows), and the game must still run.

import { WEAPONS, CHASSIS } from "./content.js";
import { recompute, attachLedger } from "./game.js";
import { afterAction } from "./report.js";

const KEY = "mech.meta.v1", RUN_KEY = "mech.run.v1";

// Unlocks are earned from career totals. Everything else is available from the start.
export const UNLOCKS = {
  chassis: {
    bulwark: { req: "Reach wave 3", test: (c) => c.bestWave >= 3 },
    kestrel: { req: "Destroy 300 enemies", test: (c) => c.kills >= 300 },
    tempest: { req: "Reach wave 5", test: (c) => c.bestWave >= 5 },
  },
  weapons: {
    missiles: { req: "Level 20 buildings", test: (c) => c.buildings >= 20 },
    pyre: { req: "Destroy 10 elites", test: (c) => c.elites >= 10 },
    rail: { req: "Defeat a boss", test: (c) => c.bosses >= 1 },
  },
};

const fresh = () => ({
  career: { runs: 0, wins: 0, kills: 0, elites: 0, bosses: 0, buildings: 0, bestWave: 0, bestCurfew: 0, time: 0 },
  unlocked: { chassis: [], weapons: [] },
  history: [],
  settings: {},
  unlockAll: false,
});

function read(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
}
function write(key, v) {
  try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; }
}

let meta = { ...fresh(), ...(read(KEY) || {}) };
meta.career = { ...fresh().career, ...meta.career };
meta.unlocked = { ...fresh().unlocked, ...meta.unlocked };
const persist = () => write(KEY, meta);

let session = false;   // ?unlockall: everything open for this page load only
export const unlockForSession = () => { session = true; };
export const getMeta = () => meta;
export function setUnlockAll(on) { meta.unlockAll = !!on; persist(); }
export function saveSettings(s) { meta.settings = { ...meta.settings, ...s }; persist(); }

export function isUnlocked(kind, key) {
  if (meta.unlockAll || session) return true;
  const u = UNLOCKS[kind][key];
  return !u || meta.unlocked[kind].includes(key);
}
export const allowedWeapons = () => Object.keys(WEAPONS).filter((k) => isUnlocked("weapons", k));
export const allowedChassis = () => Object.keys(CHASSIS).filter((k) => isUnlocked("chassis", k));

/** Fold the run's tallies into the career and return anything newly unlocked */
function checkUnlocks() {
  const got = [];
  for (const kind of ["chassis", "weapons"]) for (const [k, u] of Object.entries(UNLOCKS[kind])) {
    if (!meta.unlocked[kind].includes(k) && u.test(meta.career)) {
      meta.unlocked[kind].push(k);
      got.push({ kind, key: k, name: (kind === "chassis" ? CHASSIS : WEAPONS)[k].name });
    }
  }
  return got;
}

/** Called when a wave is cleared (and at the end of a run): bank this run's progress so far. */
export function recordProgress(run, reached = run.wave + 1) {
  const t = run.tally, seen = run.banked || (run.banked = { kills: 0, elites: 0, bosses: 0, buildings: 0, time: 0 });
  const c = meta.career;
  for (const k of ["kills", "elites", "bosses", "buildings"]) { c[k] += t[k] - seen[k]; seen[k] = t[k]; }
  c.time += run.time - seen.time; seen.time = run.time;
  c.bestWave = Math.max(c.bestWave, reached);
  const got = checkUnlocks();
  persist();
  if (got.length) { run.unlocks = [...(run.unlocks || []), ...got]; run.allowed = allowedWeapons(); }
  return got;
}

export function recordEnd(run) {
  const got = recordProgress(run);
  meta.career.bestCurfew = Math.max(meta.career.bestCurfew, run.curfew || 0);
  const entry = { chassis: run.chassisKey, wave: run.wave + 1, won: run.phase === "won" || !!run.endless, kills: run.kills, level: run.level, tod: run.tod, curfew: run.curfew || 0, rating: afterAction(run).title };
  const prev = run.recordedAt && meta.history.find((h) => h.at === run.recordedAt);
  if (run.recordedAt) { if (prev) Object.assign(prev, entry); }   // an endless run ending: the win was already counted
  else {
    run.recordedAt = Date.now();
    meta.career.runs++;
    if (run.phase === "won") meta.career.wins++;
    meta.history.unshift({ at: run.recordedAt, ...entry });
    meta.history.length = Math.min(meta.history.length, 12);
  }
  persist();
  clearSavedRun();
  return got;
}

// ---------------------------------------------------------------- mid-run save (at the hangar)
const TYPED = ["tile", "ground", "bid", "roadDir"];
export function saveRun(run) {
  const city = run.city, c = {};
  for (const [k, v] of Object.entries(city)) c[k] = TYPED.includes(k) ? Array.from(v) : v;
  const data = {};
  for (const [k, v] of Object.entries(run)) {
    if (["rand", "chassis", "stats", "field", "heavyField", "mounts", "city", "events"].includes(k)) continue;
    data[k] = v;
  }
  data.randState = run.rand.get();
  data.city = c;
  data.savedAt = Date.now();
  return write(RUN_KEY, data);
}

export function savedRunSummary() {
  const d = read(RUN_KEY);
  if (!d) return null;
  return { wave: d.wave + 2, chassis: d.chassisKey, level: d.level, phase: d.phase, curfew: d.endless ? d.wave - 3 : 0 };
}

/** Rebuild a live run from the save; `makeRun` is newRun (to get a well-formed object to fill in). */
export function loadRun(makeRun) {
  const d = read(RUN_KEY);
  if (!d) return null;
  try {
    const run = makeRun({ seed: d.seed, chassis: d.chassisKey, start: "autocannon", ventMode: d.ventMode, targeting: d.targeting, tod: d.tod });
    const { city, randState, savedAt, ...rest } = d;
    Object.assign(run, rest);
    const Types = { tile: Uint8Array, ground: Uint8Array, bid: Int16Array, roadDir: Uint8Array };
    for (const k of TYPED) city[k] = Types[k].from(city[k]);
    run.city = city;
    run.rand.set(randState);
    run.field.version = -1; run.heavyField.version = -1;   // force the flow fields to rebuild
    recompute(run);
    attachLedger(run);   // the city's damage hook doesn't survive a save
    return run;
  } catch { clearSavedRun(); return null; }
}
export const clearSavedRun = () => write(RUN_KEY, null);

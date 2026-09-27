// Fuzz the simulation: random frames, loadouts (any tier), modules, perks, erratic movement,
// through the late waves and past curfew (endless). Reports the first error per distinct message with a stack.
//   node tools/fuzz.mjs [runs=300]
import { newRun, update, nextWave, startWave, choosePerk, recompute, assignMounts, stayOut } from "../src/game.js";
import { botMove } from "../src/bot.js";
import { WEAPONS, MODULES, CHASSIS, PERKS } from "../src/content.js";
import { mulberry32 } from "../src/rng.js";

// every weapon and enemy needs its art (a weapon without a sprite once broke the renderer on a phone)
const { WEAPON_ART } = await import("../src/art.js"), { ENEMIES } = await import("../src/content.js");
const artSrc = (await import("node:fs")).readFileSync(new URL("../src/art.js", import.meta.url), "utf8");
const noArt = [...Object.keys(WEAPONS).filter((k) => !WEAPON_ART[k]).map((k) => "weapon " + k), ...Object.keys(ENEMIES).filter((k) => !artSrc.includes(`case "${k}"`)).map((k) => "enemy " + k)];
if (noArt.length) { console.log("MISSING ART:", noArt.join(", ")); process.exitCode = 1; }

const RUNS = +(process.argv[2] || 300), seen = new Map();
const pick = (r, a) => a[Math.floor(r() * a.length)];
let ok = 0;
for (let i = 0; i < RUNS; i++) {
  const r = mulberry32(9000 + i), ch = pick(r, Object.keys(CHASSIS));
  const seed = (i % 2 ? -1 : 1) * (9000 + i);   // real seeds can be negative (a wave-5/8 crash hid there)
  const run = newRun({ seed, chassis: ch, start: "autocannon", tod: pick(r, ["day", "dusk", "night", null]) });
  try {
    run.weapons.length = 0;
    const n = 1 + Math.floor(r() * run.chassis.hardpoints.length);
    for (let k = 0; k < n; k++) run.weapons.push({ key: pick(r, Object.keys(WEAPONS)), tier: Math.floor(r() * 4), cd: 0, mag: 5, reloadT: 0 });
    run.modules = Array.from({ length: Math.floor(r() * 8) }, () => pick(r, Object.keys(MODULES)));
    run.perks = Array.from({ length: Math.floor(r() * 10) }, () => { const k = pick(r, Object.keys(PERKS)); return { key: k, rare: r() < 0.3, fx: PERKS[k][r() < 0.3 ? 3 : 2] }; });
    recompute(run);
    if (r() < 0.3) { run.wave = 5 + Math.floor(r() * 10); run.endless = true; }   // straight into endless, up to +10
    else run.wave = 2 + Math.floor(r() * 3);
    startWave(run);
    let t = 0;
    while (run.phase !== "dead" && t < 60 * 400 && run.wave < 16) {
      if (run.phase === "won") { if (r() < 0.7) { stayOut(run); continue; } break; }
      if (run.phase === "levelup") { choosePerk(run, 0); continue; }
      if (run.phase === "hangar") { nextWave(run); continue; }
      if (r() < 0.02) run.player.hp = Math.max(1, run.player.hp);   // let some runs go on
      const mv = r() < 0.5 ? botMove(run) : { x: Math.cos(t / 40 + i), y: Math.sin(t / 55) };
      update(run, 1 / 60, mv); t++;
      // NaN poisoning freezes the game without throwing (camera and mech go to NaN), so look for it
      const p = run.player, bad = !Number.isFinite(p.x + p.y + p.hp) ? "player" : !Number.isFinite(run.cap.charge + run.cap.vent + run.freeze + run.shake) ? "cap/freeze/shake"
        : ["enemies", "shots", "bolts", "missiles", "pickups"].find((k) => run[k].some((o) => !Number.isFinite(o.x + o.y))) || (run.shells.some((o) => !Number.isFinite(o.tx + o.ty + o.x0 + o.y0)) && "shells");
      if (bad) throw new Error(`NaN in ${bad}`);
      if (run.player.hp < run.stats.maxHp * 0.2 && r() < 0.5) run.player.hp = run.stats.maxHp;   // keep most runs alive to the end
    }
    ok++;
  } catch (e) {
    const key = e.message;
    if (!seen.has(key)) seen.set(key, { count: 0, stack: e.stack.split("\n").slice(0, 6).join("\n"), example: { seed, chassis: ch, wave: run.wave + 1, weapons: run.weapons.map((w) => w.key + w.tier), time: run.waveTime.toFixed(1) } });
    seen.get(key).count++;
  }
}
console.log(`${ok}/${RUNS} runs clean`);
for (const [msg, v] of seen) console.log(`\n${v.count}x ${msg}\n${v.stack}\nexample: ${JSON.stringify(v.example)}`);

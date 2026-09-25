// Economy / damage test: every frame x every starting family it can mount x N seeds.
// The pilot is the kiting bot, kept alive so every run plays all 5 waves; whether a real player
// would have survived a wave is judged from damage taken vs the hull (+ repairs) for that wave.
// Shopping and level-ups follow a sensible build-around-your-weapon policy.
//
//   node tools/balance.mjs [seeds=6] [--json out.json]
import { newRun, update, nextWave, blocked, buy, reroll, rerollCost, choosePerk, weaponDmg } from "../src/game.js";
import { botMove } from "../src/bot.js";
import { WEAPONS, MODULES, CHASSIS, WAVES, HARDPOINT, ENEMIES, PERKS, SHOP } from "../src/content.js";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const SEEDS = +(args.find((a) => /^\d+$/.test(a)) || 6);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const STEP = 1 / 60;

// --proposal: try tuning changes in memory, without touching the game files
if (args.includes("--proposal")) {
  Object.assign(ENEMIES.mortar, { lobEvery: 4.2, maxAlive: 3 });
  Object.assign(ENEMIES.mortar.shell, { dmg: 10, radius: 18 });
  Object.assign(ENEMIES.sapper.blast, { dmg: 13, radius: 22 });
  ENEMIES.crusher.hp = 460; ENEMIES.siege.hp = 590;
  PERKS.hull[2] = { maxHp: 10 }; PERKS.hull[3] = { maxHp: 22 };
  MODULES.frame.fx = { maxHp: 20 };
  SHOP.waveBonus = (w) => 10 + 5 * w;
  console.log("(proposal tuning applied in memory)");
}

const FAMILY_START = { ballistic: "autocannon", energy: "lance", melee: "chainblade" };
const DMG_MOD = { ballistic: "barrels", energy: "lens", melee: "servos" };
const HELPERS = { ballistic: ["feed", "targeting"], energy: ["reactor", "sinks", "lens"], melee: ["servos", "actuator"] };
const DMG_PERK = { ballistic: "gunnery", energy: "focusing", melee: "brawler" };

function score(run, o, fam) {
  if (o.kind === "weapon") {
    const def = WEAPONS[o.key];
    if (run.weapons.some((w) => w.key === o.key)) return 5;
    if (def.family === fam) return 4;
    return 1.5;
  }
  if (o.key === DMG_MOD[fam]) return 3.2;
  if (HELPERS[fam].includes(o.key)) return 2.4;
  if (o.key === "plating") return 2.5;
  if (o.key === "frame" || o.key === "nanites") return 2;
  if (o.key === "loops" && fam !== "energy" && run.weapons.some((w) => WEAPONS[w.key].family === "energy")) return 2;
  return 0.6;
}
function shop(run, fam) {
  let rerolls = 0;
  for (let guard = 0; guard < 12; guard++) {
    const opts = run.shop.offers.map((o, i) => [o, i]).filter(([o]) => !blocked(run, o)).map(([o, i]) => [score(run, o, fam), i]).sort((a, b) => b[0] - a[0]);
    if (opts.length && opts[0][0] >= 1.4) { buy(run, opts[0][1]); continue; }
    if (rerolls < 1 && run.salvage >= rerollCost(run) + 25) { reroll(run); rerolls++; continue; }
    break;
  }
}
function levelUp(run, fam) {
  const pref = [DMG_PERK[fam], "hull", "plating", "repair", fam === "energy" ? "charge" : fam === "ballistic" ? "loader" : "servos", "coolant", "optics"];
  while (run.phase === "levelup") {
    const i = run.perkOffers.map((o) => pref.indexOf(o.key)).map((r) => (r < 0 ? 99 : r)).reduce((best, r, k, arr) => (r < arr[best] ? k : best), 0);
    choosePerk(run, i);
  }
}

function play(chassis, start, seed) {
  const fam = WEAPONS[start].family;
  const run = newRun({ seed, chassis, start, tod: "day" });
  const rows = [];
  while (run.phase !== "won") {
    const w = run.wave, m0 = { ...run.m, bySrc: { ...run.m.bySrc } }, lvl0 = run.level;
    const maxHp = run.stats.maxHp, regen = run.stats.regen;
    let firstDeath = null;
    while (run.phase === "combat") {
      run.player.hp = 1e9;   // kept alive; survival is judged from damage taken below
      update(run, STEP, botMove(run));
      if (firstDeath === null && run.m.taken - m0.taken > maxHp + regen * run.waveTime) firstDeath = run.waveTime;
    }
    const dur = WAVES[w].duration, dealt = run.m.dealt - m0.dealt, spawned = run.m.hpSpawned - m0.hpSpawned;
    const row = {
      wave: w + 1, dps: dealt / dur, pressure: spawned / dur, killRatio: spawned ? dealt / spawned : 1,
      taken: run.m.taken - m0.taken, pool: maxHp + regen * dur, survived: firstDeath === null, diedAt: firstDeath,
      hits: run.m.hits - m0.hits, earned: run.m.earned - m0.earned, level: run.level, levels: run.level - lvl0,
      weaponDps: run.weapons.reduce((t, x) => t + weaponDmg(run, x), 0),
      bySrc: Object.fromEntries(Object.entries(run.m.bySrc).map(([k, v]) => [k, v - (m0.bySrc[k] || 0)])),
      boss: w === WAVES.length - 1 ? { type: run.m.bossType, ttk: run.m.bossKillT != null ? run.m.bossKillT - run.m.bossSpawnT : null, hp: run.m.bossHp } : null,
    };
    if (run.phase === "won") { rows.push(row); break; }
    const s0 = run.salvage;
    if (run.phase === "levelup") levelUp(run, fam);
    shop(run, fam);
    row.salvageAtHangar = s0; row.spent = s0 - run.salvage; row.loadout = run.weapons.map((x) => x.key + (x.tier + 1)).join(" ") + " | " + run.modules.join(",");
    rows.push(row);
    nextWave(run);
  }
  return rows;
}

// ---------------------------------------------------------------- run the matrix
const results = [];
for (const [ck, ch] of Object.entries(CHASSIS)) {
  const fams = ["ballistic", "energy", "melee"].filter((f) => ch.hardpoints.some((h) => h === "U" || HARDPOINT[h] === f));
  for (const fam of fams) for (let i = 0; i < SEEDS; i++) results.push({ chassis: ck, fam, seed: 500 + i, rows: play(ck, FAMILY_START[fam], 500 + i) });
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (x) => `${Math.round(x * 100)}%`.padStart(4);
const f1 = (x) => x.toFixed(1).padStart(6), f0 = (x) => Math.round(x).toString().padStart(5);

console.log(`\n${results.length} runs (${Object.keys(CHASSIS).length} frames x families x ${SEEDS} seeds), pilot = kiting bot kept alive\n`);
console.log("ECONOMY + DAMAGE by wave (all runs)");
console.log("wave  earned  spent  banked | your DPS  enemy HP/s  kill%  | dmg taken  hull+repair  survive%  | pilot lvl");
for (let w = 1; w <= WAVES.length; w++) {
  const r = results.map((x) => x.rows[w - 1]).filter(Boolean);
  console.log(`  ${w}   ${f0(mean(r.map((x) => x.earned)))}  ${f0(mean(r.map((x) => x.spent || 0)))}  ${f0(mean(r.map((x) => (x.salvageAtHangar || 0) - (x.spent || 0))))}  | ${f1(mean(r.map((x) => x.dps)))}   ${f1(mean(r.map((x) => x.pressure)))}    ${pct(mean(r.map((x) => Math.min(1, x.killRatio))))}  |  ${f0(mean(r.map((x) => x.taken)))}      ${f0(mean(r.map((x) => x.pool)))}       ${pct(mean(r.map((x) => (x.survived ? 1 : 0))))}   |  ${mean(r.map((x) => x.level)).toFixed(1)}`);
}

console.log("\nSURVIVAL by frame x family (share of runs that would survive each wave; 'run' = all five)");
console.log("frame     family     w1   w2   w3   w4   w5   run   | wave-5 DPS  boss TTK (killed%)");
for (const ck of Object.keys(CHASSIS)) for (const fam of ["ballistic", "energy", "melee"]) {
  const rs = results.filter((x) => x.chassis === ck && x.fam === fam);
  if (!rs.length) continue;
  const surv = [1, 2, 3, 4, 5].map((w) => mean(rs.map((x) => (x.rows[w - 1]?.survived ? 1 : 0))));
  const all = mean(rs.map((x) => (x.rows.every((r) => r.survived) ? 1 : 0)));
  const b = rs.map((x) => x.rows[4]?.boss).filter(Boolean), killed = b.filter((x) => x.ttk != null);
  console.log(`${ck.padEnd(9)} ${fam.padEnd(9)} ${surv.map(pct).join(" ")}  ${pct(all)}  |  ${f1(mean(rs.map((x) => x.rows[4]?.dps || 0)))}    ${killed.length ? `${mean(killed.map((x) => x.ttk)).toFixed(0)}s` : "  -"} (${pct(killed.length / (b.length || 1))})`);
}

console.log("\nBOSSES");
for (const type of ["crusher", "siege"]) {
  const b = results.map((x) => x.rows[4]?.boss).filter((x) => x && x.type === type), killed = b.filter((x) => x.ttk != null);
  console.log(`${type.padEnd(8)} fights ${b.length}  killed ${pct(killed.length / (b.length || 1))}  mean TTK ${killed.length ? mean(killed.map((x) => x.ttk)).toFixed(1) + "s" : "-"}  (wave 5 lasts ${WAVES[4].duration}s, boss arrives at ~3s, HP ${Math.round(mean(b.map((x) => x.hp)))})`);
}

console.log("\nINCOMING DAMAGE by source (share of damage taken, per wave)");
const srcs = [...new Set(results.flatMap((x) => x.rows.flatMap((r) => Object.keys(r.bySrc))))];
const tot = (w) => mean(results.map((x) => Object.values(x.rows[w - 1]?.bySrc || {}).reduce((a, b) => a + b, 0)));
console.log("source".padEnd(18) + [1, 2, 3, 4, 5].map((w) => `   w${w}`).join(""));
for (const s of srcs.sort()) console.log(s.padEnd(18) + [1, 2, 3, 4, 5].map((w) => pct(mean(results.map((x) => x.rows[w - 1]?.bySrc[s] || 0)) / (tot(w) || 1)).padStart(6)).join(""));

const deaths = results.flatMap((x) => x.rows.filter((r) => !r.survived).map((r) => r.wave));
console.log(`\nfirst wave a player would die on: ${[1, 2, 3, 4, 5].map((w) => `w${w} ${deaths.filter((d) => d === w).length}`).join("  ")}`);
const sample = results.find((x) => x.chassis === "warden" && x.fam === "ballistic");
if (sample) console.log(`\nsample Warden/ballistic build by wave 4 hangar: ${sample.rows[3]?.loadout}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results));

// Headless balance sim: the bot plays full runs in Node, no browser.
//   node tools/sim.mjs [runs=40] [start=all] [vent=all|energy|both] [targeting=crowd|heavies|nearest] [chassis=warden]
import { newRun, update, nextWave } from "../src/game.js";
import { botMove, botShop } from "../src/bot.js";
import { WEAPONS, WAVES } from "../src/content.js";

const [runs = 40, startArg = "all", ventArg = "both", targeting = "crowd", chassis = "warden"] = process.argv.slice(2);
import { CHASSIS } from "../src/content.js";
import { canMount } from "../src/game.js";
const starts = (startArg === "all" ? Object.keys(WEAPONS) : startArg.split(",")).filter((k) => canMount(CHASSIS[chassis], WEAPONS[k].family));
const vents = ventArg === "both" ? ["all", "energy"] : [ventArg];
const STEP = 1 / 60;

function play(seed, start, ventMode) {
  const run = newRun({ seed, chassis, start, ventMode, targeting });
  let hpLow = 1, ventTime = 0, t = 0;
  while (run.phase !== "dead" && run.phase !== "won" && t < 60 * 60 * 10) {
    if (run.phase === "hangar") { botShop(run); nextWave(run); continue; }
    update(run, STEP, botMove(run));
    if (run.cap.vent > 0) ventTime += STEP;
    hpLow = Math.min(hpLow, run.player.hp / run.stats.maxHp);
    t++;
  }
  return { won: run.phase === "won", wave: run.wave + 1, kills: run.kills, ventFrac: ventTime / run.time, hpLow };
}

console.log(`runs=${runs} per cell; waves=${WAVES.length}`);
console.log("start".padEnd(12), "vent".padEnd(7), "win%".padStart(5), "avgWave".padStart(8), "kills".padStart(6), "vent%".padStart(6));
for (const start of starts) for (const vent of vents) {
  const res = Array.from({ length: +runs }, (_, i) => play(1000 + i, start, vent));
  const avg = (f) => res.reduce((s, r) => s + f(r), 0) / res.length;
  console.log(start.padEnd(12), vent.padEnd(7),
    String(Math.round(avg((r) => r.won) * 100)).padStart(5),
    avg((r) => r.wave).toFixed(2).padStart(8), Math.round(avg((r) => r.kills)).toString().padStart(6),
    String(Math.round(avg((r) => r.ventFrac) * 100)).padStart(6));
}

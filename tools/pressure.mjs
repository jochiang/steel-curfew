// node tools/pressure.mjs : the spawn schedule as numbers (enemies, HP per second, peak alive) per wave
// Per-wave pressure: enemies spawned, total HP spawned per second, peak alive. Immortal, stationary mech
// with no weapons firing (so nothing dies): pure spawn schedule.
import { newRun, update, startWave } from "../src/game.js";
import { WAVES } from "../src/content.js";
const run = newRun({ seed: 7, start: "autocannon" });
run.weapons.length = 0;
for (let w = 0; w < WAVES.length; w++) {
  run.wave = w; startWave(run); run.stats.maxHp = run.player.hp = 1e9;
  const seen = new Set(); let hp = 0, peak = 0;
  while (run.phase === "combat" && run.clearing <= 0) {
    update(run, 1 / 60, { x: 0, y: 0 });
    for (const e of run.enemies) if (!seen.has(e)) { seen.add(e); hp += e.maxHp; }
    peak = Math.max(peak, run.enemies.length);
  }
  const d = WAVES[w].duration;
  console.log(`wave ${w + 1}: ${d}s  spawned ${seen.size}  (${(seen.size / d).toFixed(1)}/s)  hp/s ${(hp / d).toFixed(0)}  peak alive ${peak}${peak >= 255 ? " (CAP)" : ""}`);
  run.phase = "combat"; run.clearing = 0;
}

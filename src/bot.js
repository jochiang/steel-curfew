// Test pilot for headless playthroughs (?bot). Scores 16 headings by how much danger the mech
// would be in a short step ahead, whether the way is open, and a nudge towards salvage; keeps
// some momentum so it doesn't dither. Not meant to be good, just to exercise the loop.
import { WEAPONS } from "./content.js";
import { blocked, buy } from "./game.js";
import { solidAt } from "./city.js";

let lastA = 0;

export function botMove(run) {
  const p = run.player, city = run.city;
  const melee = run.weapons.some((w) => WEAPONS[w.key].family === "melee");
  let best = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
    // blocked soon? check a few points ahead at the mech's radius
    let open = 1;
    for (const d of [10, 20, 34]) {
      const x = p.x + cx * d, y = p.y + cy * d;
      if (solidAt(city, x, y) || solidAt(city, x + cy * 7, y - cx * 7) || solidAt(city, x - cy * 7, y + cx * 7)) { open = d === 10 ? 0 : d === 20 ? 0.3 : 0.7; break; }
    }
    if (!open) continue;
    const nx = p.x + cx * 24, ny = p.y + cy * 24;
    let danger = 0;
    for (const e of run.enemies) {
      const d = Math.hypot(e.x - nx, e.y - ny);
      if (d < 90) danger += (e.d.boss ? 4 : e.d.mass >= 3 ? 2 : 1) * (melee ? 0.5 : 1) * (90 - d) / 90;
    }
    for (const b of run.bolts) if (Math.hypot(b.x - nx, b.y - ny) < 22) danger += 2;
    let lure = 0;
    const tgt = melee ? run.enemies[0] : run.pickups[0];
    if (tgt) { const d = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1; lure = ((tgt.x - p.x) / d) * cx + ((tgt.y - p.y) / d) * cy; }
    const score = -danger * 3 + open * 2 + lure * 0.6 + Math.cos(a - lastA) * 0.8;
    if (!best || score > best.score) best = { a, score };
  }
  if (!best) return { x: 0, y: 0 };
  lastA = best.a;
  return { x: Math.cos(best.a), y: Math.sin(best.a) };
}

export function botShop(run) {
  for (let pass = 0; pass < 4; pass++) {
    const i = run.shop.offers.findIndex((o) => !blocked(run, o));
    if (i < 0) break;
    buy(run, i);
  }
}

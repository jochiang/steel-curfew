// Test pilot for headless playthroughs (?bot). Kites away from nearby enemies, circles when
// crowded, drifts toward salvage and away from walls. Not meant to be good, just to exercise the loop.
import { ARENA, WEAPONS } from "./content.js";
import { blocked, buy } from "./game.js";

export function botMove(run) {
  const p = run.player;
  let fx = 0, fy = 0;
  for (const e of run.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d > 110) continue;
    const w = (e.d.boss ? 4 : 1) / (d * d);
    fx += (dx / d) * w * 900; fy += (dy / d) * w * 900;
    fx += (-dy / d) * w * 500; fy += (dx / d) * w * 500;   // orbit
  }
  for (const b of run.bolts) {
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
    if (d < 40) { fx += (-b.vy / 90) * 1.5; fy += (b.vx / 90) * 1.5; }
  }
  const wall = 60;
  if (p.x < wall) fx += (wall - p.x) / 20;
  if (p.x > ARENA.w - wall) fx -= (p.x - ARENA.w + wall) / 20;
  if (p.y < wall) fy += (wall - p.y) / 20;
  if (p.y > ARENA.h - wall) fy -= (p.y - ARENA.h + wall) / 20;
  const melee = run.weapons.some((w) => WEAPONS[w.key].family === "melee");
  if (Math.hypot(fx, fy) < 0.4) {
    const target = melee ? nearest(run.enemies, p) : nearest(run.pickups, p);
    if (target) { const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1; fx += dx / d; fy += dy / d; }
  }
  const m = Math.hypot(fx, fy);
  return m > 0.05 ? { x: fx / Math.max(1, m), y: fy / Math.max(1, m) } : { x: 0, y: 0 };
}

const nearest = (list, p) => list.reduce((b, o) => (!b || Math.hypot(o.x - p.x, o.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? o : b), null);

export function botShop(run) {
  for (let pass = 0; pass < 4; pass++) {
    const i = run.shop.offers.findIndex((o) => !blocked(run, o));
    if (i < 0) break;
    buy(run, i);
  }
}

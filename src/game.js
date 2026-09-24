import {
  ARENA, BUILDING_DMG, CHASSIS, WEAPONS, MODULES, ENEMIES, WAVES, HEAT, SHOP, TIER_DMG, TIER_PRICE,
  PLAYER_IFRAMES, PICKUP_RADIUS, MAX_ENEMIES, CROWD_NEED, HOLD_GIVEUP, GROUP_GROW, GROUP_GROW_MAX, loadSpeed, armorMul, waveHpMul, waveDmgMul,
} from "./content.js";

import { mulberry32 } from "./rng.js";
import { generateCity, collide, clearLine, solidAt, traverse, damageAt, damageBuilding, TILE, T, COLS as TCOLS, ROWS as TROWS } from "./city.js";
import { makeField, updateField, steer, reachable } from "./flow.js";

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const pick = (rand, pool) => {
  let t = pool.reduce((s, [, w]) => s + w, 0) * rand();
  for (const [k, w] of pool) if ((t -= w) <= 0) return k;
  return pool[pool.length - 1][0];
};

// ---------------------------------------------------------------- spatial grid (enemies)
const CELL = 32, COLS = Math.ceil(ARENA.w / CELL), ROWS = Math.ceil(ARENA.h / CELL);
const grid = Array.from({ length: COLS * ROWS }, () => []);
function buildGrid(enemies) {
  for (const c of grid) c.length = 0;
  for (const e of enemies) {
    const cx = clamp((e.x / CELL) | 0, 0, COLS - 1), cy = clamp((e.y / CELL) | 0, 0, ROWS - 1);
    grid[cy * COLS + cx].push(e);
  }
}
function near(x, y, r, fn) {
  const x0 = clamp(((x - r) / CELL) | 0, 0, COLS - 1), x1 = clamp(((x + r) / CELL) | 0, 0, COLS - 1);
  const y0 = clamp(((y - r) / CELL) | 0, 0, ROWS - 1), y1 = clamp(((y + r) / CELL) | 0, 0, ROWS - 1);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) for (const e of grid[cy * COLS + cx]) fn(e);
}

// ---------------------------------------------------------------- run setup
export const TIMES_OF_DAY = ["day", "dusk", "night"];
export function newRun({ seed = Date.now(), start = "autocannon", ventMode = "all", targeting = "crowd", tod = null } = {}) {
  const todRoll = mulberry32((seed ^ 0x51ed27) >>> 0)();   // own stream, so it doesn't shift the game's rng
  const run = {
    rand: mulberry32(seed), seed, ventMode, targeting,
    tod: TIMES_OF_DAY.includes(tod) ? tod : todRoll < 0.4 ? "day" : todRoll < 0.62 ? "dusk" : "night",
    chassis: CHASSIS.warden,
    phase: "combat", wave: 0, time: 0, waveTime: 0,
    salvage: 0, kills: 0,
    weapons: [], modules: [],
    player: { x: ARENA.w / 2, y: ARENA.h / 2, hp: 0, iframes: 0, aim: 0, moving: false, hurt: 0 },
    city: generateCity(seed),   // persists for the whole run: damage piles up wave after wave
    field: makeField(false), heavyField: makeField(true),
    cap: { charge: 0, vent: 0, ventMax: 1, hold: 0 },
    enemies: [], shots: [], bolts: [], pickups: [], marks: [], fx: [], parts: [], texts: [],
    shake: 0, freeze: 0, spawnT: 0, bossSpawned: false, clearing: 0,
    events: [],   // for sound; drained by the page, capped here so headless runs don't grow it
    shop: { offers: [], rerolls: 0 },
    stats: null, load: 0,
  };
  addWeapon(run, start, 0);
  recompute(run);
  startWave(run);
  return run;
}

function addWeapon(run, key, tier) {
  run.weapons.push({ key, tier, cd: 0, mag: WEAPONS[key].mag || 0, reloadT: 0 });
}

export function recompute(run) {
  const s = {
    maxHp: run.chassis.hp, armor: 0, regen: 0, speedMul: 0, dmgBallistic: 0, dmgEnergy: 0, dmgMelee: 0,
    rangeMul: 0, reloadMul: 0, fillMul: 0, ventMul: 0, pickup: PICKUP_RADIUS, ventSpeed: 0, ventBurst: 0, isolatedLoops: 0,
  };
  for (const m of run.modules) for (const [k, v] of Object.entries(MODULES[m].fx)) s[k] += v;
  run.stats = s;
  run.load = run.weapons.reduce((t, w) => t + WEAPONS[w.key].weight, 0) + run.modules.reduce((t, m) => t + MODULES[m].weight, 0);
}

export function startWave(run) {
  const p = run.player;
  Object.assign(p, { x: run.city.spawn.x, y: run.city.spawn.y, hp: run.stats.maxHp, iframes: 0, hurt: 0 });
  Object.assign(run.cap, { charge: 0, vent: 0, hold: 0 });
  for (const w of run.weapons) Object.assign(w, { cd: 0, mag: WEAPONS[w.key].mag || 0, reloadT: 0 });
  for (const k of ["enemies", "shots", "bolts", "pickups", "marks", "fx", "parts", "texts"]) run[k].length = 0;
  run.waveTime = 0; run.spawnT = 0.6; run.bossSpawned = false; run.phase = "combat"; run.clearing = 0;
  run.events.push({ type: "waveStart" });
}

// ---------------------------------------------------------------- derived numbers (also used by UI)
export const famDmg = (s, fam) => 1 + (fam === "ballistic" ? s.dmgBallistic : fam === "energy" ? s.dmgEnergy : s.dmgMelee);
export const weaponDmg = (run, w) => WEAPONS[w.key].dmg * TIER_DMG[w.tier] * famDmg(run.stats, WEAPONS[w.key].family);
export const speedOf = (run) => run.chassis.speed * loadSpeed(run.load, run.chassis.capacity) * (1 + run.stats.speedMul);
export function capTimes(run) {
  const en = run.weapons.filter((w) => WEAPONS[w.key].family === "energy");
  if (!en.length) return null;
  const heat = en.reduce((t, w) => t + WEAPONS[w.key].heat, 0);
  return {
    fill: (HEAT.baseFill + HEAT.perExtraFill * (en.length - 1)) * Math.max(0.3, 1 + run.stats.fillMul),
    vent: (HEAT.baseVent + HEAT.ventPerHeat * heat) * Math.max(0.3, 1 + run.stats.ventMul),
  };
}
export const weaponsOffline = (run) =>
  run.cap.vent > 0 && run.ventMode === "all" && !run.stats.isolatedLoops;

// ---------------------------------------------------------------- simulation
export function update(run, dt, move) {
  if (run.phase !== "combat") return;
  if (run.events.length > 256) run.events.length = 0;
  const s = run.stats, p = run.player, rand = run.rand, wave = WAVES[run.wave];
  run.time += dt; run.waveTime += dt;

  // --- player movement
  const venting = run.cap.vent > 0;
  const spd = speedOf(run) * (venting ? 1 + s.ventSpeed : 1);
  p.moving = move.x !== 0 || move.y !== 0;
  const city = run.city;
  p.x += move.x * spd * dt; p.y += move.y * spd * dt;
  collide(city, p, run.chassis.radius);
  p.x = clamp(p.x, run.chassis.radius, ARENA.w - run.chassis.radius);
  p.y = clamp(p.y, run.chassis.radius, ARENA.h - run.chassis.radius);
  if (p.moving) { p.moveAngle = Math.atan2(move.y, move.x); breakProps(run, p.x, p.y, run.chassis.radius + 3); }
  p.iframes -= dt; p.hurt = Math.max(0, p.hurt - dt);
  p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);

  // --- wave over: everything left blows up, salvage flies home, then the hangar
  if (run.clearing > 0) {
    if (run.cap.vent > 0) run.cap.vent = Math.max(0, run.cap.vent - dt);
    tickPickups(run, dt);
    tickFx(run, dt);
    if ((run.clearing -= dt) <= 0) endWave(run);
    return;
  }

  updateField(run.field, city, p.x, p.y);
  updateField(run.heavyField, city, p.x, p.y);

  // --- spawning: telegraph marks first, enemies appear when they expire
  if (run.waveTime < wave.duration - 1.5) {
    run.spawnT -= dt;
    if (run.spawnT <= 0) {
      run.spawnT = wave.interval;
      const n = wave.group + Math.min(GROUP_GROW_MAX, Math.floor(run.waveTime / GROUP_GROW));
      const c = spawnPoint(run, 110);
      for (let i = 0, tries = 0; i < n && tries < n * 4 && run.enemies.length + run.marks.length < MAX_ENEMIES; tries++) {
        const x = c.x + (rand() - 0.5) * 36, y = c.y + (rand() - 0.5) * 36;
        if (solidAt(city, x, y) || !reachable(run.field, x, y)) continue;
        run.marks.push({ x, y, t: 0.9, max: 0.9, type: pick(rand, wave.pool) });
        i++;
      }
    }
  }
  if (wave.boss && !run.bossSpawned && run.waveTime > 3) {
    run.bossSpawned = true;
    const c = spawnPoint(run, 180);
    run.marks.push({ ...c, t: 1.6, max: 1.6, type: wave.boss });
    run.events.push({ type: "spawnBoss" });
  }
  for (const m of run.marks) {
    if ((m.t -= dt) > 0) continue;
    const d = ENEMIES[m.type], hp = d.hp * waveHpMul(run.wave);
    run.enemies.push({ type: m.type, d, x: m.x, y: m.y, hp, maxHp: hp, kx: 0, ky: 0, flash: 0, ph: rand(), shootT: (d.shootEvery || d.burstEvery || 0) * (0.5 + rand() * 0.5), dead: false });
  }
  run.marks = run.marks.filter((m) => m.t > 0);

  // --- enemies
  const kbDecay = Math.exp(-8 * dt);
  for (const e of run.enemies) {
    const d = e.d, dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1;
    let mx = dx / dist, my = dy / dist;
    if (d.keepAway && dist < d.keepAway && clearLine(city, e.x, e.y, p.x, p.y)) { mx *= -0.6; my *= -0.6; }
    else if (dist > 36) {   // follow the flow field (heavies use theirs, which goes through buildings)
      const st = steer(isHeavy(e) ? run.heavyField : run.field, e.x, e.y);
      if (st) { const sx = st.x - e.x, sy = st.y - e.y, sl = Math.hypot(sx, sy) || 1; mx = sx / sl; my = sy / sl; }
    }
    const spd = d.speed * (e.crushing ? 0.45 : 1);
    e.crushing = false;
    e.x += (mx * spd + e.kx) * dt;
    e.y += (my * spd + e.ky) * dt;
    e.kx *= kbDecay; e.ky *= kbDecay;
    e.flash -= dt;
    if (d.shootEvery && (e.shootT -= dt) <= 0) {
      e.shootT = d.shootEvery;
      run.bolts.push({ x: e.x, y: e.y, vx: (dx / dist) * d.boltSpeed, vy: (dy / dist) * d.boltSpeed, dmg: d.boltDmg * waveDmgMul(run.wave) });
      run.events.push({ type: "enemyShot" });
    }
    if (d.burstEvery && (e.shootT -= dt) <= 0) {
      e.shootT = d.burstEvery;
      const off = rand() * Math.PI;
      for (let i = 0; i < d.burstCount; i++) {
        const a = off + (i / d.burstCount) * Math.PI * 2;
        run.bolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * d.boltSpeed, vy: Math.sin(a) * d.boltSpeed, dmg: d.boltDmg * waveDmgMul(run.wave) });
      }
      run.fx.push({ type: "ring", x: e.x, y: e.y, r: d.r + 10, t: 0.3, max: 0.3, color: "#ff6b5a" });
      run.events.push({ type: "enemyShot" });
    }
  }
  buildGrid(run.enemies);
  // separation: push overlapping enemies apart, heavier ones move less
  for (const e of run.enemies) {
    near(e.x, e.y, e.d.r + 16, (o) => {
      if (o === e) return;
      const dx = o.x - e.x, dy = o.y - e.y, min = e.d.r + o.d.r, d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) return;
      const d = Math.sqrt(d2), push = (min - d) / 2, me = e.d.mass || 1, mo = o.d.mass || 1;
      const fe = mo / (me + mo), fo = me / (me + mo);
      e.x -= (dx / d) * push * fe; e.y -= (dy / d) * push * fe;
      o.x += (dx / d) * push * fo; o.y += (dy / d) * push * fo;
    });
  }
  for (const e of run.enemies) {
    collide(city, e, e.d.r, e.d.crush ? (ti) => { e.crushing = true; damageAt(city, ti, e.d.crush * dt * 0.5); } : null);
    if (e.d.crush && e.crushing) breakProps(run, e.x, e.y, e.d.r + 2);
    e.x = clamp(e.x, e.d.r, ARENA.w - e.d.r); e.y = clamp(e.y, e.d.r, ARENA.h - e.d.r);
    const dx = p.x - e.x, dy = p.y - e.y, r = e.d.r + run.chassis.radius;
    if (dx * dx + dy * dy < r * r) hurtPlayer(run, e.d.dmg * waveDmgMul(run.wave));
  }

  // --- aim: face the nearest enemy, else the travel direction
  const nearest = nearestEnemy(run, 999);
  p.aim = nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : (p.moveAngle ?? 0);

  // --- ballistic + melee
  const offline = weaponsOffline(run);
  for (const w of run.weapons) {
    const def = WEAPONS[w.key];
    w.cd -= dt;
    if (def.family === "ballistic") {
      if (w.reloadT > 0 && (w.reloadT -= dt) <= 0) w.mag = def.mag;
      if (offline || w.reloadT > 0 || w.cd > 0) continue;
      const t = sightedEnemy(run, def.range * (1 + s.rangeMul));
      if (!t) continue;
      const base = Math.atan2(t.y - p.y, t.x - p.x), dmg = weaponDmg(run, w);
      for (let i = 0; i < def.pellets; i++) {
        const a = base + (rand() - 0.5) * def.spread * (def.pellets > 1 ? 1 : 2);
        const sp = def.speed * (def.pellets > 1 ? 0.85 + rand() * 0.3 : 1);
        run.shots.push({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, life: (def.range * (1 + s.rangeMul) * 1.15) / sp, fam: "ballistic" });
      }
      run.fx.push({ type: "muzzle", x: p.x + Math.cos(base) * 9, y: p.y + Math.sin(base) * 9, t: 0.05, max: 0.05 });
      run.events.push({ type: def.pellets > 1 ? "flak" : "shot" });
      w.cd = def.interval;
      if (--w.mag <= 0) w.reloadT = def.reload * Math.max(0.3, 1 + s.reloadMul);
    } else if (def.family === "melee") {
      if (offline || w.cd > 0) continue;
      const reach = def.reach * (1 + s.rangeMul) + run.chassis.radius;
      const t = nearestEnemy(run, reach + 10);
      if (!t || Math.hypot(t.x - p.x, t.y - p.y) > reach + t.d.r) continue;
      const a = Math.atan2(t.y - p.y, t.x - p.x), dmg = weaponDmg(run, w);
      near(p.x, p.y, reach + 20, (e) => {
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
        if (d > reach + e.d.r || angDiff(Math.atan2(dy, dx), a) > def.arc / 2) return;
        hitEnemy(run, e, dmg, (dx / (d || 1)) * def.knock, (dy / (d || 1)) * def.knock);
      });
      buildingsInArc(run, a, def.arc, reach + 6, dmg * BUILDING_DMG.melee);
      run.fx.push({ type: "swing", x: p.x, y: p.y, a, arc: def.arc, reach, t: 0.14, max: 0.14, heavy: w.key === "fist" });
      run.events.push({ type: "swing", heavy: w.key === "fist" });
      w.cd = def.cooldown;
    }
  }

  // --- energy: shared capacitor -> alpha strike -> vent
  const times = capTimes(run), cap = run.cap;
  if (!times) { cap.charge = 0; cap.vent = 0; }
  else if (cap.vent > 0) {
    cap.vent -= dt;
    if (rand() < dt * 30) steam(run);
    if (cap.vent <= 0) { cap.vent = 0; cap.charge = 0; }
  } else {
    if (cap.charge < 1 && cap.charge + dt / times.fill >= 1) run.events.push({ type: "charged" });
    cap.charge = Math.min(1, cap.charge + dt / times.fill);
    const energy = run.weapons.filter((w) => WEAPONS[w.key].family === "energy");
    const plans = cap.charge >= 1 ? energy.map((w) => [w, plan(run, w)]) : [];
    if (plans.length) cap.hold += dt;
    if (plans.some(([, pl]) => pl.ready)) {
      for (const [w, pl] of plans) discharge(run, w, pl.aim);
      cap.vent = cap.ventMax = times.vent; cap.hold = 0;
      run.events.push({ type: "vent", dur: times.vent });
      run.freeze = 0.05;   // hit-stop: render-side pause that sells the alpha strike
      run.shake = Math.max(run.shake, 5);
      if (s.ventBurst) {
        near(p.x, p.y, 60, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
          if (d < 45 + e.d.r) hitEnemy(run, e, s.ventBurst * waveHpMul(run.wave) * 0.8, (dx / d) * 80, (dy / d) * 80);
        });
        run.fx.push({ type: "ring", x: p.x, y: p.y, r: 45, t: 0.35, max: 0.35, color: "#ffb36b" });
      }
    }
  }

  // --- player shots
  for (const sh of run.shots) {
    sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.life -= dt;
    if (sh.life <= 0) continue;
    if (solidAt(city, sh.x, sh.y)) {   // cover: rounds chew into whatever they hit
      damageAt(city, Math.floor(sh.y / TILE) * TCOLS + Math.floor(sh.x / TILE), sh.dmg * BUILDING_DMG.ballistic);
      sh.life = 0;
      for (let i = 0; i < 2; i++) {
        const a = Math.atan2(-sh.vy, -sh.vx) + (rand() - 0.5) * 2, v = 30 + rand() * 50;
        run.parts.push({ x: sh.x - sh.vx * dt, y: sh.y - sh.vy * dt, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.25, max: 0.25, color: rand() < 0.5 ? "#9a948a" : "#c9c0b0", size: 1 });
      }
      continue;
    }
    let hit = null;
    near(sh.x, sh.y, 20, (e) => {
      if (hit || e.dead) return;
      const dx = e.x - sh.x, dy = e.y - sh.y, r = e.d.r + 1.5;
      if (dx * dx + dy * dy < r * r) hit = e;
    });
    if (hit) {
      const sp = Math.hypot(sh.vx, sh.vy);
      hitEnemy(run, hit, sh.dmg, (sh.vx / sp) * 30, (sh.vy / sp) * 30);
      sh.life = 0;
      for (let i = 0; i < 3; i++) {
        const a = Math.atan2(-sh.vy, -sh.vx) + (rand() - 0.5) * 1.8, v = 40 + rand() * 60;
        run.parts.push({ x: sh.x, y: sh.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.15, max: 0.15, color: "#ffe9a8", size: 1, spark: true });
      }
    }
  }
  run.shots = run.shots.filter((sh) => sh.life > 0);

  // --- enemy bolts
  for (const b of run.bolts) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    const dx = p.x - b.x, dy = p.y - b.y, r = run.chassis.radius + 2.5;
    if (dx * dx + dy * dy < r * r) { hurtPlayer(run, b.dmg); b.dead = true; }
    if (solidAt(city, b.x, b.y)) b.dead = true;
  }
  run.bolts = run.bolts.filter((b) => !b.dead);
  run.enemies = run.enemies.filter((e) => !e.dead);

  processCollapses(run);
  tickPickups(run, dt);
  tickFx(run, dt);

  if (p.hp <= 0) { p.hp = 0; run.phase = "dead"; run.events.push({ type: "dead" }); return; }
  if (run.waveTime >= wave.duration) clearWave(run);
}

function spawnPoint(run, minDist) {
  const p = run.player, city = run.city;
  let best = null;
  for (let i = 0; i < 60; i++) {
    const tx = 1 + Math.floor(run.rand() * (TCOLS - 2)), ty = 1 + Math.floor(run.rand() * (TROWS - 2));
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (city.tile[ty * TCOLS + tx] === T.BUILDING || city.tile[ty * TCOLS + tx] === T.WALL || !reachable(run.field, x, y)) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d >= minDist && d < minDist * 2.6) return { x, y };
    if (d >= minDist && !best) best = { x, y };
  }
  return best || { x: city.spawn.x + minDist, y: city.spawn.y };
}

/** Nearest enemy in range with a clear line of fire; if none, the nearest anyway (shots chew the cover). */
function sightedEnemy(run, range) {
  const p = run.player, r2 = range * range, cands = [];
  for (const e of run.enemies) {
    if (e.dead) continue;
    const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d2 < r2) cands.push([d2, e]);
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < Math.min(8, cands.length); i++) if (clearLine(run.city, p.x, p.y, cands[i][1].x, cands[i][1].y)) return cands[i][1];
  return cands[0][1];
}

/** Damage each building with a tile inside a swing arc (once per building) */
function buildingsInArc(run, a, arc, reach, dmg) {
  const p = run.player, city = run.city, seen = new Set();
  const tx0 = Math.floor((p.x - reach) / TILE), tx1 = Math.floor((p.x + reach) / TILE);
  const ty0 = Math.floor((p.y - reach) / TILE), ty1 = Math.floor((p.y + reach) / TILE);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (tx < 0 || ty < 0 || tx >= TCOLS || ty >= TROWS) continue;
    const id = city.bid[ty * TCOLS + tx];
    if (id < 0 || seen.has(id) || city.buildings[id].dead) continue;
    const nx = Math.max(tx * TILE, Math.min(p.x, (tx + 1) * TILE)), ny = Math.max(ty * TILE, Math.min(p.y, (ty + 1) * TILE));
    const d = Math.hypot(nx - p.x, ny - p.y);
    if (d > reach || (d > 2 && angDiff(Math.atan2(ny - p.y, nx - p.x), a) > arc / 2 + 0.3)) continue;
    seen.add(id);
    damageBuilding(city, city.buildings[id], dmg);
  }
}

/** Cars, trees and lamps near a point get flattened */
function breakProps(run, x, y, r) {
  for (const pr of run.city.props) {
    if (pr.broken || Math.abs(pr.x - x) > r + 7 || Math.abs(pr.y - y) > r + 7) continue;
    pr.broken = true;
    run.events.push({ type: "crunch" });
    for (let i = 0; i < 5; i++) {
      const a = run.rand() * Math.PI * 2, v = 20 + run.rand() * 40;
      run.parts.push({ x: pr.x, y: pr.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.35, max: 0.35, color: pr.type === "tree" ? "#3f6b3a" : "#8a8f99", size: 1 });
    }
  }
}

/** Buildings that fell this tick: dust, debris, shake, a little salvage */
function processCollapses(run) {
  const city = run.city;
  while (city.collapsed.length) {
    const b = city.buildings[city.collapsed.shift()];
    const cx = (b.x + b.w / 2) * TILE, cy = (b.y + b.h / 2) * TILE;
    run.fx.push({ type: "collapse", bid: b.id, x: cx, y: cy, t: 0.7, max: 0.7 });
    run.shake = Math.max(run.shake, 3 + b.height * 2);
    run.events.push({ type: "collapse", size: b.w * b.h });
    for (let i = 0; i < 16 + b.w * b.h * 4; i++) {   // dust billows out of the footprint
      const x = (b.x + run.rand() * b.w) * TILE, y = (b.y + run.rand() * b.h) * TILE, a = run.rand() * Math.PI * 2, v = 15 + run.rand() * 55;
      run.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 12, t: 0.9 + run.rand() * 1.0, max: 1.9, color: run.rand() < 0.5 ? "#8c867c" : "#6f6a62", size: 3 + (run.rand() * 3 | 0), steam: true });
    }
    for (let i = 0; i < 8 + b.w * b.h; i++) {   // chunks thrown clear
      const a = run.rand() * Math.PI * 2, v = 60 + run.rand() * 90;
      run.parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.5 + run.rand() * 0.3, max: 0.8, color: run.rand() < 0.5 ? "#5a564f" : "#2a2724", size: 2 });
    }
    breakProps(run, cx, cy, Math.max(b.w, b.h) * TILE * 0.6);
    for (let n = Math.max(1, Math.round((b.w * b.h) / 3)); n > 0; n--) {
      run.pickups.push({ x: (b.x + 0.2 + run.rand() * (b.w - 0.4)) * TILE, y: (b.y + 0.2 + run.rand() * (b.h - 0.4)) * TILE, n: 1, v: 0, pull: false });
    }
  }
}

function nearestEnemy(run, range) {
  const p = run.player;
  let best = null, bd = range * range;
  for (const e of run.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = e; }
  }
  return best;
}

const isHeavy = (e) => (e.d.mass || 1) >= 3;
const threat = (list) => list.reduce((t, e) => t + (isHeavy(e) ? 3 : 1), 0);

/** Should this energy weapon fire now, and where? Follows run.targeting. */
function plan(run, w) {
  const def = WEAPONS[w.key], p = run.player, mode = run.targeting;
  const range = def.range * (1 + run.stats.rangeMul);
  const need = run.cap.hold >= HOLD_GIVEUP ? 1 : CROWD_NEED;
  if (def.kind === "nova") {
    const hits = run.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < range + e.d.r);
    const t = threat(hits);
    return { ready: mode === "nearest" ? t > 0 : t >= need || (mode === "heavies" && hits.some(isHeavy)) };
  }
  // beam candidates: up to 40 nearest enemies in range; each defines a line through it
  const cands = run.enemies
    .filter((e) => !e.dead)
    .map((e) => [e, Math.hypot(e.x - p.x, e.y - p.y)])
    .filter(([, d]) => d < range)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 40)
    .map(([e]) => e);
  if (!cands.length) return { ready: false, aim: p.aim };
  const lineTo = (e) => Math.atan2(e.y - p.y, e.x - p.x);
  if (mode === "nearest") return { ready: true, aim: lineTo(cands[0]) };
  const heavy = mode === "heavies" ? cands.filter(isHeavy).sort((a, b) => b.hp - a.hp)[0] : null;
  let best = null;
  for (const c of cands) {
    const a = lineTo(c), hits = beamHits(run, a, range, def.width);
    if (heavy && !hits.includes(heavy)) continue;
    const t = threat(hits);
    if (!best || t > best.t) best = { a, t };
  }
  return { ready: !!heavy || best.t >= need, aim: best.a };
}

function discharge(run, w, aim) {
  const def = WEAPONS[w.key], p = run.player, s = run.stats, dmg = weaponDmg(run, w);
  const range = def.range * (1 + s.rangeMul);
  if (def.kind === "nova") {
    near(p.x, p.y, range + 20, (e) => {
      const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
      if (d < range + e.d.r) hitEnemy(run, e, dmg, (dx / d) * def.knock, (dy / d) * def.knock);
    });
    run.fx.push({ type: "ring", x: p.x, y: p.y, r: range, t: 0.4, max: 0.4, color: "#8fe3ff", thick: true });
    buildingsInArc(run, 0, Math.PI * 2, range, dmg * BUILDING_DMG.energy);
    run.events.push({ type: "nova" });
    return;
  }
  const bestA = aim ?? p.aim, ex = p.x + Math.cos(bestA) * range, ey = p.y + Math.sin(bestA) * range;
  for (const e of beamHits(run, bestA, range, def.width)) hitEnemy(run, e, dmg, Math.cos(bestA) * 60, Math.sin(bestA) * 60);
  // beams pierce cover, cutting into every building on the line
  const cut = new Set();
  traverse(p.x, p.y, ex, ey, (tx, ty) => { const id = tx >= 0 && ty >= 0 && tx < TCOLS && ty < TROWS ? run.city.bid[ty * TCOLS + tx] : -1; if (id >= 0) cut.add(id); return false; });
  for (const id of cut) damageBuilding(run.city, run.city.buildings[id], dmg * BUILDING_DMG.energy);
  const i = run.weapons.indexOf(w), mx = p.x + (i % 2 ? 7 : -7), my = p.y - 4 + (Math.floor(i / 2) - 1) * 2;
  run.fx.push({ type: "beam", x1: mx + Math.cos(bestA) * 8, y1: my + Math.sin(bestA) * 8, x2: ex, y2: ey, w: def.width, t: 0.3, max: 0.3 });
  p.aim = bestA;
  run.events.push({ type: "beam" });
}

function beamHits(run, a, range, width) {
  const p = run.player, cx = Math.cos(a), cy = Math.sin(a), out = [];
  for (const e of run.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y, along = dx * cx + dy * cy;
    if (along < 0 || along > range + e.d.r) continue;
    if (Math.abs(dx * cy - dy * cx) <= width / 2 + e.d.r) out.push(e);
  }
  return out;
}

function hitEnemy(run, e, dmg, kx, ky) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = 0.08;
  const m = e.d.mass || 1;
  e.kx += kx / m; e.ky += ky / m;
  run.texts.push({ x: e.x + (run.rand() - 0.5) * 6, y: e.y - e.d.r, n: Math.round(dmg), t: 0.6, max: 0.6 });
  if (e.hp > 0) { run.events.push({ type: "hit" }); return; }
  run.events.push({ type: "boom", r: e.d.r });
  e.dead = true; run.kills++;
  run.fx.push({ type: "boom", x: e.x, y: e.y, r: e.d.r, t: 0.4 + e.d.r * 0.02, max: 0.4 + e.d.r * 0.02 });
  for (let i = 0; i < 7 + e.d.r; i++) {
    const a = run.rand() * Math.PI * 2, sp = 30 + run.rand() * 70;
    run.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0.4 + run.rand() * 0.3, max: 0.7, color: e.d.color, size: 1 + (run.rand() * 2 | 0) });
  }
  let n = e.d.salvage;
  while (n > 0) {
    const v = n >= 5 ? 5 : 1; n -= v;
    run.pickups.push({ x: e.x + (run.rand() - 0.5) * 10, y: e.y + (run.rand() - 0.5) * 10, n: v, v: 0, pull: false });
  }
  if (e.d.boss) { run.shake = Math.max(run.shake, 10); run.freeze = 0.18; }
  if (e.d.r >= 9) breakProps(run, e.x, e.y, e.d.r + 6);
}

function hurtPlayer(run, dmg) {
  const p = run.player;
  if (p.iframes > 0) return;
  p.hp -= dmg * armorMul(run.stats.armor);
  p.iframes = PLAYER_IFRAMES; p.hurt = 0.3;
  run.events.push({ type: "hurt" });
  run.shake = Math.max(run.shake, 3);
}

function steam(run) {
  const p = run.player, a = -Math.PI / 2 + (run.rand() - 0.5) * 1.6;
  run.parts.push({ x: p.x + (run.rand() - 0.5) * 10, y: p.y - 4, vx: Math.cos(a) * 18, vy: Math.sin(a) * 26 - 6, t: 0.7, max: 0.7, color: "#d9e2ea", size: 2, steam: true });
}

function tickFx(run, dt) {
  for (const f of run.fx) f.t -= dt;
  run.fx = run.fx.filter((f) => f.t > 0);
  for (const q of run.parts) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92; q.t -= dt; }
  run.parts = run.parts.filter((q) => q.t > 0);
  for (const t of run.texts) { t.y -= 18 * dt; t.t -= dt; }
  run.texts = run.texts.filter((t) => t.t > 0);
  run.shake = Math.max(0, run.shake - dt * 20);
}

function tickPickups(run, dt) {
  const p = run.player;
  for (const k of run.pickups) {
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    if (d < run.stats.pickup || run.clearing > 0) k.pull = true;
    if (k.pull) { k.v = Math.min(400, k.v + 900 * dt); k.x += (dx / d) * k.v * dt; k.y += (dy / d) * k.v * dt; }
    if (d < run.chassis.radius + 3) { run.salvage += k.n; k.got = true; run.events.push({ type: "pickup" }); }
  }
  run.pickups = run.pickups.filter((k) => !k.got);
}

export const CLEAR_TIME = 1.4;
function clearWave(run) {
  run.clearing = CLEAR_TIME;
  for (const e of run.enemies) {
    run.fx.push({ type: "boom", x: e.x, y: e.y, r: e.d.r, t: 0.3 + run.rand() * 0.4, max: 0.7 });
  }
  if (run.enemies.length) run.events.push({ type: "boom", r: 10 });
  for (const k of ["enemies", "bolts", "shots", "marks"]) run[k].length = 0;
  run.shake = Math.max(run.shake, 4);
  run.events.push({ type: "waveClear" });
}

function endWave(run) {
  run.salvage += run.pickups.reduce((t, k) => t + k.n, 0) + SHOP.waveBonus(run.wave);
  for (const k of ["enemies", "bolts", "shots", "pickups", "marks"]) run[k].length = 0;
  run.clearing = 0;
  if (run.wave >= WAVES.length - 1) { run.phase = "won"; return; }
  run.phase = "hangar";
  run.shop.rerolls = 0;
  rollOffers(run);
}

export function nextWave(run) {
  run.wave++;
  startWave(run);
}

// ---------------------------------------------------------------- hangar / shop
export const weaponPrice = (key, tier, wave) => Math.round(WEAPONS[key].price * TIER_PRICE[tier] * SHOP.priceWaveMul(wave));
export const modulePrice = (key, wave) => Math.round(MODULES[key].price * SHOP.priceWaveMul(wave));
export const rerollCost = (run) => SHOP.rerollBase + SHOP.rerollStep * run.shop.rerolls + run.wave;

export function rollOffers(run) {
  const kept = run.shop.offers.filter((o) => o.locked);
  const out = [...kept];
  const w = run.wave + 1;   // the wave about to be fought (0-based)
  let guard = 0;
  while (out.length < SHOP.offers && guard++ < 100) {
    let o;
    if (run.rand() < 0.5) {
      const key = pick(run.rand, Object.keys(WEAPONS).map((k) => [k, 1]));
      const r = run.rand();
      const tier = r < 0.07 * Math.max(0, w - 2) ? 2 : r < 0.14 * w ? 1 : 0;
      o = { kind: "weapon", key, tier, price: weaponPrice(key, tier, run.wave) };
    } else {
      const key = pick(run.rand, Object.keys(MODULES).map((k) => [k, 1]));
      if (MODULES[key].unique && run.modules.includes(key)) continue;
      o = { kind: "module", key, tier: 0, price: modulePrice(key, run.wave) };
    }
    if (out.some((x) => x.kind === o.kind && x.key === o.key && x.tier === o.tier)) continue;
    out.push({ ...o, locked: false, sold: false });
  }
  run.shop.offers = out;
}

/** Why an offer can't be bought, or null */
export function blocked(run, o) {
  if (o.sold) return "Sold";
  if (run.salvage < o.price) return "Can't afford";
  if (o.kind === "module") {
    if (MODULES[o.key].unique && run.modules.includes(o.key)) return "Installed";
    if (run.load + MODULES[o.key].weight > run.chassis.capacity) return "Over tonnage";
    return null;
  }
  const merge = run.weapons.length >= run.chassis.slots;
  if (merge) return run.weapons.some((w) => w.key === o.key && w.tier === o.tier && w.tier < 3) ? null : "Slots full";
  if (run.load + WEAPONS[o.key].weight > run.chassis.capacity) return "Over tonnage";
  return null;
}

export function buy(run, i) {
  const o = run.shop.offers[i];
  if (!o || blocked(run, o)) return false;
  run.salvage -= o.price;
  if (o.kind === "module") run.modules.push(o.key);
  else if (run.weapons.length < run.chassis.slots) addWeapon(run, o.key, o.tier);
  else run.weapons.find((w) => w.key === o.key && w.tier === o.tier).tier++;
  o.sold = true; o.locked = false;
  recompute(run);
  return true;
}

export function reroll(run) {
  const c = rerollCost(run);
  if (run.salvage < c) return false;
  run.salvage -= c; run.shop.rerolls++;
  run.shop.offers = run.shop.offers.filter((o) => o.locked && !o.sold);
  rollOffers(run);
  return true;
}

export const combinable = (run, i) => {
  const w = run.weapons[i];
  return w.tier < 3 && run.weapons.some((o, j) => j !== i && o.key === w.key && o.tier === w.tier);
};

export function combine(run, i) {
  if (!combinable(run, i)) return false;
  const w = run.weapons[i];
  const j = run.weapons.findIndex((o, j) => j !== i && o.key === w.key && o.tier === w.tier);
  w.tier++;
  run.weapons.splice(j, 1);
  recompute(run);
  return true;
}

export const sellValue = (run, i) => Math.floor(weaponPrice(run.weapons[i].key, run.weapons[i].tier, run.wave) * SHOP.sellFrac);

export function sell(run, i) {
  if (run.weapons.length <= 1) return false;
  run.salvage += sellValue(run, i);
  run.weapons.splice(i, 1);
  recompute(run);
  return true;
}

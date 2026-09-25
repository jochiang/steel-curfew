import {
  ARENA, BUILDING_DMG, CHASSIS, HARDPOINT, RAM, WEAPONS, MODULES, ENEMIES, WAVES, HEAT, SHOP, TIER_DMG, TIER_PRICE,
  PLAYER_IFRAMES, PICKUP_RADIUS, MAX_ENEMIES, ELITE, XP, PERKS, CROWD_NEED, HOLD_GIVEUP, GROUP_GROW, GROUP_GROW_MAX, loadSpeed, armorMul, waveHpMul, waveDmgMul,
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
// How dark it is at the start of each wave (0 = full day, 1 = night). Within a wave the light
// fades towards the next key, so the last wave (the boss) is fought in the dark.
export const DUSK_KEYS = [0, 0.3, 0.52, 0.76, 1];
export function darkness(run) {
  if (run.tod === "day") return 0;
  if (run.tod === "dusk") return 0.55;
  if (run.tod === "night") return 1;
  const last = DUSK_KEYS.length - 1, w = Math.min(run.wave, last);
  if (w >= last) return 1;
  const f = Math.min(1, run.waveTime / WAVES[w].duration);
  return DUSK_KEYS[w] + (DUSK_KEYS[w + 1] - DUSK_KEYS[w]) * f;
}
export const timeLabel = (d) => (d < 0.15 ? "day" : d < 0.4 ? "afternoon" : d < 0.62 ? "dusk" : d < 0.9 ? "twilight" : "night");
export function newRun({ seed = Date.now(), chassis = "warden", start = "autocannon", ventMode = "all", targeting = "crowd", tod = null, allowed = null } = {}) {
  const run = {
    rand: mulberry32(seed), seed, ventMode, targeting,
    tod: TIMES_OF_DAY.includes(tod) ? tod : "cycle",   // "cycle": the day wears on as the waves go (?tod= fixes it)
    chassisKey: CHASSIS[chassis] ? chassis : "warden", chassis: CHASSIS[chassis] || CHASSIS.warden,
    phase: "combat", wave: 0, time: 0, waveTime: 0,
    salvage: 0, kills: 0,
    weapons: [], modules: [],
    player: { x: ARENA.w / 2, y: ARENA.h / 2, hp: 0, iframes: 0, aim: 0, moving: false, hurt: 0 },
    city: generateCity(seed),   // persists for the whole run: damage piles up wave after wave
    field: makeField(false), heavyField: makeField(true),
    cap: { charge: 0, vent: 0, ventMax: 1, hold: 0 },
    enemies: [], shots: [], bolts: [], pickups: [], marks: [], fx: [], parts: [], texts: [], shells: [], missiles: [],
    shake: 0, freeze: 0, spawnT: 0, bossSpawned: false, clearing: 0,
    events: [],   // for sound; drained by the page, capped here so headless runs don't grow it
    shop: { offers: [], rerolls: 0 },
    xp: 0, level: 1, pending: 0, perks: [], perkOffers: [], perkRerolls: 0,
    allowed,                                             // weapon keys the shop may offer (null = all)
    tally: { kills: 0, elites: 0, bosses: 0, buildings: 0 },   // for career progress
    // balance metrics (cumulative; tools/balance.mjs reads them per wave)
    m: { dealt: 0, hpSpawned: 0, hits: 0, glanced: 0, takenRaw: 0, taken: 0, earned: 0, spent: 0, bossSpawnT: null, bossKillT: null, bossType: null, bossHp: 0, bySrc: {} },
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
    maxHp: run.chassis.hp, armor: run.chassis.armor, regen: 0, speedMul: 0, dmgBallistic: 0, dmgEnergy: 0, dmgMelee: 0,
    rangeMul: 0, reloadMul: 0, fillMul: 0, ventMul: 0, pickup: PICKUP_RADIUS, ventSpeed: 0, ventBurst: 0, isolatedLoops: 0,
    dodge: 0, ram: 0, capacity: 0,
  };
  for (const pk of run.perks) for (const [k, v] of Object.entries(pk.fx)) s[k] += v;
  for (const [k, v] of Object.entries(run.chassis.fx)) s[k] += v;
  for (const m of run.modules) for (const [k, v] of Object.entries(MODULES[m].fx)) s[k] += v;
  s.dodge = Math.min(0.6, s.dodge);
  run.mounts = assignMounts(run);
  run.stats = s;
  run.load = run.weapons.reduce((t, w) => t + WEAPONS[w.key].weight, 0) + run.modules.reduce((t, m) => t + MODULES[m].weight, 0);
}

export function startWave(run) {
  const p = run.player;
  Object.assign(p, { x: run.city.spawn.x, y: run.city.spawn.y, hp: run.stats.maxHp, iframes: 0, hurt: 0 });
  Object.assign(run.cap, { charge: 0, vent: 0, hold: 0 });
  for (const w of run.weapons) Object.assign(w, { cd: 0, mag: WEAPONS[w.key].mag || 0, reloadT: 0 });
  for (const k of ["enemies", "shots", "bolts", "pickups", "marks", "fx", "parts", "texts", "shells", "missiles"]) run[k].length = 0;
  run.waveTime = 0; run.spawnT = 0.6; run.bossSpawned = false; run.phase = "combat"; run.clearing = 0;
  run.events.push({ type: "waveStart" });
}

// ---------------------------------------------------------------- hardpoints
/** Can the loadout (plus one more weapon of `extra` family) be fitted into the chassis's hardpoints?
 *  Family slots first, universal slots take the overflow. */
export function fits(run, extra = null) {
  const cap = { energy: 0, ballistic: 0, melee: 0 }, need = { energy: 0, ballistic: 0, melee: 0 };
  let uni = 0;
  for (const h of run.chassis.hardpoints) h === "U" ? uni++ : cap[HARDPOINT[h]]++;
  for (const w of run.weapons) need[WEAPONS[w.key].family]++;
  if (extra) need[extra]++;
  let over = 0;
  for (const f in need) over += Math.max(0, need[f] - cap[f]);
  return over <= uni;
}
/** For each hardpoint, the index of the weapon mounted on it (or -1). */
export function assignMounts(run) {
  const hp = run.chassis.hardpoints, out = hp.map(() => -1);
  run.weapons.forEach((w, wi) => {
    const fam = WEAPONS[w.key].family;
    let i = hp.findIndex((h, j) => out[j] < 0 && HARDPOINT[h] === fam);
    if (i < 0) i = hp.findIndex((h, j) => out[j] < 0 && h === "U");
    if (i >= 0) out[i] = wi;
  });
  return out;
}
/** Where weapon `wi` sits on the mech: alternating shoulders, later pairs stacked. */
export function mountPoint(run, wi) {
  const ch = run.chassis, p = run.player, hi = Math.max(0, run.mounts.indexOf(wi));
  const rows = Math.ceil(ch.hardpoints.length / 2), row = Math.floor(hi / 2);
  return { x: p.x + (hi % 2 ? 1 : -1) * ch.shoulder, y: p.y + 9 - ch.mountY + Math.round((row - (rows - 1) / 2) * 2) };
}
/** Weapons a chassis can start with (a hardpoint of its family, or a universal one) */
export const canMount = (chassis, family) => chassis.hardpoints.some((h) => h === "U" || HARDPOINT[h] === family);

// ---------------------------------------------------------------- derived numbers (also used by UI)
export const famDmg = (s, fam) => 1 + (fam === "ballistic" ? s.dmgBallistic : fam === "energy" ? s.dmgEnergy : s.dmgMelee);
export const weaponDmg = (run, w) => WEAPONS[w.key].dmg * TIER_DMG[w.tier] * famDmg(run.stats, WEAPONS[w.key].family);
export const capacityOf = (run) => run.chassis.capacity + (run.stats?.capacity || 0);
export const speedOf = (run) => run.chassis.speed * loadSpeed(run.load, capacityOf(run)) * (1 + run.stats.speedMul);
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
  collide(city, p, run.chassis.radius, s.ram ? (ti) => damageAt(city, ti, RAM.building * dt * 0.5) : null);
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
    run.marks.push({ ...c, t: 1.6, max: 1.6, type: Array.isArray(wave.boss) ? wave.boss[run.seed % wave.boss.length] : wave.boss });
    run.events.push({ type: "spawnBoss" });
    run.flashT = 0.6;   // lightning as it lands
  }
  for (const m of run.marks) {
    if ((m.t -= dt) > 0) continue;
    if (ENEMIES[m.type].maxAlive && run.enemies.filter((e) => e.type === m.type).length >= ENEMIES[m.type].maxAlive) m.type = "drone";   // cap, swap for filler
    const d = ENEMIES[m.type], elite = !d.boss && !m.noElite && rand() < ELITE.chance(run.wave);
    const hp = d.hp * waveHpMul(run.wave) * (elite ? ELITE.hp : 1);
    run.m.hpSpawned += hp;
    if (d.boss) { run.m.bossSpawnT = run.time; run.m.bossType = m.type; run.m.bossHp = hp; }
    run.enemies.push({
      type: m.type, d, x: m.x, y: m.y, hp, maxHp: hp, kx: 0, ky: 0, flash: 0, ph: rand(), dead: false, elite,
      dmgMul: elite ? ELITE.dmg : 1, spdMul: elite ? ELITE.speed : 1,
      shootT: (d.shootEvery || d.burstEvery || d.lobEvery || 0) * (0.5 + rand() * 0.5),
      barT: (d.barrageEvery || 0) * 0.6, depT: (d.deployEvery || 0) * 0.5, burn: 0,
    });
  }
  run.marks = run.marks.filter((m) => m.t > 0);

  // --- enemies
  const kbDecay = Math.exp(-8 * dt);
  for (const e of run.enemies) {
    const d = e.d, dx = p.x - e.x, dy = p.y - e.y, dist = Math.hypot(dx, dy) || 1;
    let mx = dx / dist, my = dy / dist;
    const lobber = d.lobEvery || d.barrageEvery;
    if (d.flying) { /* straight at the mech, over everything */ }
    else if (lobber && dist < d.keepAway) { mx *= -0.6; my *= -0.6; }            // artillery backs off...
    else if (lobber && dist < d.keepAway * 1.3) { mx = 0; my = 0; }                // ...and holds at range
    else if (d.keepAway && dist < d.keepAway && clearLine(city, e.x, e.y, p.x, p.y)) { mx *= -0.6; my *= -0.6; }
    else if (dist > 36) {   // follow the flow field (heavies use theirs, which goes through buildings)
      const st = steer(isHeavy(e) ? run.heavyField : run.field, e.x, e.y);
      if (st) { const sx = st.x - e.x, sy = st.y - e.y, sl = Math.hypot(sx, sy) || 1; mx = sx / sl; my = sy / sl; }
    }
    if (d.blast) {   // sapper: arm when close, stop, and go off
      if (!e.fuse && dist < d.r + run.chassis.radius + 6) { e.fuse = d.blast.fuse; run.events.push({ type: "fuse" }); }
      if (e.fuse) { mx = 0; my = 0; if ((e.fuse -= dt) <= 0) { explode(run, e); continue; } }
    }
    if (e.burn > 0) {   // on fire: damage ticks, and a few flames
      e.burn -= dt; e.burnAcc = (e.burnAcc || 0) + dt;
      if (e.burnAcc >= 0.3) { e.burnAcc = 0; hitEnemy(run, e, e.burnDps * 0.3, 0, 0, true); if (e.dead) continue; }
      if (rand() < dt * 12) run.parts.push({ x: e.x + (rand() - 0.5) * e.d.r, y: e.y - e.d.r * 0.5, vx: 0, vy: -20, t: 0.3, max: 0.3, color: rand() < 0.5 ? "#ffb347" : "#e8602c", size: 1 });
    }
    const spd = d.speed * (e.crushing ? 0.45 : 1) * e.spdMul;
    e.crushing = false;
    e.x += (mx * spd + e.kx) * dt;
    e.y += (my * spd + e.ky) * dt;
    e.kx *= kbDecay; e.ky *= kbDecay;
    e.flash -= dt;
    if (d.lobEvery && (e.shootT -= dt) <= 0 && dist < 260) {   // mortar: lob a shell at where the mech is
      e.shootT = d.lobEvery;
      lob(run, e.x, e.y - 6, p.x + (rand() - 0.5) * 16, p.y + (rand() - 0.5) * 16, d.shell, e.dmgMul, "mortar shell");
    }
    if (d.barrageEvery && (e.barT -= dt) <= 0) {   // siege walker: shells around the mech
      e.barT = d.barrageEvery;
      for (let i = 0; i < d.barrage; i++) {
        const a = rand() * Math.PI * 2, r = i === 0 ? 0 : 18 + rand() * 30;
        lob(run, e.x, e.y - 12, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, { ...d.shell, flight: d.shell.flight + i * 0.18 }, 1, "siege shell");
      }
    }
    if (d.deployEvery && (e.depT -= dt) <= 0) {   // ...and drops sappers
      e.depT = d.deployEvery;
      for (let i = 0; i < d.deploy; i++) {
        const a = rand() * Math.PI * 2, x = e.x + Math.cos(a) * (d.r + 10), y = e.y + Math.sin(a) * (d.r + 10);
        if (!solidAt(city, x, y)) run.marks.push({ x, y, t: 0.5, max: 0.5, type: "sapper", noElite: true });
      }
    }
    if (d.shootEvery && (e.shootT -= dt) <= 0) {
      e.shootT = d.shootEvery;
      run.bolts.push({ x: e.x, y: e.y, vx: (dx / dist) * d.boltSpeed, vy: (dy / dist) * d.boltSpeed, dmg: d.boltDmg * waveDmgMul(run.wave) * e.dmgMul, src: e.type + " bolt" });
      run.events.push({ type: "enemyShot" });
    }
    if (d.burstEvery && (e.shootT -= dt) <= 0) {
      e.shootT = d.burstEvery;
      const off = rand() * Math.PI;
      for (let i = 0; i < d.burstCount; i++) {
        const a = off + (i / d.burstCount) * Math.PI * 2;
        run.bolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * d.boltSpeed, vy: Math.sin(a) * d.boltSpeed, dmg: d.boltDmg * waveDmgMul(run.wave), src: e.type + " burst" });
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
    if (e.dead) continue;
    if (!e.d.flying) collide(city, e, e.d.r, e.d.crush ? (ti) => { e.crushing = true; damageAt(city, ti, e.d.crush * dt * 0.5); } : null);
    if (e.d.crush && e.crushing) breakProps(run, e.x, e.y, e.d.r + 2);
    e.x = clamp(e.x, e.d.r, ARENA.w - e.d.r); e.y = clamp(e.y, e.d.r, ARENA.h - e.d.r);
    const dx = p.x - e.x, dy = p.y - e.y, r = e.d.r + run.chassis.radius;
    if (dx * dx + dy * dy < r * r) {
      if (s.ram && !(e.ramT > run.time)) {   // Bulwark shoulders through what it touches
        e.ramT = run.time + RAM.every;
        const d = Math.hypot(dx, dy) || 1;
        hitEnemy(run, e, RAM.enemy * (1 + 0.3 * run.wave), (-dx / d) * RAM.knock, (-dy / d) * RAM.knock);
      }
      if (e.d.dmg > 0) hurtPlayer(run, e.d.dmg * waveDmgMul(run.wave) * e.dmgMul, "contact " + e.type);
    }
  }
  // buildings on fire burn down
  for (const b of city.buildings) if (b.burn > 0 && !b.dead) { b.burn -= dt; damageBuilding(city, b, 12 * dt, true); }

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
      if (def.missile) {   // missiles ignore cover: they arc over it
        const t = nearestEnemy(run, def.range * (1 + s.rangeMul));
        if (!t) continue;
        const m = mountPoint(run, run.weapons.indexOf(w)), a0 = Math.atan2(t.y - p.y, t.x - p.x) + (rand() - 0.5) * 1.6;
        run.missiles.push({ x: m.x, y: m.y + 4, vx: Math.cos(a0) * 60, vy: Math.sin(a0) * 60, target: t, tx: t.x, ty: t.y, age: 0, z: 0,
          dmg: weaponDmg(run, w), aoe: def.missile.aoe, speed: def.missile.speed });
        run.events.push({ type: "missile" });
        w.cd = def.interval;
        if (--w.mag <= 0) w.reloadT = def.reload * Math.max(0.3, 1 + s.reloadMul);
        continue;
      }
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
      if (def.burn) {   // flamethrower: a cone of fire that sets things alight
        const burnDps = def.burn.dps * TIER_DMG[w.tier] * famDmg(s, "melee");
        near(p.x, p.y, reach + 20, (e) => {
          const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy);
          if (d > reach + e.d.r || angDiff(Math.atan2(dy, dx), a) > def.arc / 2) return;
          hitEnemy(run, e, dmg, (dx / (d || 1)) * def.knock, (dy / (d || 1)) * def.knock, true);
          e.burn = Math.max(e.burn, def.burn.dur); e.burnDps = Math.max(e.burnDps || 0, burnDps);
        });
        igniteInArc(run, a, def.arc, reach + 4, def.buildingBurn);
        const m = mountPoint(run, run.weapons.indexOf(w));
        for (let k = 0; k < 4; k++) {
          const fa = a + (rand() - 0.5) * def.arc, v = 90 + rand() * 60;
          run.parts.push({ x: m.x, y: m.y + 4, vx: Math.cos(fa) * v, vy: Math.sin(fa) * v, t: 0.2 + rand() * 0.12, max: 0.32, color: rand() < 0.4 ? "#fff1b0" : rand() < 0.6 ? "#ffb347" : "#e8602c", size: 2, fire: true });
        }
        run.fx.push({ type: "flamecone", x: p.x + Math.cos(a) * reach * 0.6, y: p.y + Math.sin(a) * reach * 0.6, t: 0.12, max: 0.12 });
        run.events.push({ type: "flame" });
        w.cd = def.cooldown;
        continue;
      }
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
    if (dx * dx + dy * dy < r * r) { hurtPlayer(run, b.dmg, b.src || "bolt"); b.dead = true; }
    if (solidAt(city, b.x, b.y)) b.dead = true;
  }
  run.bolts = run.bolts.filter((b) => !b.dead);

  // --- artillery shells: fly over everything, land where they were aimed
  for (const sh of run.shells) {
    if ((sh.t += dt) < sh.dur) continue;
    sh.done = true;
    blastAt(run, sh.tx, sh.ty, sh.r, { player: sh.dmg * waveDmgMul(run.wave) * sh.mul, building: sh.building, src: sh.src });
  }
  run.shells = run.shells.filter((sh) => !sh.done);

  // --- missiles: climb, home on their target, burst
  for (const m of run.missiles) {
    m.age += dt; m.z = Math.min(14, m.age * 50);
    if (m.target && !m.target.dead) { m.tx = m.target.x; m.ty = m.target.y; }
    const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(m.speed, 60 + m.age * 260);
    const k = Math.min(1, dt * 7);
    m.vx += ((dx / d) * sp - m.vx) * k; m.vy += ((dy / d) * sp - m.vy) * k;
    m.x += m.vx * dt; m.y += m.vy * dt;
    if (rand() < 0.6) run.parts.push({ x: m.x, y: m.y - m.z, vx: (rand() - 0.5) * 8, vy: -6, t: 0.45, max: 0.45, color: "#9a9590", size: 1, steam: true });
    if (d < 6 || m.age > 3) {
      m.done = true;
      near(m.tx, m.ty, m.aoe + 16, (e) => { if (Math.hypot(e.x - m.tx, e.y - m.ty) < m.aoe + e.d.r) hitEnemy(run, e, m.dmg, (e.x - m.tx) * 3, (e.y - m.ty) * 3); });
      buildingsAround(run, m.tx, m.ty, m.aoe, m.dmg * BUILDING_DMG.ballistic * 0.6);
      run.fx.push({ type: "boom", x: m.tx, y: m.ty, r: 6, t: 0.35, max: 0.35 });
      run.events.push({ type: "boom", r: 5 });
    }
  }
  run.missiles = run.missiles.filter((m) => !m.done);
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

/** Lob an artillery shell from (x0,y0) to land at (tx,ty) */
function lob(run, x0, y0, tx, ty, shell, mul, src) {
  if (solidAt(run.city, tx, ty)) { tx = run.player.x; ty = run.player.y; }
  run.shells.push({ x0, y0, tx, ty, t: 0, dur: shell.flight, r: shell.radius, dmg: shell.dmg, building: shell.building, mul, src });
  run.events.push({ type: "lob", dur: shell.flight });
}

/** An explosion on the ground: hurts the mech if it's inside, chews buildings, flattens props */
function blastAt(run, x, y, r, { player = 0, building = 0, enemies = 0, src = "blast" } = {}) {
  const p = run.player;
  if (player && Math.hypot(p.x - x, p.y - y) < r + run.chassis.radius) hurtPlayer(run, player, src);
  if (enemies) near(x, y, r + 16, (e) => { if (!e.dead && Math.hypot(e.x - x, e.y - y) < r + e.d.r) hitEnemy(run, e, enemies, (e.x - x) * 4, (e.y - y) * 4); });
  if (building) buildingsAround(run, x, y, r, building);
  breakProps(run, x, y, r * 0.6);
  run.fx.push({ type: "boom", x, y, r: r * 0.5, t: 0.45, max: 0.45 });
  run.shake = Math.max(run.shake, 3 + r / 8);
  run.events.push({ type: "boom", r: r / 2 });
}

/** Sapper detonation (fuse ran out, or it was shot) */
function explode(run, e) {
  if (e.blown) return;
  e.blown = true; e.dead = true;
  const b = e.d.blast;
  blastAt(run, e.x, e.y, b.radius, { player: b.dmg * waveDmgMul(run.wave) * e.dmgMul, building: b.building, enemies: b.enemyDmg * waveHpMul(run.wave), src: "sapper blast" });
}

/** Damage each building with a tile within r of a point (once per building) */
function buildingsAround(run, x, y, r, dmg) {
  const city = run.city, seen = new Set();
  for (let ty = Math.floor((y - r) / TILE); ty <= Math.floor((y + r) / TILE); ty++) for (let tx = Math.floor((x - r) / TILE); tx <= Math.floor((x + r) / TILE); tx++) {
    if (tx < 0 || ty < 0 || tx >= TCOLS || ty >= TROWS) continue;
    const id = city.bid[ty * TCOLS + tx];
    if (id < 0 || seen.has(id) || city.buildings[id].dead) continue;
    const nx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE)), ny = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
    if (Math.hypot(nx - x, ny - y) > r) continue;
    seen.add(id);
    damageBuilding(city, city.buildings[id], dmg);
  }
}

/** Set buildings in a cone alight */
function igniteInArc(run, a, arc, reach, secs) {
  const p = run.player, city = run.city;
  for (let ty = Math.floor((p.y - reach) / TILE); ty <= Math.floor((p.y + reach) / TILE); ty++) for (let tx = Math.floor((p.x - reach) / TILE); tx <= Math.floor((p.x + reach) / TILE); tx++) {
    if (tx < 0 || ty < 0 || tx >= TCOLS || ty >= TROWS) continue;
    const id = city.bid[ty * TCOLS + tx];
    if (id < 0 || city.buildings[id].dead) continue;
    const nx = Math.max(tx * TILE, Math.min(p.x, (tx + 1) * TILE)), ny = Math.max(ty * TILE, Math.min(p.y, (ty + 1) * TILE));
    const d = Math.hypot(nx - p.x, ny - p.y);
    if (d > reach || (d > 2 && angDiff(Math.atan2(ny - p.y, nx - p.x), a) > arc / 2 + 0.3)) continue;
    city.buildings[id].burn = Math.max(city.buildings[id].burn || 0, secs);
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
    run.tally.buildings++;
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
  const rail = def.kind === "rail";
  for (const id of cut) damageBuilding(run.city, run.city.buildings[id], dmg * BUILDING_DMG.energy * (rail ? 0.7 : 1));
  const m = mountPoint(run, run.weapons.indexOf(w));
  run.fx.push({ type: rail ? "rail" : "beam", x1: m.x + Math.cos(bestA) * 8, y1: m.y + Math.sin(bestA) * 8, x2: ex, y2: ey, w: def.width, t: rail ? 0.4 : 0.3, max: rail ? 0.4 : 0.3 });
  if (rail) {
    run.shake = Math.max(run.shake, 8);
    const rand = run.rand;
    for (let i = 0; i < 24; i++) {   // sparks shed along the slug's path
      const f = rand(), a = bestA + Math.PI / 2 * (rand() < 0.5 ? 1 : -1) + (rand() - 0.5), v = 20 + rand() * 50;
      run.parts.push({ x: p.x + (ex - p.x) * f, y: p.y + (ey - p.y) * f, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.4, max: 0.4, color: rand() < 0.5 ? "#e6d4ff" : "#a67cff", size: 1 });
    }
  }
  p.aim = bestA;
  run.events.push({ type: rail ? "rail" : "beam" });
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

function hitEnemy(run, e, dmg, kx, ky, quiet = false) {
  if (e.dead) return;
  run.m.dealt += Math.min(dmg, Math.max(0, e.hp));
  e.hp -= dmg; e.flash = quiet ? Math.max(e.flash, 0.03) : 0.08;
  const m = e.d.mass || 1;
  e.kx += kx / m; e.ky += ky / m;
  if (!quiet) run.texts.push({ x: e.x + (run.rand() - 0.5) * 6, y: e.y - e.d.r, n: Math.round(dmg), t: 0.6, max: 0.6 });
  if (e.hp > 0) { if (!quiet) run.events.push({ type: "hit" }); return; }
  run.events.push({ type: "boom", r: e.d.r });
  e.dead = true; run.kills++;
  run.tally.kills++; if (e.elite) run.tally.elites++; if (e.d.boss) { run.tally.bosses++; run.m.bossKillT = run.time; }
  run.fx.push({ type: "boom", x: e.x, y: e.y, r: e.d.r, t: 0.4 + e.d.r * 0.02, max: 0.4 + e.d.r * 0.02 });
  for (let i = 0; i < 7 + e.d.r; i++) {
    const a = run.rand() * Math.PI * 2, sp = 30 + run.rand() * 70;
    run.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0.4 + run.rand() * 0.3, max: 0.7, color: e.d.color, size: 1 + (run.rand() * 2 | 0) });
  }
  gainXp(run, e.d.salvage * (e.elite ? ELITE.salvage : 1));
  let n = e.d.salvage * (e.elite ? ELITE.salvage : 1);
  while (n > 0) {
    const v = n >= 5 ? 5 : 1; n -= v;
    run.pickups.push({ x: e.x + (run.rand() - 0.5) * 10, y: e.y + (run.rand() - 0.5) * 10, n: v, v: 0, pull: false });
  }
  if (e.d.boss) { run.shake = Math.max(run.shake, 10); run.freeze = 0.18; }
  if (e.d.r >= 9) breakProps(run, e.x, e.y, e.d.r + 6);
  if (e.d.blast) explode(run, e);   // shot sappers still go off: chain reactions
}

function gainXp(run, n) {
  run.xp += n;
  while (run.xp >= XP.next(run.level)) {
    run.xp -= XP.next(run.level); run.level++; run.pending++;
    run.texts.push({ x: run.player.x, y: run.player.y - 16, n: "LEVEL UP", t: 1.1, max: 1.1, big: true });
    run.events.push({ type: "levelup" });
  }
}

function hurtPlayer(run, dmg, src = "other") {
  const p = run.player;
  if (p.iframes > 0) return;
  run.m.hits++; run.m.takenRaw += dmg;
  if (run.stats.dodge && run.rand() < run.stats.dodge) {   // glanced off
    run.m.glanced++;
    p.iframes = PLAYER_IFRAMES * 0.5;
    run.texts.push({ x: p.x, y: p.y - 12, n: "glance", t: 0.5, max: 0.5 });
    return;
  }
  p.hp -= dmg * armorMul(run.stats.armor);
  run.m.taken += dmg * armorMul(run.stats.armor);
  run.m.bySrc[src] = (run.m.bySrc[src] || 0) + dmg * armorMul(run.stats.armor);
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
  if (run.flashT > 0) run.flashT = Math.max(0, run.flashT - dt);
}

function tickPickups(run, dt) {
  const p = run.player;
  for (const k of run.pickups) {
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    if (d < run.stats.pickup || run.clearing > 0) k.pull = true;
    if (k.pull) { k.v = Math.min(400, k.v + 900 * dt); k.x += (dx / d) * k.v * dt; k.y += (dy / d) * k.v * dt; }
    if (d < run.chassis.radius + 3) { run.salvage += k.n; run.m.earned += k.n; k.got = true; run.events.push({ type: "pickup" }); }
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
  for (const k of ["enemies", "bolts", "shots", "marks", "shells", "missiles"]) run[k].length = 0;
  run.shake = Math.max(run.shake, 4);
  run.events.push({ type: "waveClear" });
}

function endWave(run) {
  const leftover = run.pickups.reduce((t, k) => t + k.n, 0) + SHOP.waveBonus(run.wave);
  run.salvage += leftover; run.m.earned += leftover;
  for (const k of ["enemies", "bolts", "shots", "pickups", "marks"]) run[k].length = 0;
  run.clearing = 0;
  if (run.wave >= WAVES.length - 1) { run.phase = "won"; return; }
  run.shop.rerolls = 0;
  rollOffers(run);
  if (run.pending > 0) { run.phase = "levelup"; run.perkRerolls = 0; rollPerks(run); }
  else run.phase = "hangar";
}

export function nextWave(run) {
  run.wave++;
  startWave(run);
}

// ---------------------------------------------------------------- pilot level-ups
export function rollPerks(run) {
  const keys = Object.keys(PERKS), out = [];
  while (out.length < 4) {
    const k = keys[Math.floor(run.rand() * keys.length)];
    if (out.some((o) => o.key === k)) continue;
    const rare = run.rand() < XP.rareChance(run.level);
    out.push({ key: k, rare, fx: PERKS[k][rare ? 3 : 2] });
  }
  run.perkOffers = out;
}
export const perkRerollCost = (run) => XP.rerollBase + run.perkRerolls + Math.floor(run.level / 3);
export function rerollPerks(run) {
  const c = perkRerollCost(run);
  if (run.salvage < c) return false;
  run.salvage -= c; run.m.spent += c; run.perkRerolls++;
  rollPerks(run);
  return true;
}
export function choosePerk(run, i) {
  const o = run.perkOffers[i];
  if (!o || run.phase !== "levelup") return false;
  run.perks.push({ key: o.key, rare: o.rare, fx: o.fx });
  recompute(run);
  run.pending--;
  if (run.pending > 0) rollPerks(run);
  else run.phase = "hangar";
  return true;
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
      const key = pick(run.rand, (run.allowed || Object.keys(WEAPONS)).map((k) => [k, 1]));
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
    if (run.load + MODULES[o.key].weight > capacityOf(run)) return "Over tonnage";
    return null;
  }
  if (!fits(run, WEAPONS[o.key].family)) {
    if (run.weapons.some((w) => w.key === o.key && w.tier === o.tier && w.tier < 3)) return null;   // merges instead
    return canMount(run.chassis, WEAPONS[o.key].family) ? "Hardpoints full" : `No ${WEAPONS[o.key].family} hardpoint`;
  }
  if (run.load + WEAPONS[o.key].weight > capacityOf(run)) return "Over tonnage";
  return null;
}

export function buy(run, i) {
  const o = run.shop.offers[i];
  if (!o || blocked(run, o)) return false;
  run.salvage -= o.price; run.m.spent += o.price;
  if (o.kind === "module") run.modules.push(o.key);
  else if (fits(run, WEAPONS[o.key].family)) addWeapon(run, o.key, o.tier);
  else run.weapons.find((w) => w.key === o.key && w.tier === o.tier).tier++;
  o.sold = true; o.locked = false;
  recompute(run);
  return true;
}

export function reroll(run) {
  const c = rerollCost(run);
  if (run.salvage < c) return false;
  run.salvage -= c; run.m.spent += c; run.shop.rerolls++;
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

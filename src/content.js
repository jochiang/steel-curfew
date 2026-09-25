// All tuning lives here. Units: world pixels, seconds, hit points.

import { TILE, COLS, ROWS } from "./city.js";
export const ARENA = { w: COLS * TILE, h: ROWS * TILE };   // the city grid

// How much each weapon family hurts buildings, relative to its damage to enemies
export const BUILDING_DMG = { ballistic: 1, energy: 1.3, melee: 1.6, burst: 1 };

// Hardpoint types: E energy, B ballistic, M melee, U universal (takes anything).
export const HARDPOINT = { E: "energy", B: "ballistic", M: "melee", U: "universal" };

// mounts: where each hardpoint's weapon sits, [dx, dy] from the mech's centre, in hardpoint order
// (hands first, then shoulders, then back).
export const CHASSIS = {
  kestrel: {
    name: "Kestrel", cls: "Light", blurb: "Fast and fragile. Lives by staying out of reach.",
    hp: 45, armor: 0, speed: 100, capacity: 40, radius: 7,
    hardpoints: ["E", "E", "B", "U"], fx: { dodge: 0.25 }, quirk: "25% of hits glance off",
    mounts: [[-5, -1], [5, -1], [-6, -7], [6, -7]],   // hands, then shoulder pods
  },
  warden: {
    name: "Warden", cls: "Medium", blurb: "The all-rounder. Two universal hardpoints take anything.",
    hp: 60, armor: 0, speed: 80, capacity: 60, radius: 8,
    hardpoints: ["B", "B", "E", "M", "U", "U"], fx: {}, quirk: "Two universal hardpoints",
    mounts: [[-8, -2], [8, -2], [-7, -11], [7, -11], [-3, -14], [3, -14]],   // hands, shoulders, back
  },
  bulwark: {
    name: "Bulwark", cls: "Heavy", blurb: "Slow, armoured, and it doesn't walk around buildings.",
    hp: 90, armor: 3, speed: 62, capacity: 85, radius: 10,
    hardpoints: ["M", "M", "B", "B", "U"], fx: { ram: 1 }, quirk: "Walks through buildings and rams enemies",
    mounts: [[-9, -1], [9, -1], [-8, -10], [8, -10], [0, -13]],
  },
  tempest: {
    name: "Tempest", cls: "Assault", blurb: "An energy platform built around its capacitor.",
    hp: 70, armor: 1, speed: 72, capacity: 75, radius: 9,
    hardpoints: ["E", "E", "E", "B", "U"], fx: { fillMul: -0.3 }, quirk: "Capacitor charges 30% faster",
    mounts: [[-8, -2], [8, -2], [-7, -9], [7, -9], [0, -14]],
  },
};
export const RAM = { building: 90, enemy: 10, knock: 140, every: 0.45 };   // Bulwark: dps to buildings; hit per enemy contact

// speed multiplier from load: empty frame 1.15x, at capacity 0.75x
export const loadSpeed = (load, cap) => 1.15 - 0.4 * Math.min(1, load / cap);

// Damage taken after armor (Brotato-style diminishing returns)
export const armorMul = (armor) => (armor >= 0 ? 1 / (1 + armor / 15) : 1 - armor / 15);

export const TIER_DMG = [1, 1.6, 2.4, 3.5];
export const TIER_PRICE = [1, 2, 3.5, 6];
export const TIER_NAMES = ["I", "II", "III", "IV"];

// Energy (heat) weapons share one mech-wide capacitor. When it's full they all discharge
// together (an alpha strike), then the mech vents.
export const HEAT = {
  baseFill: 3.0,       // seconds to charge with one energy weapon
  perExtraFill: 0.6,   // + seconds per additional energy weapon
  baseVent: 0.5,       // vent seconds = baseVent + ventPerHeat * total heat
  ventPerHeat: 0.015,
};

// How the capacitor picks its moment and its target. Heavies (mass >= 3) count as 3 enemies.
export const TARGETING = {
  crowd:   { name: "Crowd",   desc: "Holds the charge until a shot hits 3+ enemies (a heavy counts as 3)" },
  heavies: { name: "Heavies", desc: "Saves the shot for the toughest enemy in range; otherwise acts like Crowd" },
  nearest: { name: "Nearest", desc: "Fires at the closest enemy the moment the charge is full" },
};
export const CROWD_NEED = 3;     // threat needed before a Crowd/Heavies shot fires
export const HOLD_GIVEUP = 2.5;  // seconds at full charge before it settles for any target

export const WEAPONS = {
  autocannon: {
    name: "Autocannon", barrel: 8, family: "ballistic", weight: 6, price: 18,
    desc: "Steady stream of shells. Reloads every 10 rounds.",
    dmg: 5, range: 130, interval: 0.14, mag: 10, reload: 1.6, speed: 320, spread: 0.06, pellets: 1,
  },
  flak: {
    name: "Flak Cannon", barrel: 6, family: "ballistic", weight: 8, price: 22,
    desc: "Short-range spread of 5 pellets. 4-shell magazine.",
    dmg: 4, range: 85, interval: 0.5, mag: 4, reload: 1.8, speed: 280, spread: 0.35, pellets: 5,
  },
  lance: {
    name: "Particle Lance", barrel: 10, family: "energy", weight: 8, price: 28, heat: 50,
    desc: "Discharges a piercing beam through the densest line of enemies.",
    dmg: 55, range: 180, width: 7, kind: "beam",
  },
  nova: {
    name: "Pulse Emitter", barrel: 5, family: "energy", weight: 5, price: 22, heat: 35,
    desc: "Discharges a shockwave around the mech that hurls enemies back.",
    dmg: 30, range: 58, kind: "nova", knock: 160,
  },
  missiles: {
    name: "Missile Pod", barrel: 5, family: "ballistic", weight: 7, price: 26,
    desc: "Salvos of 3 homing missiles that arc over cover and burst on impact.",
    dmg: 9, range: 170, interval: 0.16, mag: 3, reload: 2.2, missile: { speed: 150, aoe: 16 },
  },
  rail: {
    name: "Railgun", barrel: 11, family: "energy", weight: 9, price: 32, heat: 70,
    desc: "Discharges a hypersonic slug that punches through everything, buildings included, across the map.",
    dmg: 110, range: 340, width: 3, kind: "rail",
  },
  fist: {
    name: "Hydraulic Fist", barrel: 6, family: "melee", weight: 7, price: 16,
    desc: "Slow, heavy punches with big knockback.",
    dmg: 18, reach: 20, arc: 1.1, cooldown: 0.55, knock: 110,
  },
  chainblade: {
    name: "Chainblade", barrel: 12, family: "melee", weight: 5, price: 20,
    desc: "Fast sweeping cuts that hit everything in the arc.",
    dmg: 6, reach: 22, arc: 1.9, cooldown: 0.2, knock: 25,
  },
  pyre: {
    name: "Pyre Projector", barrel: 7, family: "melee", weight: 6, price: 22,
    desc: "Sprays fire in a cone. Enemies burn; buildings catch fire and burn down.",
    dmg: 2.5, reach: 34, arc: 0.8, cooldown: 0.1, knock: 4, burn: { dps: 5, dur: 2.5 }, buildingBurn: 5,
  },
};

// Stat keys: maxHp, armor, regen, speedMul, dmgBallistic, dmgEnergy, dmgMelee, rangeMul,
// reloadMul, fillMul, ventMul, pickup, ventSpeed, ventBurst, isolatedLoops, dodge, ram
export const MODULES = {
  plating:  { name: "Armor Plating",      weight: 8, price: 20, fx: { armor: 3, maxHp: 5 },       desc: "+3 armor, +5 max HP" },
  frame:    { name: "Reinforced Frame",   weight: 6, price: 18, fx: { maxHp: 20 },                desc: "+20 max HP" },
  actuator: { name: "Actuator Upgrade",   weight: 2, price: 16, fx: { speedMul: 0.1 },            desc: "+10% speed" },
  nanites:  { name: "Repair Nanites",     weight: 1, price: 22, fx: { regen: 0.6 },               desc: "+0.6 HP/s regeneration" },
  sinks:    { name: "Heat Sinks",         weight: 4, price: 18, fx: { ventMul: -0.2 },            desc: "Vents 20% faster" },
  reactor:  { name: "Reactor Core",       weight: 5, price: 24, fx: { fillMul: -0.15 },           desc: "Capacitor charges 15% faster" },
  feed:     { name: "Ammo Feed",          weight: 3, price: 16, fx: { reloadMul: -0.2 },          desc: "Reloads 20% faster" },
  servos:   { name: "Servo Motors",       weight: 3, price: 18, fx: { dmgMelee: 0.2 },            desc: "+20% melee damage" },
  lens:     { name: "Capacitor Lens",     weight: 2, price: 18, fx: { dmgEnergy: 0.2 },           desc: "+20% energy damage" },
  barrels:  { name: "Calibrated Barrels", weight: 2, price: 18, fx: { dmgBallistic: 0.2 },        desc: "+20% ballistic damage" },
  magnet:   { name: "Salvage Magnet",     weight: 1, price: 10, fx: { pickup: 25 },               desc: "+25 salvage pickup range" },
  targeting:{ name: "Targeting Computer", weight: 2, price: 20, fx: { rangeMul: 0.15 },           desc: "+15% weapon range" },
  // vent twists
  overdrive:{ name: "Overdrive Actuators",weight: 3, price: 22, fx: { ventSpeed: 0.4 },           desc: "+40% speed while venting" },
  heatdump: { name: "Heat Dump",          weight: 4, price: 26, fx: { ventBurst: 25 },            desc: "Venting scalds everything nearby (25 dmg)" },
  loops:    { name: "Isolated Coolant Loops", weight: 10, price: 35, fx: { isolatedLoops: 1 },   desc: "Ballistic and melee weapons stay online while venting", unique: true },
};

export const ENEMIES = {
  drone:   { name: "Scrap Drone", hp: 10, speed: 40, dmg: 6,  r: 5,  salvage: 1, color: "#c8604a" },
  skitter: { name: "Skitter",     hp: 6,  speed: 72, dmg: 4,  r: 4,  salvage: 1, color: "#d9a441" },
  brute:   { name: "Brute",       hp: 60, speed: 28, dmg: 12, r: 9,  salvage: 5, color: "#8a4f7d", mass: 3, crush: 45 },
  spitter: { name: "Spitter",     hp: 16, speed: 34, dmg: 5,  r: 5,  salvage: 2, color: "#5aa36b",
             keepAway: 95, shootEvery: 2.2, boltSpeed: 90, boltDmg: 6 },
  mortar:  { name: "Mortar",      hp: 30, speed: 26, dmg: 6,  r: 6,  salvage: 3, color: "#a8927e", maxAlive: 3,
             keepAway: 150, lobEvery: 4.2, shell: { flight: 1.3, radius: 18, dmg: 10, building: 30 } },
  sapper:  { name: "Sapper",      hp: 12, speed: 58, dmg: 0,  r: 5,  salvage: 2, color: "#e8c547",
             blast: { radius: 22, dmg: 13, enemyDmg: 30, building: 120, fuse: 0.35 } },
  wasp:    { name: "Wasp",        hp: 8,  speed: 66, dmg: 5,  r: 4,  salvage: 1, color: "#6fbfb0", flying: true },
  siege:   { name: "Siege Walker", hp: 590, speed: 22, dmg: 20, r: 14, salvage: 45, color: "#a8927e", mass: 20, crush: 200, boss: true,
             keepAway: 90, barrageEvery: 5, barrage: 5, deployEvery: 8, deploy: 3, shell: { flight: 1.5, radius: 24, dmg: 16, building: 60 } },
  crusher: { name: "Crusher",     hp: 460, speed: 30, dmg: 20, r: 16, salvage: 40, color: "#b23a3a", mass: 20, crush: 260,
             burstEvery: 4, burstCount: 10, boltSpeed: 80, boltDmg: 8, boss: true },
};

// Wave table. pool: [type, weight]
export const WAVES = [
  { duration: 20, interval: 1.5, group: 3, pool: [["drone", 1]] },
  { duration: 25, interval: 1.35, group: 4, pool: [["drone", 3], ["skitter", 1], ["wasp", 1]] },
  { duration: 30, interval: 1.7, group: 4, pool: [["drone", 6], ["skitter", 2], ["brute", 1], ["sapper", 1]] },
  { duration: 35, interval: 1.4, group: 4, pool: [["drone", 5], ["skitter", 2], ["brute", 1], ["spitter", 1], ["mortar", 1], ["wasp", 1]] },
  { duration: 45, interval: 1.5, group: 4, pool: [["drone", 4], ["skitter", 2], ["brute", 1], ["spitter", 1], ["mortar", 1], ["sapper", 1], ["wasp", 1]], boss: ["crusher", "siege"] },
];
export const waveHpMul = (w) => 1 + 0.25 * w;   // w is 0-based
// Elites: tougher, gold-outlined versions of ordinary enemies (not bosses), from wave 2
export const ELITE = { chance: (w) => (w >= 1 ? 0.02 + 0.012 * w : 0), hp: 3, dmg: 1.5, salvage: 4, speed: 0.9 };
// spawn groups grow through a wave: +1 enemy per GROUP_GROW seconds, at most GROUP_GROW_MAX
export const GROUP_GROW = 15, GROUP_GROW_MAX = 2;
export const waveDmgMul = (w) => 1 + 0.15 * w;

export const SHOP = {
  offers: 4,
  rerollBase: 3,
  rerollStep: 2,
  priceWaveMul: (w) => 1 + 0.12 * w,          // w = waves cleared - 1
  sellFrac: 0.5,
  waveBonus: (w) => 10 + 5 * w,
};

// Pilot level-ups: kills give XP; each level is one pick of four at the end of the wave.
export const XP = { next: (level) => 10 + 6 * level, rareChance: (level) => Math.min(0.45, 0.12 + 0.03 * level), rerollBase: 2 };
// [name, desc, fx common, fx rare]
export const PERKS = {
  hull:     ["Reinforced Hull", "max HP",             { maxHp: 10 },         { maxHp: 22 }],
  plating:  ["Composite Plating", "armor",            { armor: 1 },          { armor: 2 }],
  servos:   ["Servo Tuning", "speed",                 { speedMul: 0.05 },    { speedMul: 0.1 }],
  repair:   ["Field Repairs", "HP/s repair",          { regen: 0.3 },        { regen: 0.7 }],
  gunnery:  ["Gunnery", "ballistic damage",           { dmgBallistic: 0.08 }, { dmgBallistic: 0.16 }],
  focusing: ["Focusing", "energy damage",             { dmgEnergy: 0.08 },   { dmgEnergy: 0.16 }],
  brawler:  ["Brawler", "melee damage",               { dmgMelee: 0.08 },    { dmgMelee: 0.16 }],
  optics:   ["Optics", "weapon range",                { rangeMul: 0.06 },    { rangeMul: 0.12 }],
  loader:   ["Autoloader", "reload time",             { reloadMul: -0.08 },  { reloadMul: -0.16 }],
  charge:   ["Charge Discipline", "capacitor charge", { fillMul: -0.06 },    { fillMul: -0.12 }],
  coolant:  ["Coolant Routing", "vent time",          { ventMul: -0.08 },    { ventMul: -0.16 }],
  magnet:   ["Scavenger", "salvage pickup range",     { pickup: 10 },        { pickup: 22 }],
  reflexes: ["Reflexes", "glance chance",             { dodge: 0.04 },       { dodge: 0.08 }],
  frame:    ["Frame Bracing", "tonnage capacity",     { capacity: 5 },       { capacity: 10 }],
};

export const PLAYER_IFRAMES = 0.4;
export const PICKUP_RADIUS = 30;
export const MAX_ENEMIES = 260;

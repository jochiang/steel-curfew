// All tuning lives here. Units: world pixels, seconds, hit points.

export const ARENA = { w: 640, h: 640 };

export const CHASSIS = {
  warden: {
    name: "Warden",
    blurb: "Medium frame. Balanced hardpoints, 60 t of capacity.",
    hp: 60,
    speed: 80,        // px/s before load
    capacity: 60,     // tonnes of weapons + modules
    slots: 6,
    radius: 8,
  },
};

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
    name: "Autocannon", family: "ballistic", weight: 6, price: 18,
    desc: "Steady stream of shells. Reloads every 10 rounds.",
    dmg: 5, range: 130, interval: 0.14, mag: 10, reload: 1.6, speed: 320, spread: 0.06, pellets: 1,
  },
  flak: {
    name: "Flak Cannon", family: "ballistic", weight: 8, price: 22,
    desc: "Short-range spread of 5 pellets. 4-shell magazine.",
    dmg: 4, range: 85, interval: 0.5, mag: 4, reload: 1.8, speed: 280, spread: 0.35, pellets: 5,
  },
  lance: {
    name: "Particle Lance", family: "energy", weight: 8, price: 28, heat: 50,
    desc: "Discharges a piercing beam through the densest line of enemies.",
    dmg: 55, range: 180, width: 7, kind: "beam",
  },
  nova: {
    name: "Pulse Emitter", family: "energy", weight: 5, price: 22, heat: 35,
    desc: "Discharges a shockwave around the mech that hurls enemies back.",
    dmg: 30, range: 58, kind: "nova", knock: 160,
  },
  fist: {
    name: "Hydraulic Fist", family: "melee", weight: 7, price: 16,
    desc: "Slow, heavy punches with big knockback.",
    dmg: 18, reach: 20, arc: 1.1, cooldown: 0.55, knock: 110,
  },
  chainblade: {
    name: "Chainblade", family: "melee", weight: 5, price: 20,
    desc: "Fast sweeping cuts that hit everything in the arc.",
    dmg: 6, reach: 22, arc: 1.9, cooldown: 0.2, knock: 25,
  },
};

// Stat keys: maxHp, armor, regen, speedMul, dmgBallistic, dmgEnergy, dmgMelee, rangeMul,
// reloadMul, fillMul, ventMul, pickup, ventSpeed, ventBurst, isolatedLoops
export const MODULES = {
  plating:  { name: "Armor Plating",      weight: 8, price: 20, fx: { armor: 3, maxHp: 5 },       desc: "+3 armor, +5 max HP" },
  frame:    { name: "Reinforced Frame",   weight: 6, price: 18, fx: { maxHp: 15 },                desc: "+15 max HP" },
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
  brute:   { name: "Brute",       hp: 60, speed: 28, dmg: 12, r: 9,  salvage: 5, color: "#8a4f7d", mass: 3 },
  spitter: { name: "Spitter",     hp: 16, speed: 34, dmg: 5,  r: 5,  salvage: 2, color: "#5aa36b",
             keepAway: 95, shootEvery: 2.2, boltSpeed: 90, boltDmg: 6 },
  crusher: { name: "Crusher",     hp: 700, speed: 30, dmg: 20, r: 16, salvage: 40, color: "#b23a3a", mass: 20,
             burstEvery: 4, burstCount: 10, boltSpeed: 80, boltDmg: 8, boss: true },
};

// Wave table. pool: [type, weight]
export const WAVES = [
  { duration: 20, interval: 1.6, group: 3, pool: [["drone", 1]] },
  { duration: 25, interval: 1.4, group: 4, pool: [["drone", 3], ["skitter", 1]] },
  { duration: 30, interval: 1.2, group: 4, pool: [["drone", 3], ["skitter", 2], ["brute", 1]] },
  { duration: 35, interval: 1.1, group: 5, pool: [["drone", 3], ["skitter", 2], ["brute", 1], ["spitter", 1]] },
  { duration: 45, interval: 1.0, group: 5, pool: [["drone", 3], ["skitter", 2], ["brute", 2], ["spitter", 2]], boss: "crusher" },
];
export const waveHpMul = (w) => 1 + 0.3 * w;   // w is 0-based
export const waveDmgMul = (w) => 1 + 0.15 * w;

export const SHOP = {
  offers: 4,
  rerollBase: 3,
  rerollStep: 2,
  priceWaveMul: (w) => 1 + 0.12 * w,          // w = waves cleared - 1
  sellFrac: 0.5,
  waveBonus: (w) => 8 + 4 * w,
};

export const PLAYER_IFRAMES = 0.4;
export const PICKUP_RADIUS = 30;
export const MAX_ENEMIES = 260;

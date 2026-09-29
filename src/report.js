// The After-Action Report (user: "classic Hitman games ... a tongue in cheek rating system that comments on
// how much of the city you destroy in the process"). Pure: reads a run's ledger (run.m, see attachLedger in
// game.js) and returns what the end screen shows. The rating is YOUR share of the city's damage.
import { WEAPONS, ENEMIES } from "./content.js";

// [share of the city's HP you knocked off, title, the Mayor on a win, the Mayor after a loss]
export const RATINGS = [
  [0.03, "Guardian Angel", "We barely knew you were here. Thank you.", "They say you never scratched the paint. Rest easy."],
  [0.07, "Precision Instrument", "Surgical. The insurance adjusters are bored.", "Tidy to the very end."],
  [0.12, "Acceptable Losses", "A few blocks. We'll rebuild. We always rebuild.", "We'll rebuild. Mostly the parts you didn't touch."],
  [0.18, "Collateral Enthusiast", "Thank you for your service. Please stop.", "Thank you for your service. The bill is in the mail."],
  [0.26, "Urban Renewal Specialist", "We were going to redevelop that district anyway.", "The redevelopment plan now includes a memorial. And a crater."],
  [0.36, "Demolition Contractor", "The invaders are gone. So is Fourth Street.", "The invaders are still here. Fourth Street is not."],
  [Infinity, "We Had To Destroy The City To Save It", "Mission accomplished. City status: pending.", "We had to destroy the city. We did not, it turns out, save it."],
];
const PER_HP = 120000;                                        // dollars per point of building damage (~$2.4B of city)
const PROP_PRICE = { car: 31000, lamp: 6500, tree: 2200 };

const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
const SOURCE = { ramming: "Ramming", "friendly fire": "Friendly fire", plasma: "Plasma Bleed (fire)", coils: "Arc Coils", incend: "Incendiary Rounds (fire)", "vent burst": "Vent bursts", collateral: "Hive collateral", fire: "Fire", other: "Other" };
export const sourceName = (k) => WEAPONS[k]?.name || SOURCE[k] || k;
/** "contact brute" -> "Brute (contact)", "spitter bolt" -> "Spitter bolts", ... */
export function hurtName(k) {
  const [first, ...rest] = k.split(" "), who = ENEMIES[first]?.name;
  if (first === "contact") return `${ENEMIES[rest[0]]?.name || rest[0]} (contact)`;
  return who ? `${who} ${rest.join(" ")}`.trim() : k.charAt(0).toUpperCase() + k.slice(1);
}

export function propertyBill(m) {
  const props = Object.entries(m.props || {}).reduce((t, [k, n]) => t + (PROP_PRICE[k] || 0) * n, 0);
  return { you: (m.prop?.you || 0) * PER_HP + props, invaders: (m.prop?.invaders || 0) * PER_HP };
}

export function afterAction(run) {
  const m = run.m, won = run.phase === "won" || !!run.endless;
  const share = m.cityHp ? (m.prop?.you || 0) / m.cityHp : 0;
  const [, title, winQuote, lossQuote] = RATINGS.find(([max]) => share < max);
  const bill = propertyBill(m), total = bill.you + bill.invaders;
  const yourPct = total > 0 ? Math.round((100 * bill.you) / total) : 0;
  const dealt = Object.values(m.dmgBy || {}).reduce((t, v) => t + v, 0) || 1;
  const byWeapon = Object.entries(m.dmgBy || {}).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ name: sourceName(k), dmg: Math.round(v), pct: Math.round((100 * v) / dealt) }));
  const worst = Object.entries(m.bySrc || {}).sort((a, b) => b[1] - a[1])[0];

  const medals = [], props = m.props || {}, leveled = m.leveled || { you: 0, invaders: 0 };
  const add = (ok, name, text) => { if (ok) medals.push({ name, text }); };
  add(run.curfew > 0, "Past Curfew", `Stayed out ${run.curfew} wave${run.curfew === 1 ? "" : "s"} past curfew.`);
  add(share < 0.03 && won, "Light Touch", "Held the city and barely scuffed it.");
  add(m.fires >= 8, "Controlled Burn", `Set ${m.fires} buildings on fire.`);
  add(leveled.you >= 10, "Urban Planner", `Personally leveled ${leveled.you} buildings.`);
  add(props.car >= 15, "Parking Enforcement", `Flattened ${props.car} parked cars.`);
  add(props.lamp >= 15, "Lights Out", `Took out ${props.lamp} street lamps.`);
  add((m.dmgBy?.ramming || 0) / dealt >= 0.15, "Road Rage", `Did ${Math.round((100 * (m.dmgBy?.ramming || 0)) / dealt)}% of your damage by walking into things.`);
  add((m.dmgBy?.["friendly fire"] || 0) >= 300, "Friendly Fire Consultant", "Let the invaders thin their own ranks.");
  add(bill.invaders > bill.you * 1.5 && bill.you > 0, "It Was Like That When We Got Here", "The invaders did most of the damage. Allegedly.");

  return {
    status: run.phase === "won" ? "CITY HELD" : run.endless ? `HELD ${run.curfew} PAST CURFEW` : "MECH LOST",
    title, quote: won ? winQuote : lossQuote, share,
    bill: { you: money(bill.you), invaders: money(bill.invaders), total: money(total), yourPct },
    collateral: { leveled: leveled.you, leveledByInvaders: leveled.invaders, fires: m.fires || 0, cars: props.car || 0, lamps: props.lamp || 0, trees: props.tree || 0 },
    combat: { byWeapon, kills: run.kills, elites: run.tally?.elites || 0, bosses: run.tally?.bosses || 0,
      worst: worst ? { name: hurtName(worst[0]), dmg: Math.round(worst[1]) } : null, earned: m.earned, spent: m.spent },
    medals: medals.slice(0, 3),
  };
}

/** One line for the hangar: the bill so far */
export function billSoFar(run) {
  const bill = propertyBill(run.m), total = bill.you + bill.invaders;
  return total > 0 ? `Property damage so far: ${money(total)}, ${Math.round((100 * bill.you) / total)}% of it yours` : "";
}

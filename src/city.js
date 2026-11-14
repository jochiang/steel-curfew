// Procedural, destructible city. Pure data + logic (no canvas), so the Node sim can use it.
//
// Layout: a 56x56 grid of 12px tiles (the Warden is ~1.5 tiles wide). A perimeter road plus randomly spaced avenues and streets
// cut the map into blocks. Each block gets a sidewalk ring, then becomes a park, a parking lot or
// a BSP-subdivided cluster of buildings, sometimes with 1-tile alleys (creeps fit, the mech
// doesn't). A plaza at the centre is kept open for deployment.

import { mulberry32 } from "./rng.js";

export const TILE = 12, COLS = 56, ROWS = 56;
export const T = { GROUND: 0, BUILDING: 1, RUBBLE: 2, WALL: 3, WATER: 4 };   // WATER: deep water. Nothing on the ground crosses it; shots and flyers do
export const G = { ROAD: 0, SIDEWALK: 1, PLAZA: 2, GRASS: 3, LOT: 4, ALLEY: 5, EDGE: 6, POOL: 7, DEEP: 8, BRIDGE: 9, PIER: 10 };
export const isWater = (g) => g === G.POOL || g === G.DEEP;

// District layouts (content.js DISTRICTS picks one per district; "classic" is the original city).
//   harbor: a waterfront along the south edge with piers, and a canal up through the map that only some streets bridge
//   midtown: a mall on the city's axis with a long reflecting pool and a monument, wide avenues, open courtyards
//   spire: two-tile streets, no parks, tall towers with alleys between them, and one giant tower beside the plaza
export const LAYOUTS = {
  classic: {},
  harbor:  { water: 7, canal: true, park: 0.06 },
  midtown: { mall: true, wide: 0.75, courtyard: 0.26, park: 0.14 },
  spire:   { wide: 0, courtyard: 0.03, park: 0.02, lot: 0.02, tall: 2, alley: 0.6, bigLot: 6, spire: true, tight: true },
};
export const BUILDING_STYLES = 6;   // plus style 6: the landmark tower

const PLAZA = { x0: COLS / 2 - 5, y0: ROWS / 2 - 5, x1: COLS / 2 + 4, y1: ROWS / 2 + 4 };

export function generateCity(seed, layout = "classic") {
  const L = LAYOUTS[layout] || LAYOUTS.classic;
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const N = COLS * ROWS, idx = (x, y) => y * COLS + x;
  const tile = new Uint8Array(N), ground = new Uint8Array(N).fill(G.LOT);
  const bid = new Int16Array(N).fill(-1), roadDir = new Uint8Array(N);
  const buildings = [], props = [];
  // extra ground kept clear of buildings, like the plaza: [x0, y0, x1, y1]
  const MALL = L.mall ? [COLS / 2 - 6, 4, COLS / 2 + 5, PLAZA.y0 - 1] : null;
  const SPIRE = L.spire ? [COLS / 2 - 4, PLAZA.y0 - 9, COLS / 2 + 3, PLAZA.y0 - 1] : null;   // the tower's footprint plus a ring of paving
  const open = [[PLAZA.x0, PLAZA.y0, PLAZA.x1, PLAZA.y1], MALL, SPIRE].filter(Boolean);
  const inPlaza = (x, y) => open.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  const RH = ROWS - (L.water || 0);   // the rows the street grid uses; below them, the harbour

  // perimeter wall
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) { tile[idx(x, y)] = T.WALL; ground[idx(x, y)] = G.EDGE; }
  }

  // road lines: [start, width]
  function lines(n) {
    const out = [[1, 2]];
    let p = 3 + ri(6, 9);
    for (;;) {
      const w = rand() < (L.wide ?? 0.3) ? 3 : 2;
      if (p + w + 6 > n - 3) break;
      out.push([p, w]);
      p += w + ri(6, 10);
    }
    out.push([n - 3, 2]);
    return out;
  }
  const xs = lines(COLS), ys = lines(RH);
  // the canal takes the place of one avenue, well clear of the plaza, and is a tile wider
  let canal = -1;
  if (L.canal) {
    const inner = xs.map((l, i) => i).filter((i) => i > 0 && i < xs.length - 1), clear = (i, m) => xs[i][0] + 3 < PLAZA.x0 - m || xs[i][0] > PLAZA.x1 + m;
    let ok = inner.filter((i) => clear(i, 3) && xs[i + 1][0] - xs[i][0] >= 10);
    if (!ok.length) ok = inner.filter((i) => clear(i, 0) && xs[i + 1][0] - xs[i][0] >= 9);   // tighter fits before giving up on a canal
    if (ok.length) { canal = ok[ri(0, ok.length - 1)]; xs[canal][1] = 3; }
  }
  for (const [x0, w] of xs) for (let x = x0; x < x0 + w; x++) for (let y = 1; y < RH - 1; y++) { ground[idx(x, y)] = G.ROAD; roadDir[idx(x, y)] |= 1; }
  for (const [y0, w] of ys) for (let y = y0; y < y0 + w; y++) for (let x = 1; x < COLS - 1; x++) { ground[idx(x, y)] = G.ROAD; roadDir[idx(x, y)] |= 2; }

  let tower = !!(L.mall || L.spire);   // those layouts place their own landmark
  function addBuilding(x0, y0, x1, y1) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1, area = w * h;
    const landmark = !tower && area >= 9 && w >= 3 && h >= 3 && rand() < 0.25;
    if (landmark) tower = true;
    const height = (landmark ? 4 : area >= 9 ? (rand() < 0.45 ? 3 : 2) : area >= 6 ? (rand() < 0.35 ? 2 : 1) : 1) + (L.tall && area >= 4 ? L.tall - (rand() < 0.3 ? 1 : 0) : 0);
    const maxHp = Math.round(area * 24 * (0.6 + 0.35 * height) * (landmark ? 1.6 : 1));
    const b = { id: buildings.length, x: x0, y: y0, w, h, height, style: landmark ? 6 : ri(0, BUILDING_STYLES - 1), hp: maxHp, maxHp, dead: false, seed: ri(0, 1e9), landmark };
    if (!landmark && w >= 2 && rand() < 0.32) b.neon = { color: ri(0, 3), at: rand() };   // a lit shop sign
    buildings.push(b);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tile[idx(x, y)] = T.BUILDING; bid[idx(x, y)] = b.id; }
  }
  function fill(x0, y0, x1, y1, g) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ground[idx(x, y)] = g; }

  // recursive split of a block interior into lots
  function split(x0, y0, x1, y1) {
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w <= 0 || h <= 0) return;
    let inside = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inPlaza(x, y)) inside++;
    if (inside && L.tight && inside < w * h && (w > 2 || h > 2)) {   // build right up to the open ground instead of clearing the whole lot
      if (w >= h) { const c = x0 + (w >> 1); split(x0, y0, c - 1, y1); split(c, y0, x1, y1); }
      else { const c = y0 + (h >> 1); split(x0, y0, x1, c - 1); split(x0, c, x1, y1); }
      return;
    }
    if (inside) { fill(x0, y0, x1, y1, G.PLAZA); return; }
    const lot = L.bigLot || 4, big = w > lot || h > lot || (w * h > 9 && rand() < 0.45);
    if (big && (w >= 4 || h >= 4)) {
      const vertical = w > h || (w === h && rand() < 0.5);
      const len = vertical ? w : h, alley = len >= 7 && rand() < (L.alley ?? 0.35) ? 1 : 0;
      const cut = ri(2, len - 2 - alley);
      if (vertical) {
        split(x0, y0, x0 + cut - 1, y1);
        if (alley) fill(x0 + cut, y0, x0 + cut, y1, G.ALLEY);
        split(x0 + cut + alley, y0, x1, y1);
      } else {
        split(x0, y0, x1, y0 + cut - 1);
        if (alley) fill(x0, y0 + cut, x1, y0 + cut, G.ALLEY);
        split(x0, y0 + cut + alley, x1, y1);
      }
      return;
    }
    if (rand() < (L.courtyard ?? 0.12)) { fill(x0, y0, x1, y1, G.PLAZA); return; }   // courtyard
    addBuilding(x0, y0, x1, y1);
  }

  // blocks between consecutive roads; some neighbours merge across the street between them
  // (superblocks), which breaks up the grid. Each block merges at most once, never into the plaza.
  const nbx = xs.length - 1, nby = ys.length - 1, blocks = [], used = new Set();
  const rectOf = (i, j) => [xs[i][0] + xs[i][1], ys[j][0] + ys[j][1], xs[i + 1][0] - 1, ys[j + 1][0] - 1];
  const hitsPlaza = ([x0, y0, x1, y1]) => open.some((o) => x1 >= o[0] && x0 <= o[2] && y1 >= o[1] && y0 <= o[3]);
  for (let i = 0; i < nbx; i++) for (let j = 0; j < nby; j++) {
    if (used.has(i + "," + j)) continue;
    const r = rectOf(i, j);
    used.add(i + "," + j);
    const right = i + 1 < nbx && !used.has(i + 1 + "," + j), down = j + 1 < nby && !used.has(i + "," + (j + 1));
    const roll = rand();
    if (!hitsPlaza(r) && roll < 0.22 && (right || down)) {
      const overCanal = i + 1 === canal;   // never merge across the water
      const horiz = right && !overCanal && (!down || rand() < 0.5), o = horiz ? rectOf(i + 1, j) : down ? rectOf(i, j + 1) : null;
      if (o && !hitsPlaza(o)) {
        used.add(horiz ? i + 1 + "," + j : i + "," + (j + 1));
        const m = [Math.min(r[0], o[0]), Math.min(r[1], o[1]), Math.max(r[2], o[2]), Math.max(r[3], o[3])];
        for (let y = m[1]; y <= m[3]; y++) for (let x = m[0]; x <= m[2]; x++) roadDir[idx(x, y)] = 0;   // the street between goes
        blocks.push({ r: m, merged: true });
        continue;
      }
    }
    blocks.push({ r, merged: false });
  }
  for (const { r: [bx0, by0, bx1, by1], merged } of blocks) {
    if (bx1 < bx0 || by1 < by0) continue;
    fill(bx0, by0, bx1, by1, G.SIDEWALK);
    const ix0 = bx0 + 1, iy0 = by0 + 1, ix1 = bx1 - 1, iy1 = by1 - 1;
    if (ix1 < ix0 || iy1 < iy0) continue;
    const r = rand();
    const park = L.park ?? 0.1;
    if (r < (merged ? 0.35 * (park / 0.1) : park)) {
      fill(ix0, iy0, ix1, iy1, G.GRASS);
      // footpaths across the park
      const px0 = ri(ix0 + 1, ix1 - 1), py0 = ri(iy0 + 1, iy1 - 1);
      for (let x = ix0; x <= ix1; x++) ground[idx(x, py0)] = G.PLAZA;
      for (let y = iy0; y <= iy1; y++) ground[idx(px0, y)] = G.PLAZA;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
        if (!inPlaza(x, y) && ground[idx(x, y)] === G.GRASS && rand() < 0.28) props.push({ type: "tree", x: (x + 0.3 + rand() * 0.4) * TILE, y: (y + 0.3 + rand() * 0.4) * TILE, v: ri(0, 2), broken: false });
      }
    } else if (r < park + (L.lot ?? 0.08)) {
      fill(ix0, iy0, ix1, iy1, G.LOT);
      for (let y = iy0; y <= iy1; y += 2) for (let x = ix0; x <= ix1; x++) {
        if (!inPlaza(x, y) && rand() < 0.45) props.push({ type: "car", x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, dir: 1, color: ri(0, 5), broken: false });
      }
    } else split(ix0, iy0, ix1, iy1);
  }
  // centre plaza is always open ground
  for (let y = PLAZA.y0; y <= PLAZA.y1; y++) for (let x = PLAZA.x0; x <= PLAZA.x1; x++) if (ground[idx(x, y)] !== G.ROAD) ground[idx(x, y)] = G.PLAZA;

  const pave = ([x0, y0, x1, y1]) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { ground[idx(x, y)] = G.PLAZA; roadDir[idx(x, y)] = 0; } };
  if (MALL) {   // the mall: paving, a long pool down the middle, trees along both sides, a monument at the far end
    const [x0, y0, x1, y1] = MALL;
    pave(MALL);
    for (let y = y0 + 5; y <= y1 - 1; y++) for (let x = x0 + 3; x <= x1 - 3; x++) ground[idx(x, y)] = G.POOL;
    for (let y = y0 + 5; y <= y1 - 1; y += 2) for (const x of [x0 + 1, x1 - 1]) props.push({ type: "tree", x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, v: ri(0, 2), broken: false });
    addBuilding(x0 + 4, y0, x1 - 4, y0 + 2);
    Object.assign(buildings[buildings.length - 1], { style: 6, landmark: true, height: 4, neon: undefined });
  }
  if (SPIRE) {   // the spire: one tower that dwarfs the rest, on its own paved square
    const [x0, y0, x1, y1] = SPIRE;
    pave(SPIRE);
    addBuilding(x0 + 1, y0 + 1, x1 - 1, y1 - 2);
    const b = buildings[buildings.length - 1];
    Object.assign(b, { style: 6, landmark: true, height: 9, neon: undefined, spire: true, fixed: true });   // fixed: it cannot be brought down
    b.hp = b.maxHp = Math.round(b.w * b.h * 24 * 4);
  }
  if (L.water) {   // the harbour: open water south of the quay road, with a pier off the end of every other avenue
    for (let y = RH - 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) { ground[idx(x, y)] = G.DEEP; roadDir[idx(x, y)] = 0; }
    xs.forEach(([x0, w], i) => {
      if (i === canal || i % 2 === 0 || i === xs.length - 1) return;
      const len = ri(3, L.water - 2);
      for (let y = RH - 1; y < RH - 1 + len; y++) for (let x = x0; x < x0 + 2; x++) ground[idx(x, y)] = G.PIER;
    });
  }
  if (canal >= 0) {   // the canal: water where the avenue was; every other street crosses it on a bridge
    const [x0, w] = xs[canal];
    for (let y = 1; y < ROWS - 1; y++) for (let x = x0; x < x0 + w; x++) { ground[idx(x, y)] = G.DEEP; roadDir[idx(x, y)] = 0; }
    ys.forEach(([y0, yw], j) => {
      const bridge = j === 0 || j === ys.length - 1 || j % 2 === 0;
      for (let y = y0; y < y0 + yw; y++) for (let x = x0; x < x0 + w; x++) if (bridge) { ground[idx(x, y)] = G.BRIDGE; roadDir[idx(x, y)] = 2; }
      if (!bridge) for (let y = y0; y < y0 + yw; y++) for (const x of [x0 - 1, x0 + w]) { ground[idx(x, y)] = G.SIDEWALK; roadDir[idx(x, y)] = 0; }   // the street stops at a quay
    });
  }

  // street furniture
  const near = (x, y, d) => props.some((p) => Math.abs(p.x - x) < d && Math.abs(p.y - y) < d);
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
    const i = idx(x, y), cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
    if (inPlaza(x, y)) continue;
    if ((roadDir[i] === 1 || roadDir[i] === 2) && rand() < 0.03 && !near(cx, cy, TILE * 2.5)) {
      props.push({ type: "car", x: cx, y: cy, dir: roadDir[i] === 1 ? 0 : 1, color: ri(0, 5), broken: false, lights: rand() < 0.45, face: rand() < 0.5 ? 1 : -1 });
    }
    if (ground[i] === G.SIDEWALK && rand() < 0.07 && !near(cx, cy, TILE * 2.5)) props.push({ type: "lamp", x: cx, y: cy, broken: false });
  }

  for (let i = 0; i < N; i++) if (ground[i] === G.DEEP) tile[i] = T.WATER;

  return {
    seed, layout, tile, ground, bid, roadDir, buildings, props, roads: { xs, ys }, plaza: PLAZA,
    spawn: { x: (COLS / 2) * TILE, y: (ROWS / 2) * TILE },
    w: COLS * TILE, h: ROWS * TILE,
    version: 0,        // bumps whenever the walkable map changes
    collapsed: [],     // building ids that fell, drained by the game/renderer
  };
}

// ---------------------------------------------------------------- queries
export const tileIndex = (x, y) => y * COLS + x;
export function solidTile(city, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  const t = city.tile[ty * COLS + tx];
  return t === T.BUILDING || t === T.WALL;
}
export const solidAt = (city, px, py) => solidTile(city, Math.floor(px / TILE), Math.floor(py / TILE));
/** Can nothing on the ground stand here? Solid tiles, plus deep water (which shots and sight lines cross). */
export function blockedTile(city, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return true;
  const t = city.tile[ty * COLS + tx];
  return t === T.BUILDING || t === T.WALL || t === T.WATER;
}
export const blockedAt = (city, px, py) => blockedTile(city, Math.floor(px / TILE), Math.floor(py / TILE));
/** The ground type under a point (G.*) */
export const groundAt = (city, px, py) => { const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE); return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS ? G.EDGE : city.ground[ty * COLS + tx]; };

/** Push a circle out of solid tiles. onHit(tileIndex) is called for each building tile touched. */
export function collide(city, o, r, onHit) {
  for (let pass = 0; pass < 2; pass++) {
    const tx0 = Math.floor((o.x - r) / TILE), tx1 = Math.floor((o.x + r) / TILE);
    const ty0 = Math.floor((o.y - r) / TILE), ty1 = Math.floor((o.y + r) / TILE);
    let moved = false;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (!blockedTile(city, tx, ty)) continue;
      const nx = Math.max(tx * TILE, Math.min(o.x, (tx + 1) * TILE)), ny = Math.max(ty * TILE, Math.min(o.y, (ty + 1) * TILE));
      let dx = o.x - nx, dy = o.y - ny, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d === 0) {   // centre inside the tile: push out along the shortest axis
        const l = o.x - tx * TILE, rr = (tx + 1) * TILE - o.x, t = o.y - ty * TILE, b = (ty + 1) * TILE - o.y, m = Math.min(l, rr, t, b);
        dx = m === l ? -1 : m === rr ? 1 : 0; dy = m === t ? -1 : m === b ? 1 : 0; d = 0;
        o.x += dx * (m + r); o.y += dy * (m + r);
      } else {
        o.x += (dx / d) * (r - d); o.y += (dy / d) * (r - d);
      }
      moved = true;
      if (onHit && tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && city.tile[ty * COLS + tx] === T.BUILDING) onHit(ty * COLS + tx);
    }
    if (!moved) break;
  }
}

/** Walk the tiles a segment crosses (Amanatides & Woo). fn(tx, ty, tEnter) returns true to stop. */
export function traverse(x0, y0, x1, y1, fn) {
  let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
  const ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
  const dx = x1 - x0, dy = y1 - y0, sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = dx ? Math.abs(TILE / dx) : Infinity, tdy = dy ? Math.abs(TILE / dy) : Infinity;
  let tmx = dx ? ((sx > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx)) : Infinity;
  let tmy = dy ? ((sy > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy)) : Infinity;
  let t = 0;
  for (let i = 0; i < 200; i++) {
    if (fn(tx, ty, t)) return;
    if (tx === ex && ty === ey) return;
    if (tmx < tmy) { t = tmx; tmx += tdx; tx += sx; } else { t = tmy; tmy += tdy; ty += sy; }
    if (t > 1) return;
  }
}

/** First solid tile between two points, or null. Returns { tx, ty, x, y } (x/y = entry point). */
export function raycast(city, x0, y0, x1, y1) {
  let hit = null;
  traverse(x0, y0, x1, y1, (tx, ty, t) => {
    if (!solidTile(city, tx, ty)) return false;
    hit = { tx, ty, x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
    return true;
  });
  return hit;
}
export const clearLine = (city, x0, y0, x1, y1) => !raycast(city, x0, y0, x1, y1);

/** Damage the building that owns a tile. Returns the building if it collapsed. */
export function damageAt(city, ti, dmg) {
  const id = city.bid[ti];
  return id >= 0 ? damageBuilding(city, city.buildings[id], dmg) : null;
}
export function damageBuilding(city, b, dmg, quiet = false) {
  if (!b || b.dead) return null;
  if (b.fixed) { if (!quiet) b.hit = 0.12; return null; }
  if (city.dmgMul) dmg *= city.dmgMul();   // Wrecking Crew (game.js)
  city.onDamage?.(b, Math.min(dmg, Math.max(0, b.hp)));   // the run's property-damage ledger (game.js)
  b.hp -= dmg; if (!quiet) b.hit = 0.12;
  if (b.hp > 0) return null;
  b.dead = true; b.hp = 0;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) city.tile[y * COLS + x] = T.RUBBLE;
  city.version++;
  city.collapsed.push(b.id);
  return b;
}

/** Visible wall height in px (the 3/4 view extrusion) */
export const wallHeight = (b) => 4 + b.height * 6;

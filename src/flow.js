// Flow fields: one Dijkstra pass from the mech's tile, then every tile stores which neighbour to
// walk to. Hundreds of creeps then path for the price of an array lookup each. Rebuilt only when
// the mech changes tile or the map changes (a building falls).
//
// The heavy field (brutes, bosses) treats buildings as expensive but passable: they plough
// through when that's much shorter than walking round, damaging the building as they push.

import { COLS, ROWS, TILE, T } from "./city.js";

const N = COLS * ROWS;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

export function makeField(heavy = false) {
  return { heavy, dist: new Float32Array(N), dirx: new Float32Array(N), diry: new Float32Array(N), tx: -1, ty: -1, version: -1 };
}

function cost(city, i, heavy) {
  const t = city.tile[i];
  if (t === T.WALL) return Infinity;
  if (t === T.BUILDING) return heavy ? 7 : Infinity;
  return t === T.RUBBLE ? 1.3 : 1;
}

// minimal binary heap keyed on dist
const heap = new Int32Array(N * 8);
let hn = 0;
function push(f, i) {
  let k = hn++; heap[k] = i;
  while (k > 0) { const p = (k - 1) >> 1; if (f.dist[heap[p]] <= f.dist[i]) break; heap[k] = heap[p]; heap[p] = i; k = p; }
}
function pop(f) {
  const top = heap[0], last = heap[--hn];
  let k = 0;
  if (hn > 0) {
    heap[0] = last;
    for (;;) {
      const l = 2 * k + 1, r = l + 1;
      let m = k;
      if (l < hn && f.dist[heap[l]] < f.dist[heap[m]]) m = l;
      if (r < hn && f.dist[heap[r]] < f.dist[heap[m]]) m = r;
      if (m === k) break;
      const t = heap[k]; heap[k] = heap[m]; heap[m] = t; k = m;
    }
  }
  return top;
}

/** Recompute if the target tile or the map changed. Returns true if it rebuilt. */
export function updateField(f, city, px, py) {
  const tx = Math.max(0, Math.min(COLS - 1, Math.floor(px / TILE))), ty = Math.max(0, Math.min(ROWS - 1, Math.floor(py / TILE)));
  if (tx === f.tx && ty === f.ty && f.version === city.version) return false;
  f.tx = tx; f.ty = ty; f.version = city.version;
  const { dist } = f, heavy = f.heavy;
  dist.fill(Infinity);
  const start = ty * COLS + tx;
  dist[start] = 0; hn = 0; push(f, start);
  while (hn > 0) {
    const i = pop(f), x = i % COLS, y = (i / COLS) | 0, d = dist[i];
    for (const [dx, dy, len] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const j = ny * COLS + nx, c = cost(city, j, heavy);
      if (c === Infinity) continue;
      // no cutting corners past solid tiles
      if (dx && dy && (cost(city, y * COLS + nx, heavy) === Infinity || cost(city, ny * COLS + x, heavy) === Infinity)) continue;
      const nd = d + c * len;
      if (nd < dist[j]) { dist[j] = nd; push(f, j); }
    }
  }
  // direction per tile: towards the cheapest neighbour
  for (let i = 0; i < N; i++) {
    f.dirx[i] = 0; f.diry[i] = 0;
    if (dist[i] === Infinity || dist[i] === 0) continue;
    const x = i % COLS, y = (i / COLS) | 0;
    let best = dist[i], bx = 0, by = 0;
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const j = ny * COLS + nx;
      if (dist[j] >= best) continue;
      if (dx && dy && (cost(city, y * COLS + nx, heavy) === Infinity || cost(city, ny * COLS + x, heavy) === Infinity)) continue;
      best = dist[j]; bx = dx; by = dy;
    }
    const l = Math.hypot(bx, by) || 1;
    f.dirx[i] = bx / l; f.diry[i] = by / l;
  }
  return true;
}

/** Steering target for a creep at (x, y): the centre of the next tile along the field. */
export function steer(f, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return null;
  const i = ty * COLS + tx;
  if (f.dist[i] === Infinity || (f.dirx[i] === 0 && f.diry[i] === 0)) return null;
  return { x: (tx + 0.5 + f.dirx[i]) * TILE, y: (ty + 0.5 + f.diry[i]) * TILE };
}
export const reachable = (f, x, y) => {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS && f.dist[ty * COLS + tx] < Infinity;
};

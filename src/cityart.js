// Procedural pixel art for the city: the ground layer, building sprites (3/4 view: roof on top,
// south wall below it) and street props. Everything is seeded from the city so it's stable.

import { TILE, COLS, ROWS, T, G, wallHeight } from "./city.js";
import { mulberry32 } from "./rng.js";
import { OUTLINE } from "./art.js";

const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const hash = (a, b, c) => { let h = (a ^ Math.imul(b, 374761393) ^ Math.imul(c, 668265263)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- ground
export function paintGround(city) {
  const W = COLS * TILE, H = ROWS * TILE, c = new OffscreenCanvas(W, H), g = c.getContext("2d");
  const rand = mulberry32(city.seed * 7 + 1);
  const at = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS ? G.EDGE : city.ground[y * COLS + x]);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const x = tx * TILE, y = ty * TILE, kind = at(tx, ty);
    switch (kind) {
      case G.ROAD: case G.LOT: {
        px(g, "#24262c", x, y, TILE, TILE);
        for (let i = 0; i < 10; i++) px(g, rand() < 0.5 ? "#2a2c33" : "#1f2126", x + ((rand() * TILE) | 0), y + ((rand() * TILE) | 0), 1 + ((rand() * 2) | 0), 1);
        if (kind === G.LOT) { px(g, "#5d5b55", x, y + 2, 1, TILE - 4); if (rand() < 0.2) px(g, "#1c1d22", x + 3, y + 4, 5, 3); }
        break;
      }
      case G.SIDEWALK: {
        px(g, "#3a3d45", x, y, TILE, TILE);
        px(g, "#34373e", x, y + TILE / 2 - 1, TILE, 1); px(g, "#34373e", x + TILE / 2 - 1, y, 1, TILE);
        px(g, "#40434b", x, y, TILE, 1); px(g, "#40434b", x, y, 1, TILE);
        if (rand() < 0.3) px(g, "#33363d", x + ((rand() * (TILE - 4)) | 0), y + ((rand() * (TILE - 4)) | 0), 3, 2);
        break;
      }
      case G.PLAZA: {
        for (let yy = 0; yy < TILE; yy += 4) for (let xx = 0; xx < TILE; xx += 4) {
          px(g, ((xx + yy) / 4) % 2 ? "#3b3934" : "#37352f", x + xx, y + yy, 4, 4);
        }
        px(g, "#2f2d29", x, y, TILE, 1); px(g, "#2f2d29", x, y, 1, TILE);
        break;
      }
      case G.GRASS: {
        px(g, "#2c472d", x, y, TILE, TILE);
        for (let i = 0; i < 14; i++) px(g, rand() < 0.5 ? "#335333" : "#263f27", x + ((rand() * TILE) | 0), y + ((rand() * TILE) | 0), 1, 2);
        if (rand() < 0.25) px(g, rand() < 0.5 ? "#c9b45a" : "#b0647a", x + ((rand() * (TILE - 2)) | 0), y + ((rand() * (TILE - 2)) | 0));
        break;
      }
      case G.ALLEY: {
        px(g, "#1c1d22", x, y, TILE, TILE);
        for (let i = 0; i < 6; i++) px(g, rand() < 0.5 ? "#23242a" : "#17181c", x + ((rand() * TILE) | 0), y + ((rand() * TILE) | 0), 2, 1);
        break;
      }
      default: {   // edge barrier
        px(g, "#2b2d33", x, y, TILE, TILE);
        for (let i = 0; i < TILE; i++) px(g, Math.floor((x + y + i) / 4) % 2 ? "#d9a53a" : "#1d1a14", x + i, y + 4, 1, 4);
        px(g, "#3a3d45", x, y + 1, TILE, 2); px(g, "#16171b", x, y + TILE - 3, TILE, 2);
      }
    }
    // curb where sidewalk meets road: light lip on the sidewalk, dark gutter on the road
    if (kind === G.SIDEWALK) {
      if (at(tx - 1, ty) === G.ROAD) { px(g, "#4b4f58", x, y, 1, TILE); px(g, "#18191d", x - 1, y, 1, TILE); }
      if (at(tx + 1, ty) === G.ROAD) { px(g, "#4b4f58", x + TILE - 1, y, 1, TILE); px(g, "#18191d", x + TILE, y, 1, TILE); }
      if (at(tx, ty - 1) === G.ROAD) { px(g, "#4b4f58", x, y, TILE, 1); px(g, "#18191d", x, y - 1, TILE, 1); }
      if (at(tx, ty + 1) === G.ROAD) { px(g, "#4b4f58", x, y + TILE - 1, TILE, 1); px(g, "#18191d", x, y + TILE, TILE, 1); }
    }
  }
  // lane markings and crosswalks from the road lines
  const { xs, ys } = city.roads;
  const inside = (v, lines) => lines.some(([s, w]) => v >= s && v < s + w);
  const isRoad = (x, y) => at(x, y) === G.ROAD;
  for (const [x0, w] of xs) {
    const cx = (x0 + w / 2) * TILE;
    for (let y = TILE; y < H - TILE; y += 12) if (isRoad(Math.floor(cx / TILE), Math.floor(y / TILE)) && isRoad(Math.floor(cx / TILE), Math.floor((y + 6) / TILE)) && !inside(Math.floor(y / TILE), ys) && !inside(Math.floor((y + 6) / TILE), ys)) px(g, "#7a7462", Math.round(cx) - (w === 3 ? 1 : 0), y, w === 3 ? 2 : 1, 6);
  }
  for (const [y0, w] of ys) {
    const cy = (y0 + w / 2) * TILE;
    for (let x = TILE; x < W - TILE; x += 12) if (isRoad(Math.floor(x / TILE), Math.floor(cy / TILE)) && isRoad(Math.floor((x + 6) / TILE), Math.floor(cy / TILE)) && !inside(Math.floor(x / TILE), xs) && !inside(Math.floor((x + 6) / TILE), xs)) px(g, "#7a7462", x, Math.round(cy) - (w === 3 ? 1 : 0), 6, w === 3 ? 2 : 1);
  }
  for (const [x0, xw] of xs) for (const [y0, yw] of ys) {   // zebra crossings on each approach
    if (x0 < 2 || y0 < 2 || x0 + xw > COLS - 2 || y0 + yw > ROWS - 2) continue;
    const zl = Math.round(TILE * 0.55), zo = Math.round((TILE - zl) / 2);
    for (let i = 0; i < xw * TILE; i += 4) {
      if (isRoad(x0, y0 - 1)) px(g, "#8a8578", x0 * TILE + i + 1, (y0 - 1) * TILE + zo, 2, zl);
      if (isRoad(x0, y0 + yw)) px(g, "#8a8578", x0 * TILE + i + 1, (y0 + yw) * TILE + zo, 2, zl);
    }
    for (let i = 0; i < yw * TILE; i += 4) {
      if (isRoad(x0 - 1, y0)) px(g, "#8a8578", (x0 - 1) * TILE + zo, y0 * TILE + i + 1, zl, 2);
      if (isRoad(x0 + xw, y0)) px(g, "#8a8578", (x0 + xw) * TILE + zo, y0 * TILE + i + 1, zl, 2);
    }
  }
  // the deploy plaza: a ring of lighter pavers with a compass mark
  const pz = city.plaza, pcx = ((pz.x0 + pz.x1 + 1) / 2) * TILE, pcy = ((pz.y0 + pz.y1 + 1) / 2) * TILE;
  for (let y = -40; y <= 40; y++) for (let x = -40; x <= 40; x++) {
    const d = Math.hypot(x, y);
    if (at(Math.floor((pcx + x) / TILE), Math.floor((pcy + y) / TILE)) !== G.PLAZA) continue;
    if ((d > 30 && d < 34) || (d > 14 && d < 16)) px(g, (Math.floor(Math.atan2(y, x) * 8 / Math.PI) & 1) ? "#4a463e" : "#524d44", pcx + x, pcy + y);
    else if (d <= 3 || (d < 14 && (Math.abs(x) < 1 || Math.abs(y) < 1))) px(g, "#57524a", pcx + x, pcy + y);
  }
  return c;
}

/** Rubble over a fallen building's footprint, in its own colours */
export function paintRubble(g, b, seedExtra = 0) {
  const s = STYLES[b.style], rand = mulberry32(b.seed + 99 + seedExtra);
  const x0 = b.x * TILE, y0 = b.y * TILE, W = b.w * TILE, H = b.h * TILE;
  px(g, "#34312c", x0, y0, W, H);
  for (let i = 0; i < W * H / 10; i++) {
    const cx = x0 + rand() * W, cy = y0 + rand() * H, w = 1 + ((rand() * 4) | 0), h = 1 + ((rand() * 3) | 0);
    const r = rand();
    px(g, r < 0.3 ? s.roof : r < 0.55 ? s.wall : r < 0.7 ? "#4a463f" : r < 0.85 ? "#221f1c" : s.roofLight, cx | 0, cy | 0, w, h);
  }
  for (let i = 0; i < b.w * b.h; i++) {   // bent rebar
    const cx = x0 + rand() * W, cy = y0 + rand() * H;
    for (let k = 0; k < 4; k++) px(g, "#7a5a45", (cx + k) | 0, (cy + (k > 1 ? 1 : 0)) | 0);
  }
}

// ---------------------------------------------------------------- buildings
export const STYLES = [
  { roof: "#676a71", roofLight: "#7d8088", roofDark: "#50535a", wall: "#484b53", wallDark: "#383b42", win: "#1d2636", winLit: "#e8c877", trim: "#8a8e96" },
  { roof: "#6b4c42", roofLight: "#80604f", roofDark: "#533932", wall: "#6a3c31", wallDark: "#512e26", win: "#221a1c", winLit: "#f0c070", trim: "#9a7a6a" },
  { roof: "#4b676b", roofLight: "#5f7f84", roofDark: "#3a5155", wall: "#2d4850", wallDark: "#223840", win: "#5aa2b6", winLit: "#bff0ff", trim: "#7fa3a8" },
  { roof: "#877758", roofLight: "#9d8c6a", roofDark: "#6c5e45", wall: "#6c5d45", wallDark: "#554834", win: "#2a2419", winLit: "#f2d27a", trim: "#b3a07a" },
  { roof: "#4a4f5b", roofLight: "#5d6371", roofDark: "#3a3e48", wall: "#31353e", wallDark: "#262930", win: "#35587a", winLit: "#9fd0ff", trim: "#6b7282" },
  { roof: "#948e80", roofLight: "#aaa495", roofDark: "#79736a", wall: "#7a7466", wallDark: "#625d52", win: "#262a31", winLit: "#f5dd95", trim: "#c2bba9" },
  // 6: landmark tower, dark glass
  { roof: "#3c4656", roofLight: "#566276", roofDark: "#2c3440", wall: "#233044", wallDark: "#1a2433", win: "#4f86b8", winLit: "#d8f0ff", trim: "#34445c" },
];

/** Building sprite: W x (H + wall). stage 0 intact, 1 cracked, 2 wrecked. At night some windows
 *  are lit, and the sprite carries a `glow` mask of them (white) for the light map. */
export function paintBuilding(b, stage, night = false) {
  const s = STYLES[b.style], rand = mulberry32(b.seed);
  const W = b.w * TILE, H = b.h * TILE, Hw = wallHeight(b);
  const c = new OffscreenCanvas(W, H + Hw), g = c.getContext("2d");
  // roof slab with a parapet
  px(g, s.roof, 0, 0, W, H);
  px(g, s.roofLight, 1, 1, W - 2, 1); px(g, s.roofLight, 1, 1, 1, H - 2);
  px(g, s.roofDark, 1, H - 2, W - 2, 1); px(g, s.roofDark, W - 2, 1, 1, H - 2);
  px(g, s.roofDark, 3, 3, W - 6, 1); px(g, s.roofDark, 3, 3, 1, H - 6);   // inner parapet shadow
  for (let i = 0; i < 12 + W * H / 60; i++) px(g, rand() < 0.5 ? s.roofDark : s.roofLight, 4 + ((rand() * (W - 8)) | 0), 4 + ((rand() * (H - 8)) | 0));
  // rooftop kit (the landmark gets a helipad instead)
  if (b.landmark) {
    const hx = W >> 1, hy = H >> 1, r = Math.min(W, H) / 2 - 5;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d <= r) px(g, d > r - 1.5 ? "#d9a53a" : "#2e3542", hx + x, hy + y);
    }
    px(g, "#e6e6e0", hx - 3, hy - 3, 1, 7); px(g, "#e6e6e0", hx + 3, hy - 3, 1, 7); px(g, "#e6e6e0", hx - 3, hy, 7, 1);
    for (const [cx, cy] of [[3, 3], [W - 4, 3], [3, H - 4], [W - 4, H - 4]]) px(g, "#ff5b4a", cx, cy);   // warning lights
  }
  const items = b.landmark ? 0 : Math.max(1, Math.round((b.w * b.h) / 4));
  for (let i = 0; i < items; i++) {
    const kind = rand();
    const x = 4 + ((rand() * Math.max(1, W - 14)) | 0), y = 4 + ((rand() * Math.max(1, H - 12)) | 0);
    if (kind < 0.45) {   // AC unit
      px(g, OUTLINE, x - 1, y - 1, 8, 7); px(g, "#9aa0a8", x, y, 6, 3); px(g, "#6d737c", x, y + 3, 6, 2);
      px(g, "#3a3e45", x + 1, y + 1, 4, 1); px(g, "rgba(0,0,0,0.3)", x + 7, y, 1, 6);
    } else if (kind < 0.7) {   // vent stack
      px(g, OUTLINE, x - 1, y - 1, 5, 5); px(g, "#50555e", x, y, 3, 3); px(g, "#1a1b20", x + 1, y + 1, 1, 1);
    } else if (kind < 0.85 && b.height >= 2 && W >= 32) {   // water tank
      px(g, OUTLINE, x - 1, y - 1, 9, 9); px(g, "#7a5a3e", x, y, 7, 7); px(g, "#9a7652", x + 1, y + 1, 5, 2); px(g, "#5e442f", x, y + 5, 7, 2);
    } else {   // skylight
      px(g, OUTLINE, x - 1, y - 1, 8, 6); px(g, "#4f7f93", x, y, 6, 4); px(g, "#9fd3e6", x, y, 2, 1);
    }
  }
  // south wall with window rows
  px(g, s.wall, 0, H, W, Hw);
  px(g, "#15131b", 0, H, W, 1);                     // roof lip shadow
  px(g, s.wallDark, 0, H + Hw - 3, W, 3);            // street level
  const lit = [];
  for (let wy = H + 3; wy < H + Hw - 4; wy += 5) for (let wx = 2; wx < W - 3; wx += 5) {
    const broken = stage > 0 && rand() < stage * 0.35;
    const on = night && !broken && hash(b.seed, wx, wy) < 0.42;
    px(g, broken ? "#0e0d12" : on ? s.winLit : s.win, wx, wy, 3, 2);
    if (!broken) px(g, s.trim, wx, wy + 2, 3, 1);
    if (on) lit.push([wx, wy]);
  }
  for (let dx = 4; dx < W - 6; dx += 11) px(g, "#15131b", dx, H + Hw - 3, 3, 3);   // doorways
  // damage
  if (stage >= 1) {
    for (let k = 0; k < 2 + b.w; k++) {   // cracks
      let cx = 3 + rand() * (W - 6), cy = 3 + rand() * (H + Hw - 6);
      for (let i = 0; i < 6 + rand() * 6; i++) { px(g, "#1b1a1f", cx | 0, cy | 0); cx += rand() < 0.5 ? 1 : -1; cy += rand() < 0.7 ? 1 : 0; }
    }
  }
  if (stage >= 2) {
    for (let k = 0; k < 1 + b.w * b.h / 4; k++) {   // holes punched through the roof
      const hx = 3 + rand() * (W - 12), hy = 3 + rand() * (H - 10), hw = 4 + rand() * 6, hh = 3 + rand() * 4;
      px(g, "#0e0d12", hx | 0, hy | 0, hw | 0, hh | 0);
      px(g, "#7a5a45", hx | 0, (hy + hh) | 0, hw | 0, 1);
      px(g, s.roofDark, (hx + 1) | 0, (hy - 1) | 0, (hw - 2) | 0, 1);
    }
    g.globalCompositeOperation = "destination-out";
    for (let k = 0; k < b.w + 1; k++) { const ex = (rand() * (W - 6)) | 0; g.fillRect(ex, 0, 3 + ((rand() * 5) | 0), 2); }
    g.globalCompositeOperation = "source-over";
  }
  // outline
  px(g, OUTLINE, 0, 0, W, 1); px(g, OUTLINE, 0, 0, 1, H + Hw); px(g, OUTLINE, W - 1, 0, 1, H + Hw); px(g, OUTLINE, 0, H + Hw - 1, W, 1);
  if (night) {
    const m = new OffscreenCanvas(W, H + Hw), mg = m.getContext("2d");
    for (const [wx, wy] of lit) px(mg, "#ffffff", wx, wy, 3, 2);
    c.glow = m;
  }
  return c;
}

// ---------------------------------------------------------------- props
const CAR_COLORS = [["#b8453a", "#8a3029"], ["#3f6fb0", "#2d5087"], ["#d9c25a", "#a8923c"], ["#e6e6e0", "#b5b5ae"], ["#3c8a5a", "#2b6641"], ["#2a2c33", "#1c1d22"]];
export function propSprites() {
  const out = { car: [[], []], carBroken: [[], []], tree: [], treeBroken: null, lamp: null, lampBroken: null };
  for (let ci = 0; ci < CAR_COLORS.length; ci++) {
    const [body, dark] = CAR_COLORS[ci];
    for (const dir of [0, 1]) {
      for (const broken of [false, true]) {
        const w = dir ? 11 : 7, h = dir ? 7 : 11, c = new OffscreenCanvas(w, h), g = c.getContext("2d");
        const b = broken ? dark : body, d = broken ? "#1c1b20" : dark;
        px(g, OUTLINE, 0, 0, w, h);
        if (dir) {
          px(g, b, 1, 1, 9, 4); px(g, d, 1, 5, 9, 1);
          px(g, broken ? "#2a2e36" : "#6d8fa8", 3, 1, 5, 3); px(g, broken ? "#1a1c22" : "#a9c8dc", 3, 1, 2, 1);
          px(g, "#101014", 2, 5, 2, 2); px(g, "#101014", 7, 5, 2, 2);
        } else {
          px(g, b, 1, 1, 5, 9); px(g, d, 1, 8, 5, 2);
          px(g, broken ? "#2a2e36" : "#6d8fa8", 2, 2, 3, 3); px(g, broken ? "#2a2e36" : "#56748a", 2, 6, 3, 2);
          px(g, broken ? "#1a1c22" : "#a9c8dc", 2, 2, 2, 1);
        }
        if (broken) { g.globalCompositeOperation = "destination-out"; g.fillRect(0, 0, 2, 2); g.fillRect(w - 3, h - 2, 3, 2); g.globalCompositeOperation = "source-over"; px(g, "#6b5a4a", 3, 3, 2, 1); }
        (broken ? out.carBroken : out.car)[dir][ci] = c;
      }
    }
  }
  const greens = [["#2f5a30", "#3f7a3c", "#5a9a4c"], ["#2c4f3a", "#3a6a4c", "#56906a"], ["#4a5a2a", "#62763a", "#86a050"]];
  for (const [d, m, l] of greens) {
    const c = new OffscreenCanvas(13, 14), g = c.getContext("2d");
    px(g, "#3a2a1e", 5, 9, 3, 5);
    for (let y = 0; y < 11; y++) for (let x = 0; x < 13; x++) {
      const dd = Math.hypot(x - 6, y - 5);
      if (dd > 5.8) continue;
      g.fillStyle = dd > 5 ? OUTLINE : (x + y < 9 ? l : x + y > 13 ? d : m);
      g.fillRect(x, y, 1, 1);
    }
    out.tree.push(c);
  }
  out.treeBroken = (() => { const c = new OffscreenCanvas(13, 6), g = c.getContext("2d"); px(g, "#3a2a1e", 5, 2, 3, 3); px(g, "#3f7a3c", 0, 3, 4, 2); px(g, "#2f5a30", 9, 1, 4, 3); px(g, "#5a9a4c", 1, 1, 2, 1); return c; })();
  out.lamp = (() => { const c = new OffscreenCanvas(5, 14), g = c.getContext("2d"); px(g, OUTLINE, 1, 1, 3, 13); px(g, "#5a5f68", 2, 2, 1, 12); px(g, OUTLINE, 0, 0, 5, 3); px(g, "#e8e2c8", 1, 1, 3, 1); return c; })();
  out.lampBroken = (() => { const c = new OffscreenCanvas(12, 4), g = c.getContext("2d"); px(g, OUTLINE, 0, 1, 12, 3); px(g, "#5a5f68", 1, 2, 10, 1); px(g, "#6b6a60", 10, 1, 2, 1); return c; })();
  return out;
}

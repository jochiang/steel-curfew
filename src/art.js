// Pixel art, authored as text. Each sprite is a list of rows; each character is a palette key
// ("." is transparent). Symmetric sprites are written as the left half including the centre
// column and mirrored. With `light`, the mirrored (right) half drops one step on the numeric ramp,
// so everything reads as lit from the upper left.

export const OUTLINE = "#15131b";

const RAMPS = {
  steel:   ["#2a3140", "#4a5668", "#7a8aa0", "#b3c1d1", "#e6edf3"],
  hot:     ["#3d1f22", "#77403a", "#b7695a", "#e7a08a", "#ffd9c9"],
  rust:    ["#3e1b1d", "#7d342c", "#b95843", "#e48b66", "#f7c29a"],
  amber:   ["#43290f", "#87591c", "#c48c2d", "#e8b95a", "#faeab0"],
  violet:  ["#241629", "#4b2c55", "#77467a", "#a86f9f", "#d7a7c9"],
  moss:    ["#132a1d", "#275a3a", "#468a58", "#7fbf7a", "#c6ecb0"],
  crimson: ["#2c0e14", "#641b25", "#9e2f34", "#d0594a", "#f29a7c"],
};

function pal(ramp, extra = {}) {
  const r = RAMPS[ramp];
  return { o: OUTLINE, 1: r[0], 2: r[1], 3: r[2], 4: r[3], 5: r[4], ...extra };
}

export function build(rows, palette, { sym = false, light = false, patch = [], only = null } = {}) {
  let grid = rows.map((r) => [...r]);
  if (sym) {
    grid = grid.map((r) => {
      const right = r.slice(0, -1).reverse().map((ch) => (light && /[2-5]/.test(ch) ? String(+ch - 1) : ch));
      return [...r, ...right];
    });
  }
  for (const [x, y, ch] of patch) grid[y][x] = ch;
  const w = Math.max(...grid.map((r) => r.length)), h = grid.length;
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  grid.forEach((r, y) => r.forEach((ch, x) => {
    if (ch === "." || ch === " " || (only && !only.includes(ch))) return;
    const col = palette[ch];
    if (!col) throw new Error(`no colour for '${ch}'`);
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }));
  return c;
}

/** White silhouette of a sprite, for hit flashes */
export function flash(src, color = "#ffffff") {
  const c = new OffscreenCanvas(src.width, src.height), g = c.getContext("2d");
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ---------------------------------------------------------------- the Warden (player mech)
// Torso: 19x11. Shoulder pods are the weapon mounts; `v` are the heat grilles.
const TORSO = [
  "....oooooo",
  "ooooo45555",
  "o443o43333",
  "o333o3oooo",
  "ovvvo3obbb",
  "o332o3oabb",
  "ovvvo2oooo",
  "o221o23331",
  "ooooo22331",
  "....o11222",
  "....oooooo",
];
// One leg, 4 wide, plus a 5-wide foot. `lift` shortens the shin so the foot rises.
function leg(lift, mirror) {
  const shin = ["o22o", "o21o", "o11o", "o32o", "o21o"].slice(0, 5 - lift);
  const foot = ["ooooo", "o332o", "ooooo"];
  const m = (s) => (mirror ? [...s].reverse().join("").replace(/3/g, "2") : s);
  return { shin: shin.map(m), foot: foot.map(m) };
}
function legsRows(liftL, liftR) {
  const rows = Array.from({ length: 8 }, () => Array(19).fill("."));
  const put = (x, y, s) => [...s].forEach((ch, i) => { if (ch !== ".") rows[y][x + i] = ch; });
  for (const [x, fx, lift, mirror] of [[5, 4, liftL, false], [10, 10, liftR, true]]) {
    const l = leg(lift, mirror);
    l.shin.forEach((s, y) => put(x, y, s));
    l.foot.forEach((s, y) => put(fx, l.shin.length + y, s));
  }
  return rows.map((r) => r.join(""));
}

/** Mech frames. With glow, only the self-lit pixels (visor, and hot grilles) for night scenes. */
export function mechFrames(hot, ventPhase = 0, glow = false) {
  const vent = hot ? (ventPhase ? "#ffd27a" : "#ff8a4c") : "#20242c";
  const p = pal(hot ? "hot" : "steel", { v: vent, a: "#8f3e2c", b: "#d97757", c: "#ffc2a6" });
  const only = glow ? (hot ? "bcv" : "bc") : null;
  const torso = build(TORSO, p, { sym: true, light: true, patch: [[7, 4, "c"], [8, 4, "c"]], only });
  // walk cycle: plant, left up, plant (bob), right up
  const cycle = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]];
  return cycle.map(([l, r, bob]) => {
    const c = new OffscreenCanvas(19, 19), g = c.getContext("2d");
    if (!glow) g.drawImage(build(legsRows(l, r), p), 0, 10);
    g.drawImage(torso, 0, bob);
    return c;
  });
}

// ---------------------------------------------------------------- enemies
const DRONE = [
  ".....o",
  "...ooo",
  "..o455",
  ".o4ooo",
  "o43oee",
  "o32oeE",
  "o32oee",
  ".o2ooo",
  ".o2222",
  "..o211",
  "...ooo",
];
const SKITTER = [
  ["...ooo", "l.o443", ".lo4E3", "llo333", ".lo322", "l.o222", "...ooo"],
  ["...ooo", ".lo443", "l.o4E3", ".lo333", "l.o322", ".lo222", "...ooo"],
];
const BRUTE = [
  "....oooooo",
  "...o454444",
  "..o4443333",
  ".oo4333333",
  "o4o43ooooo",
  "o4o3oeEeoo",
  "o3o3oooooo",
  "o3oo333333",
  "o2o2233333",
  "o44oo22233",
  "o432o12222",
  "o321o11122",
  "oooo.o1111",
  ".....ooooo",
  ".....o21o.",
  ".....ooo..",
];
const SPITTER = [
  "....ooo",
  "...oGGg",
  "..oGggg",
  ".o4oooo",
  "o443oeE",
  "o432ooo",
  "o3322oM",
  ".o22222",
  "..o1111",
  "...oooo",
];
const CRUSHER = [
  "......ooooooooooo",
  ".....o44444443333",
  "....o444433333333",
  "...o4433333333333",
  "..o44333ooooooooo",
  "..o4333oeEEeooooo",
  "..o4333oeEEeooooo",
  "..o4333oooooooooo",
  "ooo.o333333333333",
  "o45oo333322222222",
  "o433o332211111111",
  "o432o332oFfFfFfFf",
  "o321o332ofFfFfFfF",
  "o321o332ooooooooo",
  "oooooo33222222222",
  "..oo2222222222222",
  "ooooooooooooooooo",
  "otTtTtTtTtTtTtTtT",
  "oTtTtTtTtTtTtTtTt",
  "ooooooooooooooooo",
];

const EYE = { e: "#ff6a3c", E: "#ffe8b8" };

/** Enemy frames. With glow, only the self-lit pixels (eyes, lens, acid sac, furnace). */
export function enemyFrames(type, glow = false) {
  const o = (only) => ({ sym: true, light: true, only: glow ? only : null });
  switch (type) {
    case "drone": return [build(DRONE, pal("rust", EYE), o("eE"))];
    case "skitter": return SKITTER.map((f) => build(f, pal("amber", { E: "#fff4c2", l: "#b5822a" }), o("E")));
    case "brute": return [build(BRUTE, pal("violet", EYE), o("eE"))];
    case "spitter": return [0, 1].map((k) => build(SPITTER, pal("moss", { g: k ? "#b7f07a" : "#8fd65e", G: k ? "#f2ffc4" : "#d8ff9a", e: "#1c3a22", E: "#e8ffd0", M: "#0f1f14" }), o("gGE")));
    case "crusher": return [0, 1].map((k) => build(CRUSHER, pal("crimson", {
      ...EYE, F: k ? "#ffd27a" : "#ff9a4c", f: k ? "#ff7a3c" : "#c9502e", t: "#1d1a22", T: k ? "#3b3744" : "#2b2833",
    }), o("eEFf")));
  }
  throw new Error(type);
}

// ---------------------------------------------------------------- effects
/** Banded radial glow (pixel-art style: a few hard alpha steps rather than a smooth falloff) */
export function glow(radius, color, strong = false) {
  const s = radius * 2 + 1, c = new OffscreenCanvas(s, s), g = c.getContext("2d");
  const bands = strong ? [[1, 0.35], [0.72, 0.6], [0.45, 0.85], [0.22, 1]] : [[1, 0.1], [0.7, 0.18], [0.45, 0.3], [0.22, 0.45]];
  g.fillStyle = color;
  for (const [k, a] of bands) {
    g.globalAlpha = a;
    const r = radius * k;
    for (let y = -Math.floor(r); y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      g.fillRect(radius - half, radius + y, half * 2 + 1, 1);
    }
  }
  return c;
}

export function salvageFrames() {
  const p = { o: "#1d4a33", 1: "#3f9a62", 2: "#9df0b5", 3: "#e8fff0" };
  return [
    build(["..o..", ".o2o.", "o232o", ".o1o.", "..o.."], p),
    build(["..o..", ".o3o.", "o222o", ".o1o.", "..o.."], p),
    build(["..o..", ".o2o.", "o223o", ".o1o.", "..o.."], p),
  ];
}
export function bigSalvageFrames() {
  const p = { o: "#1d4a33", 1: "#3f9a62", 2: "#9df0b5", 3: "#e8fff0" };
  const base = ["...o...", "..o3o..", ".o232o.", "o22222o", ".o121o.", "..o1o..", "...o..."];
  return [0, 1, 2].map((k) => build(base.map((r, y) => (y === 2 + k ? r.replace(/2/, "3") : r)), p));
}

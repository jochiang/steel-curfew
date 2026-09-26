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

function palOf(ramp, extra = {}) {
  const r = RAMPS[ramp];
  return { o: OUTLINE, 1: r[0], 2: r[1], 3: r[2], 4: r[3], 5: r[4], ...extra };
}

const pal = palOf;
export function build(rows, palette, { sym = false, light = false, patch = [], only = null, edge = null } = {}) {
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
  const empty = (x, y) => y < 0 || y >= h || x < 0 || x >= (grid[y]?.length ?? 0) || grid[y][x] === "." || grid[y][x] === " ";
  grid.forEach((r, y) => r.forEach((ch, x) => {
    if (ch === "." || ch === " " || (only && !only.includes(ch))) return;
    // edge: recolour only outline pixels on the silhouette's rim (elite trim)
    const col = edge && ch === "o" && (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1)) ? edge : palette[ch];
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

// ---------------------------------------------------------------- player mechs
// Each chassis: a mirrored torso (left half incl. centre column), a leg (drawn left, mirrored for
// the right), a foot, and where they sit. Shoulder pods are the weapon mounts; `v` are heat
// grilles, `b`/`c` the visor, `q`/`Q` capacitor coils (Tempest). `lift` drops a shin row so the
// foot rises for the walk cycle.
import { VIEWS, POSES } from "./mechviews.js";

const MECHS = {
  kestrel: {   // light scout: slim frame, small shoulder pods, antenna, reverse-joint legs
    w: 17, ramp: "sand", visor: ["#8a6a1e", "#e8c547", "#fff2b0"], glint: [[7, 2]], stripe: "#d97757",
    torso: [
      "........o",
      ".......o4",
      "......o44",
      "......oab",
      "..ooo.o22",
      ".o553oo43",
      ".o4s2o433",
      ".oooo.o32",
      "..o2o.o2v",
      "..o1o.o21",
      "..o3o..o2",
      "..ooo..oo",
    ],
    leg: { x: 4, w: 4, rows: [".o2o", "o21o", "o1o.", "o2o.", ".o2o", ".o2o"], lift: 3 },
    foot: { rows: ["ooooo", "o221o", "ooooo"], out: 1 },
    legY: 11,
  },
  warden: {   // medium: a balanced soldier
    w: 21, ramp: "steel", visor: ["#8f3e2c", "#d97757", "#ffc2a6"], glint: [[9, 2]], stripe: "#d97757",
    torso: [
      "........ooo",
      ".......o444",
      ".......o3ab",
      ".oooo..o222",
      "o5554ooo433",
      "o4443o44333",
      "o3332o43o33",
      "osss2o32o22",
      ".oooo.o2o22",
      ".o32o.o2vvv",
      ".o21o.o21o1",
      ".o32o..o222",
      ".o43o..o111",
      ".o21o...o11",
      ".oooo...ooo",
    ],
    leg: { x: 6, w: 4, rows: ["o22o", "o21o", "o43o", "o32o", "o21o", "o21o"], lift: 3 },
    foot: { rows: ["oooooo", "o3322o", "oooooo"], out: 1 },
    legY: 14,
  },
  bulwark: {   // heavy brawler: huge pauldrons, head sunk between them, stompy legs
    w: 25, ramp: "olive", visor: ["#3e5a1e", "#9acd5a", "#e4ffb8"], glint: [[11, 3]], stripe: "#e0a93b",
    torso: [
      "..........ooo",
      ".........o455",
      "..ooooooo4333",
      ".o5555554oabb",
      "o44444443o222",
      "o33333332o433",
      "ossssss21o433",
      ".o2222211o3o3",
      "..ooooooo3o2o",
      "..o332o.o32vv",
      ".o4432o.o2111",
      ".o3321o..o222",
      ".o5543o..o111",
      ".o3322o...o11",
      ".oooooo...ooo",
    ],
    leg: { x: 7, w: 5, rows: ["o222o", "o211o", "o443o", "o322o", "o211o"], lift: 2 },
    foot: { rows: ["ooooooo", "o33223o", "ooooooo"], out: 1 },
    legY: 14,
  },
  tempest: {   // assault energy platform: capacitor coils rising behind the shoulders
    w: 23, ramp: "navy", visor: ["#1e5a73", "#6fd8ff", "#dff8ff"], glint: [[10, 3]], stripe: "#6fd8ff",
    torso: [
      "..ooo.......",
      "..oqo.....oo",
      "..oQo....o44",
      "..oqo....oab",
      ".ooqoooo.o22",
      "o5554443oo43",
      "o4443332o433",
      "o3332221o3o3",
      "osss2111o2o2",
      ".oooooooo2vv",
      "..o32o..o211",
      "..o21o...o22",
      "..o43o...o11",
      "..o21o...o11",
      "..oooo...ooo",
    ],
    leg: { x: 6, w: 4, rows: ["o22o", "o21o", "o43o", "o32o", "o22o", "o21o"], lift: 3 },
    foot: { rows: ["oooooo", "o3322o", "oooooo"], out: 1 },
    legY: 14,
  },
};
RAMPS.steelRust = ["#2a2426", "#4f4446", "#7a6a64", "#a8927e", "#d8c4a8"];
RAMPS.teal = ["#12302e", "#235a55", "#3a8a80", "#6fbfb0", "#bfeee0"];
RAMPS.sand = ["#3a3426", "#6a5e44", "#9c8c68", "#c8b890", "#ece0c0"];
RAMPS.olive = ["#262a20", "#454c36", "#6a7552", "#96a278", "#cad4a8"];
RAMPS.navy = ["#1c2230", "#333d55", "#56647f", "#8494b0", "#c0cce0"];

function legsRows(spec, W, liftL, liftR) {
  const { leg, foot } = spec, rows = leg.rows.length + foot.rows.length;
  const out = Array.from({ length: rows }, () => Array(W).fill("."));
  const put = (x, y, str) => [...str].forEach((ch, i) => { if (ch !== "." && x + i >= 0 && x + i < W) out[y][x + i] = ch; });
  const mirror = (str) => [...str].reverse().join("").replace(/3/g, "2");
  const rx = W - leg.x - leg.w;   // right leg mirrors the left about the centre
  for (const [right, lift] of [[false, liftL], [true, liftR]]) {
    const shin = leg.rows.filter((_, i) => !(lift && i === leg.lift));
    const lx = right ? rx : leg.x, fx = right ? rx : leg.x - foot.out;
    shin.forEach((str, y) => put(lx, y, right ? mirror(str) : str));
    foot.rows.forEach((str, y) => put(fx, shin.length + y, right ? mirror(str) : str));
  }
  return out.map((r) => r.join(""));
}

/** Chassis frames: [plant, left up, plant (bob), right up]. With glow, only the self-lit pixels
 *  (visor, coils, and hot grilles) for the night light map. */
export function mechFrames(kind, hot, ventPhase = 0, glow = false) {
  const m = MECHS[kind] || MECHS.warden;
  const vent = hot ? (ventPhase ? "#ffd27a" : "#ff8a4c") : "#20242c";
  const p = pal(hot ? "hot" : m.ramp, { v: vent, a: m.visor[0], b: m.visor[1], c: m.visor[2], q: "#4fb6de", Q: "#bff4ff", s: hot ? "#ffb08f" : m.stripe });
  const only = glow ? (hot ? "bcvqQ" : "bcqQ") : null;
  const torso = build(m.torso, p, { sym: true, light: true, patch: m.glint.map(([x, y]) => [x, y, "c"]), only });
  const H = m.legY + m.leg.rows.length + m.foot.rows.length + 1;
  const cycle = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]];
  return cycle.map(([l, r, bob]) => {
    const c = new OffscreenCanvas(m.w, H), g = c.getContext("2d");
    const legs = legsRows(m, m.w, l, r);
    if (!glow) g.drawImage(build(legs, p), 0, H - 1 - legs.length);
    g.drawImage(torso, 0, bob + (H - 1 - legs.length - m.legY));
    return c;
  });
}
export const MECH_KINDS = Object.keys(MECHS);

/** Parts for directional drawing (the torso turns to the aim, the legs to the movement):
 *  torso: { front, back, side } (side faces right; mirror it for left)
 *  legs: { front: [4 walk frames], side: [4 stride frames] }
 *  legY: where the legs join the torso; torsoH/legsH: heights. glow: self-lit pixels only. */
export function mechParts(kind, hot, ventPhase = 0, glow = false) {
  const m = MECHS[kind] || MECHS.warden;
  const vent = hot ? (ventPhase ? "#ffd27a" : "#ff8a4c") : "#20242c";
  const p = pal(hot ? "hot" : m.ramp, { v: vent, a: m.visor[0], b: m.visor[1], c: m.visor[2], q: "#4fb6de", Q: "#bff4ff", s: hot ? "#ffb08f" : m.stripe });
  const only = glow ? (hot ? "bcvqQ" : "bcqQ") : null;
  const front = build(m.torso, p, { sym: true, light: true, patch: m.glint.map(([x, y]) => [x, y, "c"]), only });
  const v = VIEWS[kind] || VIEWS.warden, legsH = m.leg.rows.length + m.foot.rows.length;
  const back = build(v.back, p, { sym: true, light: true, only: glow ? (hot ? "vqQ" : "qQ") : null });
  const side = layered(v.side, m.w, m.torso.length, p, only);
  const legsFront = [[0, 0], [1, 0], [0, 0], [0, 1]].map(([l, r]) => (glow ? blank(m.w, 1) : build(legsRows(m, m.w, l, r), p)));
  const legsSide = POSES.map((pose) => (glow ? blank(m.w, 1) : strideLegs(v.legs, pose, m.w, legsH, p)));
  return { torso: { front, back, side }, legs: { front: legsFront, side: legsSide }, legY: m.legY, w: m.w, legsH };
}
const blank = (w, h) => new OffscreenCanvas(w, h);

/** Side view from parts drawn in order: [[name, x, y, rows], ...] */
function layered(parts, W, H, p, only) {
  const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
  for (const [, x, y, rows] of parts) g.drawImage(build(rows, p, { only }), x, y);
  return c;
}

/** One side-view stride frame: far leg (darker) then near leg, each thigh → shin → foot, sheared by
 *  the pose. A lifted leg loses a shin row, so its foot comes off the ground. */
function strideLegs(L, pose, W, H, p) {
  const c = new OffscreenCanvas(W, H), g = c.getContext("2d");
  const darker = { ...p, 5: p[3], 4: p[2], 3: p[2], 2: p[1], 1: p[1] };
  const sheared = (rows, x, y, dx, pal) => rows.forEach((r, i) => {
    g.drawImage(build([r], pal), x + Math.round((dx * i) / Math.max(1, rows.length - 1)), y + i);
  });
  pose.forEach(([tdx, sdx, lift], near) => {
    const pal = near ? p : darker, hx = L.hip[near];
    const shin = lift ? L.shin.filter((_, i) => i !== 2) : L.shin;
    const kx = hx + tdx, ky = L.thigh.length - 1, fy = ky + shin.length - 1;
    sheared(L.thigh, hx, 0, tdx, pal);
    g.drawImage(build(L.foot, pal), kx + sdx - 1, fy);
    sheared(shin, kx, ky, sdx, pal);
  });
  return c;
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

const MORTAR = [
  "......o",
  ".....o4",
  ".....o3",
  "...ooo3",
  "..o4443",
  ".o44333",
  "o433oEo",
  "o32oooo",
  "o222222",
  ".o2o11o",
  "oo.oo.o",
];
const SAPPER = [
  ["......", ".....L", "...ooo", "..oyky", ".oykyk", "oykyky", "okykyk", ".okyky", "..oooo", "..o..o"],
  ["......", ".....l", "...ooo", "..oyky", ".oykyk", "oykyky", "okykyk", ".okyky", "..oooo", "...o.o"],
];
const WASP = [
  ["w.....", "ww..oo", ".wwo43", "..o43E", "...o22", "....o1", "......"],
  ["......", "....oo", "...o43", "wwo43E", "www.22", "w...o1", "......"],
];
// Siege Walker (boss): four-legged artillery platform with a big mortar on its back
const SIEGE = [
  "..............o",
  ".............o4",
  ".............o3",
  "............oo3",
  "..........ooo43",
  "......oooo44443",
  ".....o455555533",
  "....o4443333333",
  "...o44ooooooooo",
  "...o43oeEEeoooo",
  "...o43ooooooooo",
  "...o43333333332",
  "ooo.o3322222222",
  "o4o.o2222111111",
  "o3o..oooooooooo",
  "o3o...o21o...o2",
  "o2o...o21o...o2",
  "ooo..oo11oo..o1",
  ".....oooooo..oo",
];

const EYE = { e: "#ff6a3c", E: "#ffe8b8" };

/** Enemy frames. With glow, only the self-lit pixels (eyes, lens, acid sac, furnace). Elites get
 *  a gold outline. */
export function enemyFrames(type, glow = false, elite = false) {
  const o = (only) => ({ sym: true, light: true, only: glow ? only : null, edge: elite ? "#e8c547" : null });
  const pal = (ramp, extra) => palOf(ramp, extra);
  switch (type) {
    case "mortar": return [build(MORTAR, pal("steelRust", EYE), o("eE"))];
    case "sapper": return SAPPER.map((f, k) => build(f, pal("amber", { y: "#e8c547", k: "#2a2620", L: "#ff3b2e", l: "#6a1a14" }), o(k ? "" : "L")));
    case "wasp": return WASP.map((f) => build(f, pal("teal", { w: "#bfe8e8", E: "#fff4c2" }), o("E")));
    case "siege": return [0, 1].map((k) => build(SIEGE, pal("steelRust", { ...EYE, E: k ? "#fff0c0" : "#ffb070" }), o("eE")));
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

// ---------------------------------------------------------------- atmosphere
/** Tileable fog: fractal value noise, quantized to a few faint alpha steps with 4x4 ordered
 *  dithering so it reads as pixel art. size must be a power of two. */
export function fogTexture(color, size = 256, seed = 7, maxAlpha = 0.12) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const octave = (cells) => {
    const lat = Array.from({ length: cells * cells }, rnd), at = (x, y) => lat[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    const sm = (t) => t * t * (3 - 2 * t);
    return (px, py) => {
      const fx = (px / size) * cells, fy = (py / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx, b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      return a + (b - a) * ty;
    };
  };
  const oct = [[octave(4), 0.55], [octave(8), 0.28], [octave(16), 0.17]];
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const c = new OffscreenCanvas(size, size), g = c.getContext("2d"), img = g.createImageData(size, size);
  const r = parseInt(color.slice(1, 3), 16), gr = parseInt(color.slice(3, 5), 16), bl = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let n = 0;
    for (const [f, w] of oct) n += f(x, y) * w;
    let v = Math.max(0, Math.min(1, (n - 0.42) / 0.3));           // only the denser wisps show
    v = v * 3 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;  // dither between 4 steps
    const step = Math.max(0, Math.min(3, Math.round(v)));
    const i = (y * size + x) * 4;
    img.data[i] = r; img.data[i + 1] = gr; img.data[i + 2] = bl; img.data[i + 3] = Math.round((step / 3) * maxAlpha * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- weapons (mounted on the shoulders)
// Drawn pointing right with the mount at the left edge, middle row; the renderer rotates them to
// the aim. Chainblade has 2 frames (teeth crawl); pyre has a pilot-light flicker frame.
const WEAPON_ART = {
  autocannon: [["oooooooo.", "o44333ooo", "o3222yyyo", "oooooooo."]],
  flak:       [["ooooooo", "o433oyo", "o322oyo", "o322oyo", "ooooooo"]],
  missiles:   [["oooooo", "o3kk3o", "o3kk3o", "o2kk2o", "o2kk2o", "oooooo"]],
  lance:      [["ooooooooooo", "o43qQqQqQco", "ooooooooooo"]],
  nova:       [[".oooo.", "o4qq3o", "oqQQqo", "oqQQqo", "o3qq2o", ".oooo."]],
  arc:        [["ooooooo..", "o43qQqoo.", "o32QcQqQo", "o43qQqoo.", "ooooooo.."]],
  rail:       [["oooooooooooo", "o44vvvvvvvvo", "o21ooooooooo", "o33vvvvvvvvo", "oooooooooooo"]],
  fist:       [["oooo...", "o33oooo", "o3344o5", "o3233o4", "o2222oo", "oooooo."]],
  chainblade: [["oooooooooooo.", "o32tTtTtTtTto", "oooooooooooo."], ["oooooooooooo.", "o32TtTtTtTtTo", "oooooooooooo."]],
  rotary:     [["ooooooooooo", "o43o4o4o4oo", "o322222222y", "o43o3o3o3oo", "ooooooooooo"], ["ooooooooooo", "o4o4o4o4ooo", "o32222222yy", "o4o3o3o3ooo", "ooooooooooo"]],
  pyre:       [["oooo....", "orrooooo", "orr3322f", "oooooooo"], ["oooo....", "orrooooo", "orr3322F", "oooooooo"]],
};
export function weaponSprites() {
  const p = palOf("steel", { y: "#ffd36b", k: "#15131b", q: "#4fb6de", Q: "#bff4ff", c: "#ffffff", v: "#a67cff", t: "#8a8f99", T: "#e6edf3", r: "#9e2f34", f: "#ff9a4c", F: "#fff1b0" });
  const out = {};
  for (const [k, frames] of Object.entries(WEAPON_ART)) out[k] = frames.map((rows) => build(rows, p));
  return out;
}

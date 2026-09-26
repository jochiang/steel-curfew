import { ARENA, ENEMIES, WEAPONS, FLY_ALT } from "./content.js";
import { weaponsOffline, mountPoint, darkness, rainAt } from "./game.js";
import { STICK_RADIUS } from "./input.js";
import { mechFrames, mechParts, enemyFrames, flash, glow, salvageFrames, bigSalvageFrames, fogTexture, weaponSprites, OUTLINE } from "./art.js";
import { TILE, COLS, wallHeight } from "./city.js";
import { paintGround, paintBuilding, paintRubble, propSprites, NEON } from "./cityart.js";

// The world is drawn into a small buffer (about 180 game px on the short side by default) and blown up by an
// integer factor, so pixels stay square. The camera moves smoothly: the buffer is drawn one pixel
// oversized and the fractional camera offset is applied at blit time. Text and the touch stick are
// drawn afterwards at native resolution.
//
// Draw order: floor (+ scorch decals) -> floor lights (additive) -> telegraphs, salvage, shadows ->
// bodies sorted by y -> projectiles and effects -> bloom (additive) -> vignette -> blit -> text/UI.

// View size in game px along the screen's short side, per zoom setting. Scale is a whole number
// of screen pixels per game pixel, so the art stays crisp; each setting is a distinct step.
export const ZOOMS = { close: 150, normal: 180, wide: 210 };
const SHOT_H = 4, BOLT_H = 5;   // projectiles fly at barrel height: drawn this far above their ground position
const C = {
  void: "#0c0d12", energy: "#8fe3ff", ballistic: "#ffd36b", danger: "#ff5b4a", melee: "#f5e6da",
};

// ---------------------------------------------------------------- pixel helpers
function circlePx(g, cx, cy, r, from = 0, to = Math.PI * 2) {
  const steps = Math.max(12, Math.ceil(r * (to - from) * 1.2));
  let lx = NaN, ly = NaN;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (x !== lx || y !== ly) { g.fillRect(x, y, 1, 1); lx = x; ly = y; }
  }
}
function discPx(g, cx, cy, r) {
  for (let y = -Math.floor(r); y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    g.fillRect(cx - half, cy + y, half * 2 + 1, 1);
  }
}
// a muzzle-flash spike: white at the root, then yellow, then an orange tip (w = 2 doubles the root)
let spikeG = null;
function spikeOn(g) { spikeG = g; }
function spike(x, y, a, len, w = 1) {
  const g = spikeG, ca = Math.cos(a), sa = Math.sin(a);
  for (let s = 0; s <= len; s++) {
    const f = s / Math.max(1, len), px = Math.round(x + ca * s), py = Math.round(y + sa * s);
    g.fillStyle = f < 0.4 ? "#ffffff" : f < 0.75 ? "#ffe08a" : "#ff9a3a";
    g.fillRect(px, py, 1, 1);
    if (w > 1 && f < 0.5) g.fillRect(px + Math.round(-sa), py + Math.round(ca), 1, 1);
  }
}
const mulberry = (seed) => { let t = (seed * 4294967296) >>> 0; return () => { t = (t + 0x6d2b79f5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; };

function linePx(g, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function shadowSprite(w) {
  const h = Math.max(2, Math.round(w / 4)), c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  g.fillStyle = "rgba(5,6,10,0.45)";
  for (let y = 0; y < h; y++) {
    const k = Math.sqrt(1 - ((y + 0.5 - h / 2) / (h / 2)) ** 2), half = Math.round((w / 2) * k);
    g.fillRect(w / 2 - half, y, half * 2, 1);
  }
  return c;
}

function vignette(w, h) {
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  for (let i = 0; i < 6; i++) {
    const k = i / 6;
    g.fillStyle = "rgba(4,5,8,0.07)";
    const mx = Math.round(w * 0.5 * (1 - k) * 0.35), my = Math.round(h * 0.5 * (1 - k) * 0.35);
    g.fillRect(0, 0, w, my); g.fillRect(0, h - my, w, my);
    g.fillRect(0, my, mx, h - 2 * my); g.fillRect(w - mx, my, mx, h - 2 * my);
  }
  return c;
}

// ---------------------------------------------------------------- renderer
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const buf = new OffscreenCanvas(8, 8), g = buf.getContext("2d");
  spikeOn(g);
  let floor = null, fg = null, floorCity = null;
  const bsprites = new Map();   // "id:stage" -> building sprite
  const props = propSprites();
  const smoke = [];             // renderer-only ambient smoke from wrecked buildings

  // player mech sprites per chassis, built on first use
  const mechSets = new Map();
  const mechSet = (kind) => {
    if (!mechSets.has(kind)) {
      const m = { cold: mechParts(kind, false), hotA: mechParts(kind, true, 0), hotB: mechParts(kind, true, 1) };
      const fl = (P) => ({ ...P, torso: Object.fromEntries(Object.entries(P.torso).map(([k, c]) => [k, flash(c)])), legs: Object.fromEntries(Object.entries(P.legs).map(([k, a]) => [k, a.map((c) => flash(c))])) });
      m.flash = fl(m.cold);
      m.xray = flash(mechFrames(kind, false)[0], "#7fd8ff");
      m.glow = { cold: mechParts(kind, false, 0, true), hotA: mechParts(kind, true, 0, true), hotB: mechParts(kind, true, 1, true) };
      mechSets.set(kind, m);
    }
    return mechSets.get(kind);
  };
  // sprites stand on the feet line 9px below the mech's centre
  const mechAt = (spr, X, Y, p) => [X(p.x) - (spr.width >> 1), Y(p.y) + 10 - spr.height];
  const enemies = {};
  for (const k of Object.keys(ENEMIES)) {
    const frames = enemyFrames(k);
    enemies[k] = { frames, elite: enemyFrames(k, false, true), flash: frames.map((f) => flash(f)), xray: frames.map((f) => flash(f, "#ff7a5c")), glow: enemyFrames(k, true).map((f) => flash(f)) };
  }
  const shadows = new Map();
  const shadow = (w) => { if (!shadows.has(w)) shadows.set(w, shadowSprite(w)); return shadows.get(w); };
  const salv = [salvageFrames(), bigSalvageFrames()];
  const glows = new Map();
  const glowOf = (r, col) => { const k = r + col; if (!glows.has(k)) glows.set(k, glow(r, col)); return glows.get(k); };
  const lightOf = (r, col) => { r = Math.max(2, Math.round(r)); const k = "L" + r + col; if (!glows.has(k)) glows.set(k, glow(r, col, true)); return glows.get(k); };
  const light = new OffscreenCanvas(8, 8), lg = light.getContext("2d");
  const flames = [];            // renderer-only fire particles on wrecked and fallen buildings
  const casings = [];           // spent brass: hops, bounces, then stays on the street
  const dusts = [];             // punch and shockwave dust puffs
  const wspr = weaponSprites();
  const wdim = Object.fromEntries(Object.entries(wspr).map(([k, fr]) => [k, fr.map((f) => flash(f, "#2a1c1a"))]));
  const burning = new Map();    // building id -> run.time when its rubble stops burning

  let S = 1, vw = 0, vh = 0, dpr = 1, vig = null, target = ZOOMS.normal;
  const cam = { x: ARENA.w / 2, y: ARENA.h / 2, init: false };

  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(innerWidth * dpr), bh = Math.round(innerHeight * dpr);
    canvas.width = bw; canvas.height = bh;
    S = Math.max(1, Math.round(Math.min(bw, bh) / target));
    vw = Math.ceil(bw / S); vh = Math.ceil(bh / S);
    buf.width = vw + 2; buf.height = vh + 2;
    light.width = buf.width; light.height = buf.height;
    vig = vignette(buf.width, buf.height);
  }
  resize();
  addEventListener("resize", resize);

  function updateCamera(run, dt) {
    const p = run.player, m = 28;
    const clampAxis = (v, view, size) => (view >= size + m * 2 ? size / 2 : Math.max(view / 2 - m, Math.min(size + m - view / 2, v)));
    const tx = clampAxis(p.x, vw, ARENA.w), ty = clampAxis(p.y, vh, ARENA.h);
    if (!cam.init) { cam.x = tx; cam.y = ty; cam.init = true; }
    const k = 1 - Math.exp(-9 * dt);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  }

  // the city's ground canvas: scorch marks and rubble are stamped into it and persist for the run
  function syncFloor(run) {
    const city = run.city;
    if (floorCity !== city) { floor = paintGround(city); fg = floor.getContext("2d"); floorCity = city; bsprites.clear(); smoke.length = 0; flames.length = 0; burning.clear(); }
    for (const f of run.fx) {
      if (f.stamped) continue;
      if (f.type === "collapse") { f.stamped = true; paintRubble(fg, city.buildings[f.bid]); burning.set(f.bid, run.time + 9); continue; }
      if (f.type !== "boom") continue;
      f.stamped = true;
      const r = f.r + 2, x = Math.round(f.x), y = Math.round(f.y);
      fg.fillStyle = "rgba(6,6,8,0.18)"; discPx(fg, x, y, r);
      fg.fillStyle = "rgba(6,6,8,0.16)"; discPx(fg, x, y, r * 0.55);
      fg.fillStyle = "rgba(60,40,30,0.5)";
      for (let i = 0; i < 4 + f.r; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * (r + 3);
        fg.fillRect(Math.round(f.x + Math.cos(a) * d), Math.round(f.y + Math.sin(a) * d), 1, 1);
      }
    }
  }

  const stageOf = (b) => (b.hp > b.maxHp * 0.66 ? 0 : b.hp > b.maxHp * 0.33 ? 1 : 2);
  function buildingSprite(b, stage, night) {
    const k = b.id + ":" + stage + (night ? "n" : "");
    if (!bsprites.has(k)) bsprites.set(k, paintBuilding(b, stage, night));
    return bsprites.get(k);
  }

  // Ambient light by darkness d (0 day .. 1 night): the colour the scene is multiplied by. Night has a
  // floor (~1/3 of day; user: "the game gets real abstract real fast" at ~1/8): lamps and neon still
  // pop, but the street, the mech and every enemy stay readable all the way past curfew.
  const AMBIENT = [[0, [255, 255, 255]], [0.3, [240, 216, 188]], [0.52, [204, 160, 146]], [0.76, [128, 122, 158]], [1, [80, 88, 122]]];
  function ambientAt(d) {
    let i = 0;
    while (i < AMBIENT.length - 2 && d > AMBIENT[i + 1][0]) i++;
    const [d0, c0] = AMBIENT[i], [d1, c1] = AMBIENT[i + 1], f = Math.max(0, Math.min(1, (d - d0) / (d1 - d0)));
    return "rgb(" + c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(",") + ")";
  }
  // things switch on at their own moment as it gets dark, staggered so a street doesn't blink on at once
  const onAt = (d, from, key) => d > from + (((key * 2654435761) >>> 0) % 1000) / 1000 * 0.1;

  // Drifting fog: two tiled layers blown across the city on a per-run wind. Drawn before the light
  // map, so at night it only shows where something lights it (haze around lamps, signs, beams).
  const FOG = {
    day: { color: "#c9d2dc", alpha: 0.13 },
    dusk: { color: "#e2c2b4", alpha: 0.15 },
    night: { color: "#b8c4dc", alpha: 0.22 },
  };
  const fogs = new Map();
  const fogOf = (tod, layer) => {
    const k = tod + layer;
    if (!fogs.has(k)) fogs.set(k, fogTexture(FOG[tod].color, 256, layer ? 91 : 7, FOG[tod].alpha * (layer ? 0.7 : 1)));
    return fogs.get(k);
  };
  // ---- weather (render-only; user: "lightning flashes could also help with the ambiance"). Rain
  // follows the dark (rainAt). Drops and splashes are drawn before the light map, so they show in
  // lamp light, headlights and muzzle flashes and fade to a faint sheen elsewhere. Heavy rain brings
  // lightning: a bolt, a half-second blue-white flicker over the whole city, and thunder a moment
  // later (sooner and louder when the strike is close). Everything stops while the run is frozen.
  const weather = { drops: [], splashes: [], next: 5, flash: 0, flashMax: 0.55, bolt: null, rain: 0, lastT: -1, wind: 0 };
  const mixRgb = (css, to, k) => { const c = css.match(/\d+/g).map(Number); return "rgb(" + c.map((v, i) => Math.round(v + (to[i] - v) * k)).join(",") + ")"; };
  function tickWeather(run, dt, d, left, top) {
    const W = weather, live = run.time !== W.lastT; W.lastT = run.time;
    W.rain = rainAt(d);
    W.wind = Math.cos((run.seed % 628) / 100) * 0.35;
    if (live) {
      const want = Math.round(200 * W.rain);
      while (W.drops.length < want) W.drops.push({ x: left + Math.random() * (vw + 20) - 10, y: top + Math.random() * (vh + 30) - 20, z: 0.7 + Math.random() * 0.6 });
      if (W.drops.length > want) W.drops.length = want;
      for (const q of W.drops) {
        q.y += 300 * q.z * dt; q.x += 300 * q.z * W.wind * dt;
        if (q.y > top + vh + 10 || Math.random() < dt * 1.5) {   // hits the street somewhere: splash, then back to the top
          if (q.y <= top + vh + 10) W.splashes.push({ x: q.x, y: q.y, t: 0.12 });
          q.y = top - 10 - Math.random() * 20; q.x = left + Math.random() * (vw + 20) - 10;
        }
        if (q.x < left - 12) q.x += vw + 24; else if (q.x > left + vw + 12) q.x -= vw + 24;   // stay with the camera
        if (q.y < top - 40) q.y += vh + 40;
      }
      for (const s of W.splashes) s.t -= dt;
      W.splashes = W.splashes.filter((s) => s.t > 0);
      if (W.flash > 0) W.flash = Math.max(0, W.flash - dt);
      if (W.bolt && (W.bolt.t -= dt) <= 0) W.bolt = null;
      if (W.rain > 0.4 && (W.next -= dt) <= 0) {
        W.next = 7 + Math.random() * 12;
        W.flash = W.flashMax;
        const near = Math.random();
        const bx = left + 20 + Math.random() * (vw - 40), by = top + vh * (0.25 + Math.random() * 0.6), pts = [[bx + (Math.random() - 0.5) * 40, top - 4]];
        while (pts[pts.length - 1][1] < by) { const [x, y] = pts[pts.length - 1]; pts.push([x + (bx - x) * 0.25 + (Math.random() - 0.5) * 14, Math.min(by, y + 6 + Math.random() * 10)]); }
        const fork = pts[Math.floor(pts.length * 0.45)], branch = [fork];
        for (let i = 0; i < 4; i++) { const [x, y] = branch[branch.length - 1]; branch.push([x + 5 + Math.random() * 8, y + 5 + Math.random() * 7]); }
        W.bolt = { pts, branch, t: 0.16, max: 0.16, x: bx, y: by };
        run.events.push({ type: "thunder", near, when: 0.3 + (1 - near) * 1.5 });
      }
    }
    // the flicker: bright, dip, bright again, then a fading glow
    const k = W.flash / W.flashMax, f = W.flash <= 0 ? 0 : k > 0.8 ? 1 : k > 0.66 ? 0.25 : k > 0.5 ? 0.9 : k * 0.9;
    return { flash: f };
  }
  function drawRain(X, Y) {
    const W = weather;
    if (!W.drops.length && !W.splashes.length) return;
    g.fillStyle = "#d4def2"; g.globalAlpha = 0.5;
    for (const q of W.drops) { const n = q.z > 1.05 ? 4 : 3; for (let i = 0; i < n; i++) g.fillRect(X(q.x - W.wind * (n - i) * 1.2), Y(q.y - (n - i) * 1.4), 1, 1); }
    g.globalAlpha = 0.6;
    for (const s of W.splashes) { const x = X(s.x), y = Y(s.y); g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1); if (s.t > 0.06) g.fillRect(x, y - 1, 1, 1); }
    g.globalAlpha = 1;
  }
  function drawLightning(X, Y) {
    const b = weather.bolt;
    if (!b) return;
    const k = b.t / b.max;
    g.globalCompositeOperation = "lighter";
    const gl = glowOf(10, "#3a4a8a");
    for (const [x, y] of b.pts) g.drawImage(gl, X(x) - 10, Y(y) - 10);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = k > 0.5 ? "#ffffff" : "#c8d4ff";
    for (const line of [b.pts, b.branch]) for (let i = 1; i < line.length; i++) linePx(g, X(line[i - 1][0]), Y(line[i - 1][1]), X(line[i][0]), Y(line[i][1]));
    if (k > 0.5) { g.fillStyle = "#ffffff"; g.fillRect(X(b.x) - 1, Y(b.y) - 1, 3, 3); }
  }

  function drawFog(run, left, top, t, d) {
    const a = ((run.seed % 628) / 100), wx = Math.cos(a), wy = Math.sin(a) * 0.5;
    // cross-fade between the day, dusk and night fogs as the light changes
    const mix = d <= 0.52 ? [["day", 1 - d / 0.52], ["dusk", d / 0.52]] : [["dusk", 1 - (d - 0.52) / 0.48], ["night", (d - 0.52) / 0.48]];
    for (const [tod, w] of mix) {
      if (w < 0.03) continue;
      g.globalAlpha = w;
      for (let layer = 0; layer < 2; layer++) {
        const tex = fogOf(tod, layer), sp = layer ? 11 : 6.5, par = layer ? 1.15 : 1;
        // world-anchored (with a little parallax on the top layer), drifting with the wind
        const ox = -(((left * par + wx * sp * t) % 256) + 256) % 256, oy = -(((top * par + wy * sp * t) % 256) + 256) % 256;
        for (let y = oy; y < buf.height; y += 256) for (let x = ox; x < buf.width; x += 256) g.drawImage(tex, Math.round(x), Math.round(y));
      }
    }
    g.globalAlpha = 1;
  }

  function draw(run, dt, input) {
    updateCamera(run, dt);
    syncFloor(run);
    const shake = run.shake > 0 ? run.shake : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    const left = cam.x - vw / 2 + sx, top = cam.y - vh / 2 + sy;
    const li = Math.floor(left), ti = Math.floor(top), fx = left - li, fy = top - ti;
    const ox = -li + 1, oy = -ti + 1;   // world -> buffer offset (integer)
    const X = (v) => Math.round(v + ox), Y = (v) => Math.round(v + oy);
    const t = run.time, p = run.player, city = run.city, d = darkness(run);
    const lit = d > 0.06, night = d > 0.5;   // lit: use the light map; night: windows and signs are on
    const storm = tickWeather(run, dt, d, left, top);   // rain + lightning (render-only)
    const lightsOn = lightsPower(run, d);
    const tod = { ambient: storm.flash > 0 ? mixRgb(ambientAt(d), [196, 206, 240], storm.flash * 0.85) : ambientAt(d), vig: 1, d };   // one vignette pass: a second one hid enemies coming in from the edges
    const inView = (x0, y0, x1, y1) => x1 >= left - 4 && x0 <= left + vw + 4 && y1 >= top - 4 && y0 <= top + vh + 4;

    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.imageSmoothingEnabled = false;
    g.fillStyle = C.void; g.fillRect(0, 0, buf.width, buf.height);
    for (const f of run.fx) {   // new brass and dust
      if (f.spawned) continue;
      if (f.type === "casing") {
        f.spawned = true;
        for (let k = 0; k < f.n; k++) {
          const side = Math.cos(f.a) >= 0 ? -1 : 1, sa = f.a + side * (Math.PI / 2 + (Math.random() - 0.5) * 0.8), v = 30 + Math.random() * 30;
          casings.push({ x: f.x, y: f.y, z: 5, vx: Math.cos(sa) * v - Math.cos(f.a) * 12, vy: Math.sin(sa) * v * 0.6, vz: 40 + Math.random() * 30, bounced: 0, spin: Math.random() * 4 });
        }
      } else if (f.type === "punch" || f.type === "dust") {
        f.spawned = true;
        const n = f.type === "punch" ? 8 : 16, r = f.type === "punch" ? 4 : f.r;
        for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + Math.random() * 0.4; dusts.push({ x: f.x + Math.cos(a) * r * 0.4, y: f.y + Math.sin(a) * r * 0.3, vx: Math.cos(a) * (18 + Math.random() * 22) * (f.type === "dust" ? 2 : 1), vy: Math.sin(a) * (10 + Math.random() * 12) * (f.type === "dust" ? 2 : 1), t: 0.55, max: 0.55 }); }
      }
    }
    g.drawImage(floor, ox, oy);
    drawSunShadows(city, d, ox, oy);

    // ---- daylight: a few soft floor glows (at night the light map does this job)
    if (!lit) {
      g.globalCompositeOperation = "lighter";
      if (lightsOn) { const rc = rockColor(run), st = LIGHT_STYLE[run.chassisKey] || LIGHT_STYLE.warden;   // rock lights, by day
        g.drawImage(glowOf(20, rc === st.rock ? st.day : rc === "#2a8ab0" ? "#0e3444" : "#3a0c06"), X(p.x) - 20, Y(p.y + 8) - 20); }
      for (const b of run.bolts) g.drawImage(glowOf(8, "#4a1c0c"), X(b.x) - 8, Y(b.y) - 8);
      for (const f of run.fx) {
        const k = f.t / f.max;
        if (f.type === "boom" && k > 0.4) { const r = Math.round(f.r * 3); g.drawImage(glowOf(r, "#5a2a0e"), X(f.x) - r, Y(f.y) - r); }
        if (f.type === "muzzle") { const r = f.key === "flak" ? 30 : 20; g.drawImage(glowOf(r, k > 0.45 ? "#6a4c14" : "#3a2a0c"), X(f.x) - r, Y(f.y) - r); }
      }
      g.globalCompositeOperation = "source-over";
    }

    // ---- brass on the street, dust
    for (let i = casings.length - 1; i >= 0; i--) {
      const c = casings[i];
      c.vz -= 260 * dt; c.z += c.vz * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.spin += dt * 20;
      if (c.z <= 0) {
        c.z = 0;
        if (c.bounced < 2) { c.vz = -c.vz * 0.35; c.vx *= 0.5; c.vy *= 0.5; c.bounced++; if (c.bounced === 1) run.events.push({ type: "casing" }); }
        else {   // settled: leave it on the street for the rest of the run
          fg.fillStyle = "#b8923e"; fg.fillRect(Math.round(c.x), Math.round(c.y), 1, 1);
          fg.fillStyle = "#6e5424"; fg.fillRect(Math.round(c.x) + (Math.cos(c.spin) > 0 ? 1 : -1), Math.round(c.y), 1, 1);
          casings.splice(i, 1); continue;
        }
      }
      g.fillStyle = "#e0b85a"; g.fillRect(X(c.x), Y(c.y - c.z), Math.sin(c.spin) > 0 ? 2 : 1, 1);
    }
    for (let i = dusts.length - 1; i >= 0; i--) {
      const q = dusts[i];
      q.t -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9;
      if (q.t <= 0) { dusts.splice(i, 1); continue; }
      const k = q.t / q.max, sz = Math.round(2 + (1 - k) * 3);
      g.globalAlpha = k * 0.5; g.fillStyle = "#8c867c"; g.fillRect(X(q.x) - (sz >> 1), Y(q.y) - (sz >> 1), sz, sz);
    }
    g.globalAlpha = 1;

    // ---- salvage
    for (const k of run.pickups) {
      const frames = salv[k.n >= 5 ? 1 : 0], f = frames[Math.floor(t * 8 + k.x) % frames.length];
      const bob = Math.sin(t * 5 + k.x * 0.7) > 0.2 ? 1 : 0;
      g.drawImage(f, X(k.x) - (f.width >> 1), Y(k.y) - (f.height >> 1) - bob);
    }

    // ---- shadows, then everything that stands up, sorted by its base line. Buildings are 3/4
    // view: the roof is drawn raised by the wall height, so tall blocks hide what's behind them.
    for (const e of run.enemies) {
      const w = e.d.r * 2 + (e.d.boss ? 2 : 0), s = shadow(w);
      g.drawImage(s, X(e.x) - (w >> 1), Y(e.y) + e.d.r - (s.height >> 1) + (e.type === "drone" ? 2 : 0));
    }
    for (const sh of run.shells) {   // an incoming shell's shadow grows as it drops
      const k = sh.t / sh.dur, w = Math.max(2, Math.round(2 + k * 6)), s = shadow(w);
      g.drawImage(s, X(sh.x0 + (sh.tx - sh.x0) * k) - (w >> 1), Y(sh.y0 + (sh.ty - sh.y0) * k));
    }
    for (const m of run.missiles) g.drawImage(shadow(3), X(m.x) - 1, Y(m.y));
    { const sw = run.chassis.radius * 2; g.drawImage(shadow(sw), X(p.x) - (sw >> 1), Y(p.y) + 8); }
    g.fillStyle = "rgba(5,6,10,0.4)";
    for (const b of run.bolts) g.fillRect(X(b.x) - 1, Y(b.y), 3, 1);
    for (const s of run.shots) g.fillRect(X(s.x), Y(s.y), 1, 1);

    const items = [], shown = [];
    for (const b of city.buildings) {
      if (b.dead) continue;
      const x0 = b.x * TILE, y1 = (b.y + b.h) * TILE;
      if (!inView(x0, b.y * TILE - wallHeight(b), x0 + b.w * TILE, y1)) continue;
      items.push([y1, 0, b]);
    }
    for (const f of run.fx) if (f.type === "collapse") { const b = city.buildings[f.bid]; items.push([(b.y + b.h) * TILE, 1, b, f]); }
    for (const pr of city.props) if (inView(pr.x - 8, pr.y - 14, pr.x + 8, pr.y + 8)) items.push([pr.y + 4, 2, pr]);
    for (const e of run.enemies) if (!e.d.flying) items.push([e.y + e.d.r * 0.5, 3, e]);
    items.push([p.y + 8, 4, p]);
    // projectiles sort in too, so a roof hides the ones flying behind it
    for (const b of run.bolts) items.push([b.y, 5, b]);
    for (const s of run.shots) if (!s.air) items.push([s.y, 6, s]);   // rounds at flyers go over the roofs (drawn below)
    items.sort((a, b) => a[0] - b[0]);
    for (const [, kind, o, f] of items) {
      if (kind === 0) {
        if (o.hit > 0) o.hit -= dt;
        const stage = stageOf(o), spr = buildingSprite(o, stage, night), jit = o.hit > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        const bx = X(o.x * TILE) + jit, by = Y(o.y * TILE - wallHeight(o));
        g.drawImage(spr, bx, by);
        shown.push([o, spr, bx, by]);
        if (o.burn > 0 && Math.random() < dt * o.w * o.h * 1.5) flame((o.x + 0.2 + Math.random() * (o.w - 0.4)) * TILE, (o.y + 0.3 + Math.random() * (o.h - 0.4)) * TILE - wallHeight(o));
        if (stage === 2) {
          if (Math.random() < dt * (1 + o.w * o.h * 0.3)) smoke.push({ x: (o.x + Math.random() * o.w) * TILE, y: (o.y + Math.random() * o.h) * TILE - wallHeight(o), t: 1.4, max: 1.4 });
          if (Math.random() < dt * o.w * o.h * 0.6) flame((o.x + 0.2 + Math.random() * (o.w - 0.4)) * TILE, (o.y + 0.2 + Math.random() * (o.h - 0.4)) * TILE - wallHeight(o));
        }
      } else if (kind === 1) {   // collapsing: the building sinks into its own dust
        const k = f.t / f.max, spr = buildingSprite(o, 2, night), Hw = wallHeight(o), sink = Math.round((1 - k) * (spr.height * 0.85));
        const jit = Math.random() < 0.5 ? -1 : 1;
        if (spr.height - sink > 0) g.drawImage(spr, 0, 0, spr.width, spr.height - sink, X(o.x * TILE) + jit, Y(o.y * TILE - Hw) + sink, spr.width, spr.height - sink);
      } else if (kind === 2) drawProp(o, X, Y);
      else if (kind === 3) drawEnemy(o, t, X, Y, false);
      else if (kind === 4) drawPlayer(run, X, Y);
      else if (kind === 5) drawBolt(o, t, X, Y);
      else drawShot(o, X, Y);
    }
    // airborne: flyers, missiles and shells are above the rooftops
    for (const e of run.enemies) if (e.d.flying) drawEnemy(e, t, X, Y, false, FLY_ALT);
    for (const s of run.shots) if (s.air) drawShot(s, X, Y);
    for (const m of run.missiles) {
      const x = X(m.x), y = Y(m.y - m.z), a = Math.atan2(m.vy, m.vx);
      g.fillStyle = OUTLINE; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = "#c9ced6"; g.fillRect(x, y, 1, 1);
      g.fillStyle = "#ffb347"; g.fillRect(X(m.x - Math.cos(a) * 2), Y(m.y - m.z - Math.sin(a) * 2), 1, 1);
    }
    for (const sh of run.shells) {
      const k = sh.t / sh.dur, x = X(sh.x0 + (sh.tx - sh.x0) * k), y = Y(sh.y0 + (sh.ty - sh.y0) * k - Math.sin(Math.PI * k) * 46);
      g.fillStyle = OUTLINE; g.fillRect(x - 2, y - 1, 5, 3); g.fillRect(x - 1, y - 2, 3, 5);
      g.fillStyle = "#6a5a4a"; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = Math.floor(t * 16) % 2 ? "#ffb347" : "#ff6a3c"; g.fillRect(x, y, 1, 1);
    }

    // fallen buildings smoulder for a while
    for (const [id, until] of burning) {
      if (t > until) { burning.delete(id); continue; }
      const b = city.buildings[id], heat = (until - t) / 9;
      if (Math.random() < dt * b.w * b.h * 1.2 * heat) flame((b.x + Math.random() * b.w) * TILE, (b.y + Math.random() * b.h) * TILE);
    }

    // ambient smoke from wrecks, and non-glowing particles (dust, steam), before the light map
    for (const q of smoke) { q.t -= dt; q.y -= 9 * dt; q.x += 3 * dt; }
    for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t <= 0) smoke.splice(i, 1);
    for (const q of smoke) {
      const k = q.t / q.max, sz = Math.round(2 + (1 - k) * 4);
      g.globalAlpha = k * 0.45; g.fillStyle = "#3a3836"; g.fillRect(X(q.x) - (sz >> 1), Y(q.y) - (sz >> 1), sz, sz);
    }
    for (const q of run.parts) {
      if (!q.steam) continue;
      const k = q.t / q.max, sz = Math.round(q.size + (1 - k) * 3);
      g.globalAlpha = k * 0.55; g.fillStyle = q.color; g.fillRect(X(q.x) - (sz >> 1), Y(q.y) - (sz >> 1), sz, sz);
    }
    g.globalAlpha = 1;

    drawFog(run, left, top, t, d);
    drawRain(X, Y);

    // ---- night / dusk: multiply the scene by a light map
    if (lit) {
      drawLightMap(run, tod, X, Y, t, shown, inView);
      g.globalCompositeOperation = "multiply";
      g.drawImage(light, 0, 0);
      g.globalCompositeOperation = "source-over";
    }

    // ---- everything below glows on its own, so it's drawn after the light map
    drawLightning(X, Y);
    // spawn telegraphs: a reticle that closes in
    for (const m of run.marks) {
      const k = 1 - m.t / m.max, big = m.type === "crusher", s = Math.round((big ? 14 : 7) * (1.6 - k * 0.8));
      const x = X(m.x), y = Y(m.y), blink = Math.floor(k * 12 * (1 + k)) % 2;
      g.fillStyle = blink ? "#ff8a70" : C.danger;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        g.fillRect(x + dx * s - (dx > 0 ? 2 : 0), y + dy * s, 3, 1);
        g.fillRect(x + dx * s, y + dy * s - (dy > 0 ? 2 : 0), 1, 3);
      }
      if (blink) g.fillRect(x, y, 1, 1);
    }
    // incoming shells: a ring where each will land, tightening as it drops
    for (const sh of run.shells) {
      const k = sh.t / sh.dur, x = X(sh.tx), y = Y(sh.ty);
      g.fillStyle = Math.floor(t * (6 + k * 18)) % 2 ? "#ff8a70" : C.danger;
      circlePx(g, x, y, sh.r);
      circlePx(g, x, y, Math.max(1, sh.r * (1 - k)));
    }

    // x-ray: units hidden behind a building are drawn again as faint silhouettes
    for (const e of run.enemies) if (!e.d.flying && occluded(city, e.x, e.y + e.d.r)) drawEnemy(e, t, X, Y, true);
    if (occluded(city, p.x, p.y + 8)) { const xr = mechSet(run.chassisKey).xray, [mx, my] = mechAt(xr, X, Y, p); g.globalAlpha = 0.6; g.drawImage(xr, mx, my); g.globalAlpha = 1; }

    // fire
    for (const q of flames) { q.t -= dt; q.y -= q.vy * dt; q.x += Math.sin(t * 7 + q.ph) * 4 * dt; }
    for (let i = flames.length - 1; i >= 0; i--) if (flames[i].t <= 0) flames.splice(i, 1);
    for (const q of flames) {
      const k = q.t / q.max;
      g.fillStyle = k > 0.75 ? "#fff1b0" : k > 0.5 ? "#ffb347" : k > 0.25 ? "#e8602c" : "#7a2a1c";
      const sz = k > 0.5 ? 2 : 1;
      g.fillRect(X(q.x), Y(q.y), sz, sz);
    }

    // enemy bolts hidden under a roof still show faintly (you should never be hit by something unseen)
    g.globalAlpha = 0.5;
    for (const b of run.bolts) if (occluded(city, b.x, b.y)) drawBolt(b, t, X, Y);
    g.globalAlpha = 1;

    // effects
    for (const f of run.fx) {
      const k = f.t / f.max;   // 1 -> 0
      if (f.type === "beam") {
        const nx = -(f.y2 - f.y1), ny = f.x2 - f.x1, nl = Math.hypot(nx, ny), w = Math.max(1, f.w * (0.35 + k * 0.65));
        for (let o = -w / 2; o <= w / 2; o += 0.5) {
          const inner = Math.abs(o) / (w / 2);
          g.fillStyle = inner < 0.3 ? "#ffffff" : inner < 0.7 ? "#bff4ff" : "#4fb6de";
          linePx(g, X(f.x1 + (nx / nl) * o), Y(f.y1 + (ny / nl) * o), X(f.x2 + (nx / nl) * o), Y(f.y2 + (ny / nl) * o));
        }
      } else if (f.type === "rail") {   // the slug's path, then a violet afterimage that thins out
        const nx = -(f.y2 - f.y1), ny = f.x2 - f.x1, nl = Math.hypot(nx, ny), w = k > 0.6 ? 4 : k > 0.35 ? 2 : 1;
        if (k < 0.35) g.globalAlpha = k / 0.35;
        for (let o = -w / 2; o <= w / 2; o += 0.5) {
          g.fillStyle = k > 0.35 && Math.abs(o) < 0.8 ? "#ffffff" : k > 0.35 ? "#b48cff" : "#7a4cdf";
          linePx(g, X(f.x1 + (nx / nl) * o), Y(f.y1 + (ny / nl) * o), X(f.x2 + (nx / nl) * o), Y(f.y2 + (ny / nl) * o));
        }
        g.globalAlpha = 1;
      } else if (f.type === "ring") {
        const r = f.r * (1 - k * k * 0.7);
        g.fillStyle = f.color;
        circlePx(g, X(f.x), Y(f.y), r);
        if (f.thick) {
          g.fillStyle = "#ffffff"; circlePx(g, X(f.x), Y(f.y), r - 1);
          g.fillStyle = f.color;
          if (k > 0.4) circlePx(g, X(f.x), Y(f.y), r - 2);
          if (k > 0.7) circlePx(g, X(f.x), Y(f.y), r - 4);
        }
      } else if (f.type === "swing") {
        const spread = f.arc * (1.2 - k * 0.2);
        g.fillStyle = f.heavy ? "#ffd9c7" : C.melee;
        circlePx(g, X(f.x), Y(f.y - 3), f.reach, f.a - spread / 2, f.a + spread / 2);
        g.fillStyle = "#ffffff";
        circlePx(g, X(f.x), Y(f.y - 3), f.reach - 1, f.a - spread / 2.6, f.a + spread / 2.6);
        if (f.heavy) circlePx(g, X(f.x), Y(f.y - 3), f.reach - 2, f.a - spread / 4, f.a + spread / 4);
      } else if (f.type === "muzzle") {
        // Verhoeven / Aliens: a jagged star that's different every shot (f.s), full on the first
        // frames and a smaller stutter after, so sustained fire strobes
        const x = X(f.x), y = Y(f.y), a = f.a ?? 0, flak = f.key === "flak";
        if (f.s == null) f.s = Math.random();
        const rs = mulberry(f.s), full = k > 0.45, sz = (flak ? 1.6 : 1) * (full ? 1 : 0.55);
        if (flak) for (let n = 0; n < 34; n++) {   // the fireball cone
          const d = Math.random() * 17 * k + 2, fa = a + (Math.random() - 0.5) * (0.5 + 0.6 * (1 - d / 19));
          g.fillStyle = d < 6 ? "#ffffff" : d < 11 ? "#fff1b0" : d < 15 ? "#ffb347" : "#e8602c";
          g.fillRect(Math.round(x + Math.cos(fa) * d), Math.round(y + Math.sin(fa) * d), d < 8 ? 2 : 1, d < 8 ? 2 : 1);
        }
        spike(x, y, a + (rs() - 0.5) * 0.25, (7 + rs() * 5) * sz, 2);              // the long tongue
        for (const side of [-1, 1]) {
          spike(x, y, a + side * (0.8 + rs() * 0.5), (4 + rs() * 3.5) * sz, 1);    // muzzle-brake vents
          if (rs() < 0.6) spike(x, y, a + side * (2.1 + rs() * 0.5), (2 + rs() * 2) * sz, 1);
        }
        const cr = full ? (flak ? 3 : 2) : 1;
        g.fillStyle = "#ffe08a"; g.fillRect(x - cr - 1, y - cr, cr * 2 + 3, cr * 2 + 1); g.fillRect(x - cr, y - cr - 1, cr * 2 + 1, cr * 2 + 3);
        g.fillStyle = "#ffffff"; g.fillRect(x - cr, y - cr, cr * 2 + 1, cr * 2 + 1);
      } else if (f.type === "impact") {
        const x = X(f.x), y = Y(f.y);
        g.fillStyle = "#ffffff"; g.fillRect(x - 1, y - 1, 3, 3);
        g.fillStyle = "#ffd36b"; g.fillRect(x - 2, y, 1, 1); g.fillRect(x + 2, y, 1, 1); g.fillRect(x, y - 2, 1, 1); g.fillRect(x, y + 2, 1, 1);
      } else if (f.type === "punch") {   // impact star + shockwave ring
        const e = 1 - k, x = X(f.x), y = Y(f.y - 3);
        if (e < 0.3) {
          g.fillStyle = "#ffffff";
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
            const len = (dx && dy ? 3 : 6) * (1 - e * 2);
            for (let s = 0; s < len; s++) g.fillRect(x + dx * s, y + dy * s, 1, 1);
          }
          g.fillStyle = "#ffe8b8"; g.fillRect(x - 2, y - 2, 5, 5);
        }
        g.fillStyle = e < 0.5 ? "#ffffff" : "#c9c0b0";
        circlePx(g, x, y, 4 + e * 16);
        if (e < 0.5) circlePx(g, x, y, 3 + e * 12);
      } else if (f.type === "launch") {   // missile back-blast puff
        const x = X(f.x - Math.cos(f.a) * 4), y = Y(f.y - Math.sin(f.a) * 4);
        g.globalAlpha = k; g.fillStyle = k > 0.6 ? "#fff1b0" : "#9a9590"; g.fillRect(x - 2, y - 2, 4, 4); g.globalAlpha = 1;
      } else if (f.type === "flare") {
        const x = X(f.x), y = Y(f.y), r = Math.round(2 + k * 6);
        g.fillStyle = f.color; discPx(g, x, y, r * 0.6);
        g.fillStyle = "#ffffff"; g.fillRect(x - r, y, r * 2 + 1, 1); g.fillRect(x, y - r, 1, r * 2 + 1);
      } else if (f.type === "boom") {
        if (!inView(f.x - 30, f.y - 30, f.x + 30, f.y + 30)) continue;
        const e = 1 - k, x = X(f.x), y = Y(f.y), r = f.r * (0.5 + e * 1.1);
        if (e < 0.18) { g.fillStyle = "#ffffff"; discPx(g, x, y, r); }
        else if (e < 0.45) {
          g.fillStyle = "#ff8a3c"; discPx(g, x, y, r);
          g.fillStyle = "#ffd27a"; discPx(g, x - 1, y - 1, r * 0.6);
        } else {
          // smoke: a dithered ring that thins out and drifts up
          g.fillStyle = d > 0.6 ? (e < 0.7 ? "#2a2226" : "#17151c") : e < 0.7 ? "#4a3a3a" : "#2a2530";
          const rr = Math.round(r);
          for (let yy = -rr; yy <= rr; yy++) for (let xx = -rr; xx <= rr; xx++) {
            const d = Math.hypot(xx, yy);
            if (d > rr || d < rr * (e - 0.3)) continue;
            if (((xx + yy + Math.floor(e * 10)) & 1) === 0 && Math.random() > e - 0.3) g.fillRect(x + xx, y + yy - Math.round(e * 3), 1, 1);
          }
        }
      }
    }
    // sparks and flames start white-hot and cool to their colour; kill shrapnel flashes hot, then shows its colour
    for (const q of run.parts) {
      if (q.steam) continue;
      const k = q.t / q.max;
      g.globalAlpha = Math.min(1, k * 2);
      g.fillStyle = (q.spark || q.fire) && k > 0.62 ? (q.energy ? "#f4ecff" : "#fffbe8") : q.shrapnel && k > 0.8 ? "#ffd9a0" : q.color;
      g.fillRect(X(q.x), Y(q.y), q.size, q.size);
      if ((q.spark || q.fire) && k > 0.35 && q.size < 2) { g.globalAlpha *= 0.5; g.fillRect(X(q.x) - 1, Y(q.y), 3, 1); g.fillRect(X(q.x), Y(q.y) - 1, 1, 3); }   // a soft cross while hot
    }
    g.globalAlpha = 1;

    drawCapacitor(run, X, Y);

    // ---- bloom
    g.globalCompositeOperation = "lighter";
    const bloom = 1 + 0.6 * d;
    let halos = 0;   // hot particles glow (capped: a big fire can throw a few hundred)
    for (const q of run.parts) {
      if (!(q.spark || q.fire) || q.t / q.max < 0.3 || ++halos > 220) continue;
      const r = q.fire ? 4 : 3;
      g.drawImage(glowOf(r, q.energy ? "#3a2466" : q.fire ? "#5a260a" : "#4a3a14"), X(q.x) - r, Y(q.y) - r);
    }
    for (const f of run.fx) {
      const k = f.t / f.max;
      if (f.type === "beam") {
        const n = Math.ceil(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 10), gl = glowOf(Math.round(9 * bloom), k > 0.5 ? "#1f5a73" : "#123846"), r = gl.width >> 1;
        for (let i = 0; i <= n; i++) g.drawImage(gl, X(f.x1 + ((f.x2 - f.x1) * i) / n) - r, Y(f.y1 + ((f.y2 - f.y1) * i) / n) - r);
      } else if (f.type === "rail") {
        const n = Math.ceil(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 12), gl = glowOf(Math.round(7 * bloom), k > 0.5 ? "#3a2466" : "#1e1438"), r = gl.width >> 1;
        for (let i = 0; i <= n; i++) g.drawImage(gl, X(f.x1 + ((f.x2 - f.x1) * i) / n) - r, Y(f.y1 + ((f.y2 - f.y1) * i) / n) - r);
      } else if (f.type === "muzzle") {
        const r = f.key === "flak" ? 22 : 13; g.drawImage(glowOf(r, k > 0.45 ? "#8a6420" : "#4a3410"), X(f.x) - r, Y(f.y) - r);
        if (f.key === "flak" && k > 0.6) { g.fillStyle = "rgba(255, 190, 110, 0.07)"; g.fillRect(0, 0, buf.width, buf.height); }   // the whole street flinches
      } else if (f.type === "punch" && k > 0.6) {
        g.drawImage(glowOf(10, "#4a4438"), X(f.x) - 10, Y(f.y - 3) - 10);
      } else if (f.type === "boom" && k > 0.55) {
        const r = Math.round(f.r * 1.8 * bloom); g.drawImage(glowOf(r, "#6a3410"), X(f.x) - r, Y(f.y) - r);
      } else if (f.type === "ring" && f.thick) {
        const r = Math.max(4, Math.round(f.r * (1 - k * k * 0.7)));
        g.drawImage(glowOf(r, "#0f2a36"), X(f.x) - r, Y(f.y) - r);
      }
    }
    for (const b of run.bolts) if (!occluded(city, b.x, b.y)) g.drawImage(glowOf(4, "#5a2410"), X(b.x) - 4, Y(b.y - BOLT_H) - 4);
    if (run.cap.charge >= 1 && run.cap.vent <= 0) {   // charged and holding: the mech hums
      const r = Math.floor(t * 8) % 2 ? 12 : 10;
      g.drawImage(glowOf(r, "#0f3346"), X(p.x) - r, Y(p.y) - 3 - r);
    }
    g.globalCompositeOperation = "source-over";
    for (let i = 0; i < tod.vig; i++) g.drawImage(vig, 0, 0);

    // ---- blit to screen
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, -(1 + fx) * S, -(1 + fy) * S, buf.width * S, buf.height * S);

    // ---- native-res layer
    const toScreen = (wx, wy) => [(wx - left) * S, (wy - top) * S];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const font = `700 ${Math.round(7 * S)}px "Pixelify Sans", ui-monospace, monospace`, bigFont = `700 ${Math.round(10 * S)}px "Pixelify Sans", ui-monospace, monospace`;
    for (const tx of run.texts) {
      const [x, y] = toScreen(tx.x, tx.y);
      const age = tx.max - tx.t, pop = tx.big ? 1 : age < 0.08 ? 1.45 - (age / 0.08) * 0.45 : 1;
      ctx.font = tx.big ? bigFont : pop > 1 ? `700 ${Math.round(7 * S * pop)}px "Pixelify Sans", ui-monospace, monospace` : font;
      ctx.globalAlpha = Math.min(1, (tx.t / tx.max) * 2);
      ctx.fillStyle = OUTLINE;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(tx.n, x + dx * S * 0.5, y + dy * S * 0.5);
      ctx.fillStyle = tx.big ? "#9fe8ff" : tx.n >= 40 ? C.energy : "#f4f1ea"; ctx.fillText(tx.n, x, y);
    }
    ctx.globalAlpha = 1;
    if (weather.flash > 0) { ctx.fillStyle = `rgba(210,220,255,${weather.flash * 0.22})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    if (run.flashT > 0) {   // boss lightning
      const k = run.flashT / 0.6, flick = k > 0.75 || (k > 0.45 && k < 0.6) ? 1 : 0.35;
      ctx.fillStyle = `rgba(225,232,255,${k * 0.55 * flick})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (p.hurt > 0) {
      const gr = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.35, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
      gr.addColorStop(0, "rgba(255,60,40,0)"); gr.addColorStop(1, `rgba(255,60,40,${(p.hurt / 0.3) * 0.35})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const st = input?.stick;
    if (st?.active) {
      const r = STICK_RADIUS * dpr;
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath(); ctx.arc(st.ox * dpr, st.oy * dpr, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath(); ctx.arc(st.x * dpr, st.y * dpr, r * 0.42, 0, Math.PI * 2); ctx.fill();
    }
  }

  function flame(x, y) {
    if (flames.length > 400) return;
    flames.push({ x: x + (Math.random() - 0.5) * 3, y, vy: 10 + Math.random() * 14, t: 0.35 + Math.random() * 0.4, max: 0.75, ph: Math.random() * 6 });
  }

  // A banded searchlight wedge into the light map (3 hard steps, so it stays pixel-art)
  function cone(x, y, a, R, spread, col) {
    const c = parseInt(col.slice(1), 16), step = (k) => "rgb(" + [c >> 16, (c >> 8) & 255, c & 255].map((v) => Math.round(v * k)).join(",") + ")";
    lg.save();
    lg.beginPath(); lg.moveTo(x, y); lg.arc(x, y, R, a - spread, a + spread); lg.closePath(); lg.clip();
    const grad = lg.createRadialGradient(x, y, 4, x, y, R);
    for (const [o, k] of [[0, 1], [0.35, 1], [0.35, 0.69], [0.65, 0.69], [0.65, 0.375], [1, 0.375]]) grad.addColorStop(o, step(k));
    lg.fillStyle = grad; lg.fillRect(x - R, y - R, R * 2, R * 2);
    lg.restore();
  }

  // ---- sun shadows. The camera looks down from the south, so shadows go south-east at noon (short:
  // the sun is high) and swing east as it sinks (long), then fade out as the lamps take over.
  // Each building's footprint is swept along the shadow into one layer, rebuilt only when the sun
  // moves a step or a building falls; drawn in one pass so overlapping shadows don't stack.
  const shade = { c: null, g: null, key: "" };
  const sunAt = (d) => { const u = Math.min(1, d / 0.7); return { a: 0.95 - 0.8 * u, len: 0.7 + 1.5 * u * u, alpha: 0.5 * (d < 0.55 ? 1 : Math.max(0, 1 - (d - 0.55) / 0.22)) }; };
  function drawSunShadows(city, d, ox, oy) {
    const sun = sunAt(d);
    if (sun.alpha <= 0.01) return;
    const qa = Math.round(sun.a * 30) / 30, ql = Math.round(sun.len * 12) / 12;
    let dead = 0; for (const b of city.buildings) if (b.dead) dead++;
    const key = qa + ":" + ql + ":" + dead + ":" + city.buildings.length;
    if (shade.key !== key) {
      if (!shade.c) { shade.c = new OffscreenCanvas(ARENA.w, ARENA.h); shade.g = shade.c.getContext("2d"); }
      const sg = shade.g; sg.clearRect(0, 0, ARENA.w, ARENA.h); sg.fillStyle = "#0b0f1c";
      const ca = Math.cos(qa), sa = Math.sin(qa);
      for (const b of city.buildings) {
        if (b.dead) continue;
        const H = wallHeight(b) * ql, dx = ca * H, dy = sa * H, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
        const x0 = b.x * TILE, y0 = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
        for (let i = 0; i <= n; i++) sg.fillRect(Math.round(x0 + (dx * i) / n), Math.round(y0 + (dy * i) / n), w, h);
      }
      shade.key = key;
    }
    g.globalAlpha = sun.alpha; g.drawImage(shade.c, ox, oy); g.globalAlpha = 1;
  }

  // ---- light packages (user: "a Jeep owner who has seen too many overlanding videos on Instagram and
  // has gone too hard on lights at Pep Boys", then "each mech has a distinctive lighting style"):
  //   Warden  - overlander: roof light bar with amber strobe ends, ditch-light pods, twin spears
  //   Kestrel - street tuner: halo headlights, neon underglow, one long narrow spot
  //   Bulwark - road crew: rotating amber beacon sweeping the street, a row of work lights, huge flood
  //   Tempest - gaming PC: a chest strip that fills with the capacitor, blue shoulder strobes, flood
  //             that brightens with the charge
  // Rock lights under the feet carry the state for every frame: its own colour normally, cyan when
  // the capacitor is charged and holding, blinking red while venting.
  // Returns sprite pixels (px, lit ones glow), point lights and cones, all in world coordinates.
  const LIGHT_STYLE = {
    warden: { rock: "#a0661c", day: "#3a2408" },
    kestrel: { rock: "#9a2a8a", day: "#360c30" },
    bulwark: { rock: "#9a7418", day: "#342606" },
    tempest: { rock: "#5a3aa8", day: "#1c1238" },
  };
  // The package stays off by day and powers up at dusk (user: "the lighting probably should only turn on
  // at dusk ... makes that first level in the dark more visually compelling"): a stutter, then solid,
  // with a relay clunk. A run that starts or resumes in the dark flickers on straight away.
  const LIGHTS_ON_AT = 0.52;   // wave 3 (the dusk wave) starts exactly here and wave 2 only reaches it as it ends, so the rigs power up as wave 3 begins
  const power = { run: null, on: false, since: 0, lit: false };
  function lightsPower(run, d) {
    if (power.run !== run) { power.run = run; power.on = false; }
    if (!(d > LIGHTS_ON_AT)) { power.on = false; return (power.lit = false); }
    if (!power.on) { power.on = true; power.since = run.time; run.events.push({ type: "lightsOn" }); }
    const age = run.time - power.since;
    return (power.lit = age > 0.55 || age < 0.07 || (age > 0.19 && age < 0.25) || (age > 0.36 && age < 0.44));   // on, off, on, off, on... solid
  }
  function rockColor(run) {
    if (run.cap.vent > 0) return Math.floor(run.time * 8) % 2 ? "#9a2410" : "#3a0c06";
    if (run.cap.charge >= 1 && run.weapons.some((w) => WEAPONS[w.key].family === "energy")) return "#2a8ab0";
    return (LIGHT_STYLE[run.chassisKey] || LIGHT_STYLE.warden).rock;
  }
  function mechLights(run, t) {
    const p = run.player, kind = run.chassisKey, P = mechSet(kind).cold, H = P.legY + P.legsH + 1, half = P.w >> 1;
    const fi = p.moving ? Math.floor(t * 9) % 4 : 0, top = p.y + 10 - H + (p.moving && fi === 2 ? 1 : 0);
    const face = p.facing || "down", front = face === "down", back = face === "up", side = !front && !back, dir = face === "left" ? -1 : 1;
    const px = [], lights = [], cones = [], a = p.aim, dot = (x, y, col, lit) => px.push({ x, y, col, lit });
    const venting = run.cap.vent > 0;
    if (kind === "kestrel") {
      const eyes = front ? [-2, 2] : side ? [dir * 2] : [];
      for (const ex of eyes) { dot(p.x + ex, top + 1, "#e0f8ff", true); dot(p.x + ex + (ex < 0 ? -1 : 1), top + 1, "#7fd8ff", true); }
      if (back) { dot(p.x - 2, top + 1, "#ff3a4a", true); dot(p.x + 2, top + 1, "#ff3a4a", true); }   // tail lights
      cones.push({ y: top + 1, a, R: 160, spread: 0.13, col: "#8ab0c8" });
      lights.push({ x: p.x, y: p.y + 8, r: 40, col: "#5a1a52" });   // the underglow spills wide
    } else if (kind === "bulwark") {
      const ba = t * 5, facing = Math.cos(ba) > 0;   // the beacon's mirror goes round
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) dot(p.x - 1 + dx, top - 3 + dy, facing ? "#ffc040" : "#8a5a10", facing);
      dot(p.x - 1, top - 1, "#16181e"); dot(p.x, top - 1, "#16181e");
      cones.push({ y: top - 2, a: ba, R: 110, spread: 0.3, col: "#a0600c" });   // sweeps the street all the way round
      if (!back) for (const wx of front ? [-(half - 1), -(half - 3), half - 3, half - 1] : [dir * (half - 1), dir * (half - 3)]) dot(p.x + wx, top + 2, "#fff4d0", true);
      cones.push({ y: top + 2, a, R: 104, spread: 1.15, col: "#7a7260" });
    } else if (kind === "tempest") {
      const n = 7, lit = venting ? n : Math.round(n * run.cap.charge), sx = front ? -3 : side ? (dir > 0 ? 0 : -6) : null;
      if (sx !== null) for (let i = 0; i < n; i++) dot(p.x + sx + i, top + 5, venting ? (Math.floor(t * 8) % 2 ? "#ff5a3c" : "#5a1a10") : i < lit ? "#bff4ff" : "#1a3a4a", venting || i < lit);
      const blue = Math.floor(t * 6) % 2;
      for (const s of front || back ? [-1, 1] : [dir]) { const on = (s < 0) === !!blue; dot(p.x + s * (half - 1), top + 1, on ? "#6ab4ff" : "#1a2a4a", on); if (on) lights.push({ x: p.x + s * (half - 1), y: top + 1, r: 22, col: "#1a3a8a" }); }
      const k = 0.5 + 0.5 * (venting ? 0 : run.cap.charge);
      cones.push({ y: top + 4, a, R: 100 + 30 * k, spread: 0.6, col: k > 0.9 ? "#6a8ab0" : "#4a5a7a" });
    } else {   // warden
      const strobe = Math.floor(t * 8) % 4;
      const span = front || back ? [-4, 4] : [-2, 3];
      for (let i = span[0]; i <= span[1]; i++) {
        const x = p.x + (side ? dir * i : i), end = side ? i === -2 : Math.abs(i) === 4;
        dot(x, top - 2, "#16181e");
        if (end) { const on = side ? strobe % 2 === 0 : strobe === (i < 0 ? 0 : 2); dot(x, top - 1, on ? "#ffb020" : "#6a4410", on); if (on) lights.push({ x, y: top - 1, r: 26, col: "#b06a10" }); }
        else dot(x, top - 1, back ? "#16181e" : "#ffffff", !back);
      }
      if (!back) for (const s of front ? [-1, 1] : [dir]) dot(p.x + s * (half - 1), top + 3, "#fff6d6", true);
      cones.push({ y: top - 1, a, R: 116, spread: 0.78, col: "#6a665a" });
      for (const s of [-1, 1]) cones.push({ y: top + 3, a: a + s * 0.62, R: 108, spread: 0.12, col: "#8a8474" });
    }
    const rc = rockColor(run);
    lights.push({ x: p.x, y: p.y + 8, r: 30, col: rc }, { x: p.x, y: p.y + 8, r: 14, col: rc });
    return { px, lights, cones };
  }

  // The light map: ambient colour, plus every light source added on top. The scene is multiplied
  // by it, so white = full brightness. Self-lit pixels (windows, eyes, visor) are painted white.
  function drawLightMap(run, tod, X, Y, t, shown, inView) {
    const p = run.player, city = run.city;
    lg.globalCompositeOperation = "source-over";
    lg.fillStyle = tod.ambient; lg.fillRect(0, 0, light.width, light.height);
    lg.globalCompositeOperation = "lighter";
    const put = (r, col, x, y) => { const s = lightOf(r, col); lg.drawImage(s, X(x) - (s.width >> 1), Y(y) - (s.height >> 1)); };

    // the mech: a halo, and a searchlight that tracks what it's aiming at
    const venting = run.cap.vent > 0;
    put(26, venting ? "#5a2a1a" : "#2c3550", p.x, p.y);
    if (power.lit) {
      cone(X(p.x), Y(p.y - 4), p.aim, 124, 0.42, "#f2e8d0");   // the searchlight, with a hot core down the middle
      cone(X(p.x), Y(p.y - 4), p.aim, 84, 0.17, "#7a7058");
    }
    if (weather.bolt) put(70, "#7a8ad0", weather.bolt.x, weather.bolt.y);   // the strike lights up the block it hits
    if (power.lit) {   // the frame's light package (see mechLights)
      const L = mechLights(run, t);
      for (const c of L.cones) cone(X(p.x), Y(c.y), c.a, c.R, c.spread, c.col);
      for (const l of L.lights) put(l.r, l.col, l.x, l.y);
      lg.fillStyle = "#ffffff";
      for (const q of L.px) if (q.lit) lg.fillRect(X(q.x), Y(q.y), 1, 1);
    }
    if (venting) put(14, "#7a3818", p.x, p.y - 4);

    // street lamps and parked cars with their lights on (each switches on at its own moment)
    const d = tod.d;
    for (const pr of city.props) {
      if (pr.broken || !inView(pr.x - 40, pr.y - 40, pr.x + 40, pr.y + 40)) continue;
      if (pr.type === "lamp" && onAt(d, 0.42, pr.x * 7 + pr.y)) {
        put(32, "#5a4c32", pr.x, pr.y + 4);
        put(14, "#3c3322", pr.x, pr.y + 2);
        put(4, "#ffffff", pr.x, pr.y - 9);
      } else if (pr.type === "car" && pr.lights && onAt(d, 0.58, pr.x + pr.y * 3)) {
        const fx = pr.dir ? pr.face : 0, fy = pr.dir ? 0 : pr.face;
        put(16, "#4a4632", pr.x + fx * 16, pr.y + fy * 16);
        put(3, "#ffffff", pr.x + fx * 5, pr.y + fy * 5);
        put(5, "#5a1010", pr.x - fx * 6, pr.y - fy * 6);
      }
    }
    // lit windows and neon signs, spilling onto the street in front
    for (const [b, spr, bx, by] of shown) {
      if (!spr.glow) continue;
      lg.drawImage(spr.glow, bx, by);
      const sx = (b.x + b.w / 2) * TILE, sy = (b.y + b.h) * TILE + 7;
      if (spr.lit) put(8 + b.w * 3 + spr.lit * 0.4, "#2c2618", sx, sy);
      if (b.neon && stageOf(b) < 2 && onAt(d, 0.44, b.id)) {
        const c = NEON[b.neon.color], dim = "#" + [1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.3).toString(16).padStart(2, "0")).join("");
        put(18, dim, b.x * TILE + 3 + b.neon.at * (b.w * TILE - 6), sy);
      }
    }
    // enemies: self-lit eyes (drawn white into the map) plus a faint coloured halo
    for (const e of run.enemies) {
      if (!inView(e.x - 20, e.y - 20, e.x + 20, e.y + 20)) continue;
      const set = enemies[e.type], n = set.glow.length;
      const fi = n > 1 ? Math.floor(t * (e.type === "skitter" ? 12 : 4) + e.ph * 10) % n : 0;
      const spr = set.glow[fi], bob = e.type === "drone" ? Math.round(Math.sin(t * 5 + e.ph * 6) * 1.2) - 1 : 0;
      lg.drawImage(spr, X(e.x) - (spr.width >> 1), Y(e.y) - (spr.height >> 1) + bob);
      put(e.d.boss ? 30 : e.type === "spitter" ? 12 : 7, e.type === "spitter" ? "#1f3a12" : "#3a1410", e.x, e.y);
    }
    // bosses bring their own light: the Siege Walker sweeps searchlights, the Crusher's headlights find you
    for (const e of run.enemies) {
      if (!e.d.boss) continue;
      if (e.type === "siege") {
        const a = t * 0.9 + e.ph * 6;
        cone(X(e.x), Y(e.y - 12), a, 130, 0.22, "#8a8470"); cone(X(e.x), Y(e.y - 12), a + Math.PI, 130, 0.22, "#8a8470");
        put(24, "#4a3a2a", e.x, e.y);
      } else {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        cone(X(e.x + Math.cos(a) * 10), Y(e.y + Math.sin(a) * 10), a - 0.15, 110, 0.18, "#9a8a60");
        cone(X(e.x + Math.cos(a) * 10), Y(e.y + Math.sin(a) * 10), a + 0.15, 110, 0.18, "#9a8a60");
        put(44 + Math.random() * 4, "#7a3410", e.x, e.y);
      }
    }
    // the mech's visor (and grilles when venting)
    const mg = mechSet(run.chassisKey).glow, gP = venting ? (Math.floor(t * 10) % 2 ? mg.hotA : mg.hotB) : mg.cold;
    composeMech(lg, gP, p, X, Y, p.moving ? Math.floor(t * 9) % 4 : 0, null);
    // salvage, bolts, shots
    for (const k of run.pickups) put(6, "#1d5a34", k.x, k.y);
    for (const b of run.bolts) { put(12, "#7a3010", b.x, b.y); lg.fillStyle = "#ffffff"; lg.fillRect(X(b.x) - 2, Y(b.y - BOLT_H) - 2, 5, 5); }
    for (const s of run.shots) { const sy = s.y - (s.h ?? SHOT_H); put(5, "#5a4818", s.x, sy); lg.fillStyle = "#ffffff"; lg.fillRect(X(s.x) - 2, Y(sy) - 2, 5, 5); }
    // fire
    for (const [id] of burning) { const b = city.buildings[id]; put(14 + b.w * 3 + Math.random() * 4, "#6a2c0c", (b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE); }
    for (const [b] of shown) if (stageOf(b) === 2) put(12 + b.w * 3 + Math.random() * 4, "#5a260a", (b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE - wallHeight(b));
    // hot particles light the street: binned into 12px cells, so a shower of sparks is a handful of lights
    const bins = new Map();
    const heat = (x, y, w, kind) => {
      const key = ((x / 12) | 0) + ((y / 12) | 0) * 1024, b = bins.get(key);
      if (b) { b.w += w; b.x += x * w; b.y += y * w; b[kind] += w; }
      else bins.set(key, { w, x: x * w, y: y * w, fire: kind === "fire" ? w : 0, spark: kind === "spark" ? w : 0, energy: kind === "energy" ? w : 0 });
    };
    for (const q of run.parts) if (q.spark || q.fire || q.shrapnel) heat(q.x, q.y, (q.t / q.max) * (q.fire ? 1 : q.shrapnel ? 0.35 : 0.6), q.energy ? "energy" : q.fire || q.shrapnel ? "fire" : "spark");
    for (const q of flames) heat(q.x, q.y, (q.t / q.max) * 0.7, "fire");
    for (const b of bins.values()) {
      const x = b.x / b.w, y = b.y / b.w;
      if (b.w < 0.15 || !inView(x - 40, y - 40, x + 40, y + 40)) continue;
      put(Math.min(44, 7 + 8 * Math.sqrt(b.w)), b.energy > b.fire && b.energy > b.spark ? "#5a3a9a" : b.fire >= b.spark ? "#9a4a16" : "#8a7430", x, y);
    }
    // shells, missiles, fire
    for (const sh of run.shells) { const k = sh.t / sh.dur; put(8, "#7a3a10", sh.x0 + (sh.tx - sh.x0) * k, sh.y0 + (sh.ty - sh.y0) * k - Math.sin(Math.PI * k) * 46); put(sh.r + 4, "#3a0c08", sh.tx, sh.ty); }
    for (const m of run.missiles) put(8, "#7a4a18", m.x, m.y - m.z);
    for (const b of city.buildings) if (b.burn > 0 && !b.dead) put(14 + b.w * 3 + Math.random() * 4, "#6a2c0c", (b.x + b.w / 2) * TILE, (b.y + b.h / 2) * TILE - wallHeight(b));
    for (const e of run.enemies) if (e.burn > 0) put(10, "#5a2408", e.x, e.y);
    // weapon effects (only what's on screen)
    for (const f of run.fx) {
      if (f.x != null && !inView(f.x - 60, f.y - 60, f.x + 60, f.y + 60)) continue;
      const k = f.t / f.max;
      if (f.type === "flamecone") put(30, "#8a4412", f.x, f.y);
      else if (f.type === "rail") {
        const n = Math.ceil(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 10);
        for (let i = 0; i <= n; i++) put(18 * (0.5 + k * 0.5), "#5a3a9a", f.x1 + ((f.x2 - f.x1) * i) / n, f.y1 + ((f.y2 - f.y1) * i) / n);
      }
      if (f.type === "muzzle") put((f.key === "flak" ? 72 : 46) * (k > 0.45 ? 1 : 0.7), f.key === "flak" ? "#e8b060" : "#d0a050", f.x, f.y);
      else if (f.type === "impact") put(8, "#6a5a2a", f.x, f.y);
      else if (f.type === "punch") put(26 * k + 6, "#8a7a60", f.x, f.y);
      else if (f.type === "flare") put(30 * k + 6, "#6a4aa8", f.x, f.y);
      else if (f.type === "launch") put(12, "#7a5a28", f.x, f.y);
      else if (f.type === "boom") put(f.r * 5 * (0.4 + k), k > 0.5 ? "#b8601e" : "#6a2e10", f.x, f.y);
      else if (f.type === "beam") {
        const n = Math.ceil(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 8);
        for (let i = 0; i <= n; i++) put(22 * (0.5 + k * 0.5), "#3a8aae", f.x1 + ((f.x2 - f.x1) * i) / n, f.y1 + ((f.y2 - f.y1) * i) / n);
      } else if (f.type === "ring" && f.thick) put(f.r * (1.2 - k * 0.2), k > 0.5 ? "#2a6a8a" : "#143a4a", f.x, f.y);
      else if (f.type === "ring") put(f.r + 6, "#5a2012", f.x, f.y);
      else if (f.type === "swing") put(18, "#4a4440", f.x, f.y);
    }
  }

  function drawEnemy(e, t, X, Y, ghost, alt = 0) {
    const set = enemies[e.type], n = set.frames.length;
    const rate = e.fuse ? 22 : e.type === "skitter" || e.type === "wasp" ? 12 : 4;
    const fi = n > 1 ? Math.floor(t * rate + e.ph * 10) % n : 0;
    const spr = (ghost ? set.xray : e.flash > 0 ? set.flash : e.elite ? set.elite : set.frames)[fi];
    const bob = (e.type === "drone" ? Math.round(Math.sin(t * 5 + e.ph * 6) * 1.2) - 1 : 0) - alt + (alt ? Math.round(Math.sin(t * 7 + e.ph * 6)) : 0);
    if (ghost) g.globalAlpha = 0.5;
    g.drawImage(spr, X(e.x) - (spr.width >> 1), Y(e.y) - (spr.height >> 1) + bob);
    if (ghost) g.globalAlpha = 1;
  }

  function drawShot(s, X, Y) {   // tracer: a bright head and a fading tail
    const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp - (s.slope || 0), y = s.y - (s.h ?? SHOT_H);   // a climbing round's tail trails below it
    if (s.big) {
      g.fillStyle = "#a8742a"; g.fillRect(X(s.x - ux * 2), Y(y - uy * 2), 1, 1);
      g.fillStyle = "#ffd36b"; g.fillRect(X(s.x) - 1, Y(y) - 1, 2, 2);
      g.fillStyle = "#fff6d6"; g.fillRect(X(s.x), Y(y), 1, 1);
      return;
    }
    g.fillStyle = "#7a5a2a"; linePx(g, X(s.x - ux * 7), Y(y - uy * 7), X(s.x - ux * 4), Y(y - uy * 4));
    g.fillStyle = "#e8a83a"; linePx(g, X(s.x - ux * 4), Y(y - uy * 4), X(s.x - ux), Y(y - uy));
    g.fillStyle = "#fff6d6"; g.fillRect(X(s.x), Y(y), 1, 1); g.fillRect(X(s.x + ux), Y(y + uy), 1, 1);
  }
  function drawBolt(b, t, X, Y) {
    const x = X(b.x), y = Y(b.y - BOLT_H), pulse = Math.floor(t * 12 + b.x) % 2;
    g.fillStyle = OUTLINE; g.fillRect(x - 2, y - 1, 5, 3); g.fillRect(x - 1, y - 2, 3, 5);
    g.fillStyle = pulse ? "#ff7a4a" : "#ff9a5c"; g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle = "#ffe0c9"; g.fillRect(x, y, 1, 1);
  }

  function drawProp(pr, X, Y) {
    let spr;
    if (pr.type === "car") spr = (pr.broken ? props.carBroken : props.car)[pr.dir][pr.color];
    else if (pr.type === "tree") spr = pr.broken ? props.treeBroken : props.tree[pr.v];
    else spr = pr.broken ? props.lampBroken : props.lamp;
    const base = pr.type === "car" ? spr.height / 2 : spr.height - 2;
    g.drawImage(spr, X(pr.x) - (spr.width >> 1), Y(pr.y) - Math.round(base));
  }

  /** Is a point just north of a standing building, under its raised roof? */
  function occluded(city, x, y) {
    const tx = Math.floor(x / TILE);
    for (let dy = 1; dy <= 2; dy++) {
      const ty = Math.floor(y / TILE) + dy;
      if (tx < 0 || ty < 0 || tx >= COLS || ty >= COLS) continue;
      const id = city.bid[ty * COLS + tx];
      if (id < 0 || city.buildings[id].dead) continue;
      const b = city.buildings[id];
      if (y > b.y * TILE - wallHeight(b) + 2 && y < b.y * TILE) return true;
    }
    return false;
  }

  // Legs by the direction of travel, torso by the direction of aim (mirrored for left); weapons
  // drawn under or over the torso depending on which way it faces. between(): weapons behind.
  function composeMech(ctx2, P, p, X, Y, fi, between, after) {
    const H = P.legY + P.legsH + 1, left = X(p.x) - (P.w >> 1), top = Y(p.y) + 10 - H;
    const legDir = p.legDir || "down", face = p.facing || "down";
    const legs = legDir === "left" || legDir === "right" ? P.legs.side[fi] : P.legs.front[fi];
    const torso = face === "up" ? P.torso.back : face === "down" ? P.torso.front : P.torso.side;
    const blit = (img, x, y, flip) => {
      if (!flip) { ctx2.drawImage(img, x, y); return; }
      ctx2.save(); ctx2.translate(x + img.width, y); ctx2.scale(-1, 1); ctx2.drawImage(img, 0, 0); ctx2.restore();
    };
    blit(legs, left, top + P.legY, legDir === "left");
    if (between) between();
    blit(torso, left, top + (p.moving && fi === 2 ? 1 : 0), face === "left");
    if (after) after();
  }

  function drawPlayer(run, X, Y) {
    const p = run.player, venting = run.cap.vent > 0, t = run.time;
    const blinking = p.iframes > 0 && Math.floor(p.iframes * 20) % 2;
    const fi = p.moving ? Math.floor(t * 9) % 4 : 0;
    const ms = mechSet(run.chassisKey);
    const P = blinking ? ms.flash : venting ? (Math.floor(t * 10) % 2 ? ms.hotA : ms.hotB) : ms.cold;
    // weapons sit on the mounts and swivel to their target; recoil pushes them back, melee lunges
    const offline = weaponsOffline(run), bob = p.moving && fi === 2 ? 1 : 0;
    const weapons = run.weapons.map((w, i) => ({ w, mp: mountPoint(run, i), a: w.aim ?? p.aim }));
    const drawWeapon = ({ w, mp, a }) => {
      const def = WEAPONS[w.key];
      const lunge = w.swingT > 0 ? Math.sin((1 - w.swingT / (w.key === "fist" ? 0.16 : 0.1)) * Math.PI) * (w.key === "fist" ? 9 : 4) : 0;
      const off = lunge - (w.kick || 0);
      const frames = wspr[w.key] || wspr.autocannon;
      const fr = w.key === "chainblade" ? Math.floor(run.time * 24) % 2 : w.key === "pyre" ? (Math.random() < 0.5 ? 1 : 0) : 0;
      const ws = frames[fr % frames.length];
      const dim = offline || (venting && def.family === "energy");
      g.save();
      g.translate(X(mp.x + Math.cos(a) * off), Y(mp.y + Math.sin(a) * off) + bob);
      g.rotate(a);
      if (Math.cos(a) < 0) g.scale(1, -1);   // keep it right side up when aiming left
      g.drawImage(ws, -1, -(ws.height >> 1));
      if (dim) { g.globalAlpha = 0.65; g.drawImage(wdim[w.key][fr % frames.length], -1, -(ws.height >> 1)); g.globalAlpha = 1; }
      g.restore();
    };
    composeMech(g, P, p, X, Y, fi,
      () => { for (const it of weapons) if (it.mp.behind) drawWeapon(it); },
      () => { for (const it of weapons) if (!it.mp.behind) drawWeapon(it); });
    const L = mechLights(run, t), on = power.lit;   // the light package, on top of the torso
    for (const q of L.px) { g.fillStyle = on || !q.lit ? q.col : "#3a3e48"; g.fillRect(X(q.x), Y(q.y), 1, 1); }   // off: dark glass
    if (on) {
      g.globalCompositeOperation = "lighter";
      for (const q of L.px) if (q.lit) g.drawImage(glowOf(3, "#3a3428"), X(q.x) - 3, Y(q.y) - 3);
      g.globalCompositeOperation = "source-over";
    }
  }

  function drawCapacitor(run, X, Y) {
    const cap = run.cap, p = run.player;
    if (!run.weapons.some((w) => WEAPONS[w.key].family === "energy")) return;
    const x = X(p.x) - 9, y = Y(p.y) + 13, w = 19;
    g.fillStyle = OUTLINE; g.fillRect(x - 1, y - 1, w + 2, 4);
    if (cap.vent > 0) {
      const k = cap.vent / cap.ventMax;
      g.fillStyle = Math.floor(run.time * 10) % 2 ? C.danger : "#ff9a6b";
      g.fillRect(x, y, Math.ceil(w * k), 2);
    } else {
      const full = cap.charge >= 1;
      g.fillStyle = full ? (Math.floor(run.time * 12) % 2 ? "#ffffff" : C.energy) : "#4fb6de";
      g.fillRect(x, y, Math.floor(w * cap.charge), 2);
      if (!full && cap.charge > 0) { g.fillStyle = "#bff4ff"; g.fillRect(x + Math.floor(w * cap.charge) - 1, y, 1, 2); }
    }
  }

  const setZoom = (z) => { target = ZOOMS[z] || ZOOMS.normal; resize(); };
  return { draw, resize, setZoom, get scale() { return S; }, get view() { return { vw, vh }; } };
}

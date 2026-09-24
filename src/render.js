import { ARENA, ENEMIES, WEAPONS } from "./content.js";
import { weaponsOffline } from "./game.js";
import { STICK_RADIUS } from "./input.js";
import { mechFrames, enemyFrames, flash, glow, salvageFrames, bigSalvageFrames, OUTLINE } from "./art.js";
import { TILE, COLS, wallHeight } from "./city.js";
import { paintGround, paintBuilding, paintRubble, propSprites } from "./cityart.js";

// The world is drawn into a small buffer (about 200 game px on the short side) and blown up by an
// integer factor, so pixels stay square. The camera moves smoothly: the buffer is drawn one pixel
// oversized and the fractional camera offset is applied at blit time. Text and the touch stick are
// drawn afterwards at native resolution.
//
// Draw order: floor (+ scorch decals) -> floor lights (additive) -> telegraphs, salvage, shadows ->
// bodies sorted by y -> projectiles and effects -> bloom (additive) -> vignette -> blit -> text/UI.

const TARGET_SHORT = 200;
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
  let floor = null, fg = null, floorCity = null;
  const bsprites = new Map();   // "id:stage" -> building sprite
  const props = propSprites();
  const smoke = [];             // renderer-only ambient smoke from wrecked buildings

  const mech = { cold: mechFrames(false), hotA: mechFrames(true, 0), hotB: mechFrames(true, 1) };
  mech.flash = mech.cold.map((f) => flash(f));
  mech.xray = flash(mech.cold[0], "#7fd8ff");
  const enemies = {};
  for (const k of Object.keys(ENEMIES)) {
    const frames = enemyFrames(k);
    enemies[k] = { frames, flash: frames.map((f) => flash(f)), xray: frames.map((f) => flash(f, "#ff7a5c")) };
  }
  const shadows = new Map();
  const shadow = (w) => { if (!shadows.has(w)) shadows.set(w, shadowSprite(w)); return shadows.get(w); };
  const salv = [salvageFrames(), bigSalvageFrames()];
  const glows = new Map();
  const glowOf = (r, col) => { const k = r + col; if (!glows.has(k)) glows.set(k, glow(r, col)); return glows.get(k); };

  let S = 1, vw = 0, vh = 0, dpr = 1, vig = null;
  const cam = { x: ARENA.w / 2, y: ARENA.h / 2, init: false };

  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(innerWidth * dpr), bh = Math.round(innerHeight * dpr);
    canvas.width = bw; canvas.height = bh;
    S = Math.max(1, Math.round(Math.min(bw, bh) / TARGET_SHORT));
    vw = Math.ceil(bw / S); vh = Math.ceil(bh / S);
    buf.width = vw + 2; buf.height = vh + 2;
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
    if (floorCity !== city) { floor = paintGround(city); fg = floor.getContext("2d"); floorCity = city; bsprites.clear(); smoke.length = 0; }
    for (const f of run.fx) {
      if (f.stamped) continue;
      if (f.type === "collapse") { f.stamped = true; paintRubble(fg, city.buildings[f.bid]); continue; }
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
  function buildingSprite(b, stage) {
    const k = b.id + ":" + stage;
    if (!bsprites.has(k)) bsprites.set(k, paintBuilding(b, stage));
    return bsprites.get(k);
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
    const t = run.time, p = run.player;

    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
    g.fillStyle = C.void; g.fillRect(0, 0, buf.width, buf.height);
    g.drawImage(floor, ox, oy);

    // ---- floor lights
    g.globalCompositeOperation = "lighter";
    g.drawImage(glowOf(34, run.cap.vent > 0 ? "#3a1a10" : "#18233a"), X(p.x) - 34, Y(p.y) - 30);
    for (const b of run.bolts) g.drawImage(glowOf(8, "#4a1c0c"), X(b.x) - 8, Y(b.y) - 8);
    for (const f of run.fx) {
      const k = f.t / f.max;
      if (f.type === "boom" && k > 0.4) { const r = Math.round(f.r * 3); g.drawImage(glowOf(r, "#5a2a0e"), X(f.x) - r, Y(f.y) - r); }
      if (f.type === "muzzle") g.drawImage(glowOf(10, "#4a3a12"), X(f.x) - 10, Y(f.y) - 10);
    }
    g.globalCompositeOperation = "source-over";

    // ---- spawn telegraphs: a reticle that closes in
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

    // ---- salvage
    for (const k of run.pickups) {
      const frames = salv[k.n >= 5 ? 1 : 0], f = frames[Math.floor(t * 8 + k.x) % frames.length];
      const bob = Math.sin(t * 5 + k.x * 0.7) > 0.2 ? 1 : 0;
      g.drawImage(f, X(k.x) - (f.width >> 1), Y(k.y) - (f.height >> 1) - bob);
    }

    // ---- shadows, then everything that stands up, sorted by its base line. Buildings are 3/4
    // view: the roof is drawn raised by the wall height, so tall blocks hide what's behind them.
    const inView = (x0, y0, x1, y1) => x1 >= left - 4 && x0 <= left + vw + 4 && y1 >= top - 4 && y0 <= top + vh + 4;
    for (const e of run.enemies) {
      const w = e.d.r * 2 + (e.d.boss ? 2 : 0), s = shadow(w);
      g.drawImage(s, X(e.x) - (w >> 1), Y(e.y) + e.d.r - (s.height >> 1) + (e.type === "drone" ? 2 : 0));
    }
    g.drawImage(shadow(16), X(p.x) - 8, Y(p.y) + 8);

    const city = run.city, items = [];
    for (const b of city.buildings) {
      if (b.dead) continue;
      const x0 = b.x * TILE, y1 = (b.y + b.h) * TILE;
      if (!inView(x0, b.y * TILE - wallHeight(b), x0 + b.w * TILE, y1)) continue;
      items.push([y1, 0, b]);
    }
    for (const f of run.fx) if (f.type === "collapse") { const b = city.buildings[f.bid]; items.push([(b.y + b.h) * TILE, 1, b, f]); }
    for (const pr of city.props) if (inView(pr.x - 8, pr.y - 14, pr.x + 8, pr.y + 8)) items.push([pr.y + 4, 2, pr]);
    for (const e of run.enemies) items.push([e.y + e.d.r * 0.5, 3, e]);
    items.push([p.y + 8, 4, p]);
    items.sort((a, b) => a[0] - b[0]);
    for (const [, kind, o, f] of items) {
      if (kind === 0) {
        if (o.hit > 0) o.hit -= dt;
        const spr = buildingSprite(o, stageOf(o)), jit = o.hit > 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        g.drawImage(spr, X(o.x * TILE) + jit, Y(o.y * TILE - wallHeight(o)));
        if (stageOf(o) === 2 && Math.random() < dt * (1 + o.w * o.h * 0.3)) {
          smoke.push({ x: (o.x + Math.random() * o.w) * TILE, y: (o.y + Math.random() * o.h) * TILE - wallHeight(o), t: 1.4, max: 1.4 });
        }
      } else if (kind === 1) {   // collapsing: the building sinks into its own dust
        const k = f.t / f.max, spr = buildingSprite(o, 2), Hw = wallHeight(o), sink = Math.round((1 - k) * (spr.height * 0.85));
        const jit = Math.random() < 0.5 ? -1 : 1;
        if (spr.height - sink > 0) g.drawImage(spr, 0, 0, spr.width, spr.height - sink, X(o.x * TILE) + jit, Y(o.y * TILE - Hw) + sink, spr.width, spr.height - sink);
      } else if (kind === 2) drawProp(o, X, Y);
      else if (kind === 3) drawEnemy(o, t, X, Y, false);
      else drawPlayer(run, X, Y);
    }
    // x-ray: units hidden behind a building are drawn again as faint silhouettes
    for (const e of run.enemies) if (occluded(city, e.x, e.y + e.d.r)) drawEnemy(e, t, X, Y, true);
    if (occluded(city, p.x, p.y + 8)) { g.globalAlpha = 0.6; g.drawImage(mech.xray, X(p.x) - 9, Y(p.y) - 9); g.globalAlpha = 1; }

    // ambient smoke from wrecked buildings
    for (const q of smoke) { q.t -= dt; q.y -= 9 * dt; q.x += 3 * dt; }
    for (let i = smoke.length - 1; i >= 0; i--) if (smoke[i].t <= 0) smoke.splice(i, 1);
    for (const q of smoke) {
      const k = q.t / q.max, sz = Math.round(2 + (1 - k) * 4);
      g.globalAlpha = k * 0.45; g.fillStyle = "#3a3836"; g.fillRect(X(q.x) - (sz >> 1), Y(q.y) - (sz >> 1), sz, sz);
    }
    g.globalAlpha = 1;

    // ---- projectiles
    for (const s of run.shots) {
      const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
      g.fillStyle = "#a8742a"; g.fillRect(X(s.x - ux * 3), Y(s.y - uy * 3), 1, 1);
      g.fillStyle = C.ballistic; g.fillRect(X(s.x - ux * 1.5), Y(s.y - uy * 1.5), 1, 1); g.fillRect(X(s.x), Y(s.y), 1, 1);
      g.fillStyle = "#fff6d6"; g.fillRect(X(s.x + ux), Y(s.y + uy), 1, 1);
    }
    for (const b of run.bolts) {
      const x = X(b.x), y = Y(b.y), pulse = Math.floor(t * 12 + b.x) % 2;
      g.fillStyle = OUTLINE; g.fillRect(x - 2, y - 1, 5, 3); g.fillRect(x - 1, y - 2, 3, 5);
      g.fillStyle = pulse ? "#ff7a4a" : "#ff9a5c"; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = "#ffe0c9"; g.fillRect(x, y, 1, 1);
    }

    // ---- effects
    for (const f of run.fx) {
      const k = f.t / f.max;   // 1 -> 0
      if (f.type === "beam") {
        const nx = -(f.y2 - f.y1), ny = f.x2 - f.x1, nl = Math.hypot(nx, ny), w = Math.max(1, f.w * (0.35 + k * 0.65));
        for (let o = -w / 2; o <= w / 2; o += 0.5) {
          const inner = Math.abs(o) / (w / 2);
          g.fillStyle = inner < 0.3 ? "#ffffff" : inner < 0.7 ? "#bff4ff" : "#4fb6de";
          linePx(g, X(f.x1 + (nx / nl) * o), Y(f.y1 + (ny / nl) * o), X(f.x2 + (nx / nl) * o), Y(f.y2 + (ny / nl) * o));
        }
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
        g.fillStyle = "#fff6d6"; g.fillRect(X(f.x) - 1, Y(f.y), 3, 1); g.fillRect(X(f.x), Y(f.y) - 1, 1, 3);
      } else if (f.type === "boom") {
        const e = 1 - k, x = X(f.x), y = Y(f.y), r = f.r * (0.5 + e * 1.1);
        if (e < 0.18) { g.fillStyle = "#ffffff"; discPx(g, x, y, r); }
        else if (e < 0.45) {
          g.fillStyle = "#ff8a3c"; discPx(g, x, y, r);
          g.fillStyle = "#ffd27a"; discPx(g, x - 1, y - 1, r * 0.6);
        } else {
          // smoke: a dithered ring that thins out and drifts up
          g.fillStyle = e < 0.7 ? "#4a3a3a" : "#2a2530";
          const rr = Math.round(r);
          for (let yy = -rr; yy <= rr; yy++) for (let xx = -rr; xx <= rr; xx++) {
            const d = Math.hypot(xx, yy);
            if (d > rr || d < rr * (e - 0.3)) continue;
            if (((xx + yy + Math.floor(e * 10)) & 1) === 0 && Math.random() > e - 0.3) g.fillRect(x + xx, y + yy - Math.round(e * 3), 1, 1);
          }
        }
      }
    }
    for (const q of run.parts) {
      const k = q.t / q.max;
      if (q.steam) {
        g.globalAlpha = k * 0.55;
        const s = Math.round(q.size + (1 - k) * 3);
        g.fillStyle = q.color; g.fillRect(X(q.x) - (s >> 1), Y(q.y) - (s >> 1), s, s);
        continue;
      }
      g.globalAlpha = Math.min(1, k * 2);
      g.fillStyle = q.color; g.fillRect(X(q.x), Y(q.y), q.size, q.size);
    }
    g.globalAlpha = 1;

    drawCapacitor(run, X, Y);

    // ---- bloom
    g.globalCompositeOperation = "lighter";
    for (const f of run.fx) {
      const k = f.t / f.max;
      if (f.type === "beam") {
        const n = Math.ceil(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) / 10), gl = glowOf(9, k > 0.5 ? "#1f5a73" : "#123846");
        for (let i = 0; i <= n; i++) g.drawImage(gl, X(f.x1 + ((f.x2 - f.x1) * i) / n) - 9, Y(f.y1 + ((f.y2 - f.y1) * i) / n) - 9);
      } else if (f.type === "boom" && k > 0.55) {
        const r = Math.round(f.r * 1.8); g.drawImage(glowOf(r, "#6a3410"), X(f.x) - r, Y(f.y) - r);
      } else if (f.type === "ring" && f.thick) {
        const r = Math.max(4, Math.round(f.r * (1 - k * k * 0.7)));
        g.drawImage(glowOf(r, "#0f2a36"), X(f.x) - r, Y(f.y) - r);
      }
    }
    for (const b of run.bolts) g.drawImage(glowOf(4, "#5a2410"), X(b.x) - 4, Y(b.y) - 4);
    if (run.cap.charge >= 1 && run.cap.vent <= 0) {   // charged and holding: the mech hums
      const r = Math.floor(t * 8) % 2 ? 12 : 10;
      g.drawImage(glowOf(r, "#0f3346"), X(p.x) - r, Y(p.y) - 3 - r);
    }
    g.globalCompositeOperation = "source-over";
    g.drawImage(vig, 0, 0);

    // ---- blit to screen
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, -(1 + fx) * S, -(1 + fy) * S, buf.width * S, buf.height * S);

    // ---- native-res layer
    const toScreen = (wx, wy) => [(wx - left) * S, (wy - top) * S];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(7 * S)}px "Pixelify Sans", ui-monospace, monospace`;
    for (const tx of run.texts) {
      const [x, y] = toScreen(tx.x, tx.y);
      ctx.globalAlpha = Math.min(1, (tx.t / tx.max) * 2);
      ctx.fillStyle = OUTLINE;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(tx.n, x + dx * S * 0.5, y + dy * S * 0.5);
      ctx.fillStyle = tx.n >= 40 ? C.energy : "#f4f1ea"; ctx.fillText(tx.n, x, y);
    }
    ctx.globalAlpha = 1;
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

  function drawEnemy(e, t, X, Y, ghost) {
    const set = enemies[e.type], n = set.frames.length;
    const fi = n > 1 ? Math.floor(t * (e.type === "skitter" ? 12 : 4) + e.ph * 10) % n : 0;
    const spr = (ghost ? set.xray : e.flash > 0 ? set.flash : set.frames)[fi];
    const bob = e.type === "drone" ? Math.round(Math.sin(t * 5 + e.ph * 6) * 1.2) - 1 : 0;
    if (ghost) g.globalAlpha = 0.5;
    g.drawImage(spr, X(e.x) - (spr.width >> 1), Y(e.y) - (spr.height >> 1) + bob);
    if (ghost) g.globalAlpha = 1;
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

  function drawPlayer(run, X, Y) {
    const p = run.player, venting = run.cap.vent > 0, t = run.time;
    const blinking = p.iframes > 0 && Math.floor(p.iframes * 20) % 2;
    const fi = p.moving ? Math.floor(t * 9) % 4 : 0;
    const set = blinking ? mech.flash : venting ? (Math.floor(t * 10) % 2 ? mech.hotA : mech.hotB) : mech.cold;
    const x = X(p.x), y = Y(p.y);
    g.drawImage(set[fi], x - 9, y - 9);
    // barrels come off the shoulder mounts (left, right, alternating; later pairs stack)
    const offline = weaponsOffline(run), a = p.aim, cx = Math.cos(a), cy = Math.sin(a);
    const bob = p.moving && fi === 2 ? 1 : 0;
    run.weapons.forEach((w, i) => {
      const def = WEAPONS[w.key];
      const msx = x + (i % 2 ? 7 : -7), msy = y - 4 + bob + (Math.floor(i / 2) - 1) * 2;
      const len = def.family === "melee" ? 5 : def.family === "energy" ? 8 : 7;
      const dim = offline || (venting && def.family === "energy");
      const col = dim ? "#6b4b44" : def.family === "energy" ? C.energy : def.family === "melee" ? C.melee : C.ballistic;
      g.fillStyle = OUTLINE;
      linePx(g, msx, msy + 1, msx + cx * len, msy + 1 + cy * len);
      g.fillStyle = dim ? "#4a3430" : "#56606e";
      linePx(g, msx, msy, msx + cx * (len - 2), msy + cy * (len - 2));
      g.fillStyle = col;
      g.fillRect(Math.round(msx + cx * (len - 1)), Math.round(msy + cy * (len - 1)), 1, 1);
      g.fillRect(Math.round(msx + cx * len), Math.round(msy + cy * len), 1, 1);
    });
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

  return { draw, resize, get scale() { return S; }, get view() { return { vw, vh }; } };
}

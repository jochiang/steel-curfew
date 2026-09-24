import { ARENA, ENEMIES, WEAPONS } from "./content.js";
import { weaponsOffline } from "./game.js";
import { STICK_RADIUS } from "./input.js";

// The world is drawn into a small buffer (about 200 game px on the short side) and blown up by an
// integer factor, so pixels stay square. The camera moves smoothly: the buffer is drawn one pixel
// oversized and the fractional camera offset is applied at blit time. Text and the touch stick are
// drawn afterwards at native resolution.

const TARGET_SHORT = 200;
const C = {
  void: "#101217", floor: "#22262d", seam: "#2a2f37", rivet: "#30363f", wall: "#3b424d",
  steel: "#c9d3dd", steelDark: "#7d8896", shadow: "#16181d", accent: "#d97757",
  energy: "#8fe3ff", ballistic: "#ffd36b", salvage: "#9df0b5", danger: "#ff5b4a",
};

// ---------------------------------------------------------------- pixel helpers
function sprite(w, h, fn) {
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d");
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = fn(x, y);
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

function enemySprite(d, flash) {
  const r = d.r, s = r * 2 + 3, c = r + 1;
  return sprite(s, s, (x, y) => {
    const dx = x - c + 0.5, dy = y - c + 0.5;
    const square = d.mass >= 3 && !d.boss;
    const dist = square ? Math.max(Math.abs(dx), Math.abs(dy)) * 0.95 + Math.min(Math.abs(dx), Math.abs(dy)) * 0.1 : Math.hypot(dx, dy);
    if (dist > r + 0.5) return null;
    if (flash) return "#ffffff";
    if (dist > r - 0.7) return shade(d.color, -0.55);                 // outline
    if (Math.abs(dy + r * 0.15) < 0.9 && Math.abs(dx) < r * 0.55) return "#1b0f0f";   // visor slit
    if (dy < -r * 0.35 && dx < 0) return shade(d.color, 0.3);          // highlight
    if (dy > r * 0.45) return shade(d.color, -0.25);                   // underside
    return d.color;
  });
}

// Greybox mech: 19x19, idle + two walk frames. Shoulders are the weapon mounts; barrels are
// drawn separately so they can aim. `hot` is the venting look (tinted hull, glowing grilles).
function mechSprite(frame, hot) {
  const c = new OffscreenCanvas(19, 19), g = c.getContext("2d");
  const B = hot ? "#e8a08a" : C.steel, D = hot ? "#9c5a4a" : C.steelDark, L = hot ? "#ffd6c7" : "#eef3f7";
  const F = hot ? "#6e3f36" : "#5c6572", O = C.shadow;
  const rect = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const box = (x, y, w, h, fill) => { rect(O, x, y, w, h); rect(fill, x + 1, y + 1, w - 2, h - 2); };
  const liftL = frame === 1 ? 1 : 0, liftR = frame === 2 ? 1 : 0;
  // legs and feet (behind the torso)
  box(5, 10 - liftL, 4, 7, D); box(4, 15 - liftL, 5, 3, F);
  box(10, 10 - liftR, 4, 7, D); box(10, 15 - liftR, 5, 3, F);
  box(6, 9, 7, 3, D);                                   // hip
  // torso
  box(3, 1, 13, 10, B);
  rect(L, 4, 2, 11, 1);                                 // top light
  rect(D, 4, 9, 11, 1);                                 // underside
  rect(O, 6, 3, 7, 4); rect(C.accent, 7, 4, 5, 2); rect("#ffb08f", 7, 4, 2, 1);   // cockpit
  rect(D, 9, 7, 1, 2);                                  // panel seam
  // shoulder mounts with grilles
  for (const x of [0, 15]) {
    box(x, 2, 4, 7, D);
    rect(B, x + 1, 3, 2, 1);
    rect(hot ? "#ff8a5c" : O, x + 1, 5, 2, 1);
    rect(hot ? "#ffb36b" : O, x + 1, 7, 2, 1);
  }
  return c;
}

function circlePx(g, cx, cy, r, from = 0, to = Math.PI * 2) {
  const steps = Math.max(12, Math.ceil(r * (to - from) * 1.2));
  let lx = NaN, ly = NaN;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    if (x !== lx || y !== ly) { g.fillRect(x, y, 1, 1); lx = x; ly = y; }
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

function floorTexture() {
  const c = new OffscreenCanvas(ARENA.w, ARENA.h), g = c.getContext("2d");
  g.fillStyle = C.floor; g.fillRect(0, 0, ARENA.w, ARENA.h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < ARENA.h; y += 32) for (let x = 0; x < ARENA.w; x += 32) {
    if (rnd() < 0.18) { g.fillStyle = "#252a31"; g.fillRect(x + 1, y + 1, 31, 31); }
    g.fillStyle = C.seam; g.fillRect(x, y, 32, 1); g.fillRect(x, y, 1, 32);
    g.fillStyle = C.rivet;
    for (const [ox, oy] of [[3, 3], [28, 3], [3, 28], [28, 28]]) g.fillRect(x + ox, y + oy, 1, 1);
  }
  for (let i = 0; i < 900; i++) {   // grime
    g.fillStyle = rnd() < 0.5 ? "#1e2228" : "#262b32";
    g.fillRect((rnd() * ARENA.w) | 0, (rnd() * ARENA.h) | 0, 1 + (rnd() * 2 | 0), 1);
  }
  g.fillStyle = C.wall;
  g.fillRect(0, 0, ARENA.w, 2); g.fillRect(0, ARENA.h - 2, ARENA.w, 2);
  g.fillRect(0, 0, 2, ARENA.h); g.fillRect(ARENA.w - 2, 0, 2, ARENA.h);
  return c;
}

// ---------------------------------------------------------------- renderer
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const buf = new OffscreenCanvas(8, 8), g = buf.getContext("2d");
  const floor = floorTexture();
  const enemySprites = Object.fromEntries(Object.entries(ENEMIES).map(([k, d]) => [k, [enemySprite(d, false), enemySprite(d, true)]]));
  const mech = [0, 1, 2].map((f) => mechSprite(f, false)), mechHot = [0, 1, 2].map((f) => mechSprite(f, true));
  const salvageSpr = [
    sprite(3, 3, (x, y) => (Math.abs(x - 1) + Math.abs(y - 1) <= 1 ? (x === 1 && y === 1 ? "#e8fff0" : C.salvage) : null)),
    sprite(5, 5, (x, y) => (Math.abs(x - 2) + Math.abs(y - 2) <= 2 ? (Math.abs(x - 2) + Math.abs(y - 2) === 2 ? "#3f9a62" : x + y < 4 ? "#e8fff0" : C.salvage) : null)),
  ];
  let S = 1, vw = 0, vh = 0, dpr = 1;
  const cam = { x: ARENA.w / 2, y: ARENA.h / 2, init: false };

  function resize() {
    dpr = Math.min(3, window.devicePixelRatio || 1);
    const bw = Math.round(innerWidth * dpr), bh = Math.round(innerHeight * dpr);
    canvas.width = bw; canvas.height = bh;
    S = Math.max(1, Math.round(Math.min(bw, bh) / TARGET_SHORT));
    vw = Math.ceil(bw / S); vh = Math.ceil(bh / S);
    buf.width = vw + 2; buf.height = vh + 2;
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

  function draw(run, dt, input) {
    updateCamera(run, dt);
    const shake = run.shake > 0 ? run.shake : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    const left = cam.x - vw / 2 + sx, top = cam.y - vh / 2 + sy;
    const li = Math.floor(left), ti = Math.floor(top), fx = left - li, fy = top - ti;
    const ox = -li + 1, oy = -ti + 1;   // world -> buffer offset (integer)
    const X = (v) => Math.round(v + ox), Y = (v) => Math.round(v + oy);

    g.fillStyle = C.void; g.fillRect(0, 0, buf.width, buf.height);
    g.drawImage(floor, ox, oy);

    // spawn telegraphs
    for (const m of run.marks) {
      const k = 1 - m.t / m.max, big = m.type === "crusher";
      if (Math.floor(k * (big ? 10 : 7) * (1 + k)) % 2) continue;
      g.fillStyle = C.danger;
      const s = big ? 6 : 3, x = X(m.x), y = Y(m.y);
      for (let i = -s; i <= s; i++) { g.fillRect(x + i, y + i, 1, 1); g.fillRect(x + i, y - i, 1, 1); }
    }

    // salvage
    for (const k of run.pickups) {
      const spr = salvageSpr[k.n >= 5 ? 1 : 0], bob = Math.sin(run.time * 6 + k.x) > 0.3 ? 1 : 0;
      g.drawImage(spr, X(k.x) - (spr.width >> 1), Y(k.y) - (spr.height >> 1) - bob);
    }

    // shadows, then bodies sorted by y
    g.fillStyle = "rgba(0,0,0,0.28)";
    for (const e of run.enemies) g.fillRect(X(e.x) - e.d.r + 1, Y(e.y) + e.d.r - 1, e.d.r * 2 - 1, 2);
    const p = run.player;
    g.fillRect(X(p.x) - 7, Y(p.y) + 9, 15, 2);

    const bodies = run.enemies.slice().sort((a, b) => a.y - b.y);
    let drewPlayer = false;
    for (const e of bodies) {
      if (!drewPlayer && e.y > p.y) { drawPlayer(run, X, Y); drewPlayer = true; }
      const spr = enemySprites[e.type][e.flash > 0 ? 1 : 0];
      g.drawImage(spr, X(e.x) - e.d.r - 1, Y(e.y) - e.d.r - 1);
    }
    if (!drewPlayer) drawPlayer(run, X, Y);

    // projectiles
    g.fillStyle = C.ballistic;
    for (const s of run.shots) {
      const sp = Math.hypot(s.vx, s.vy), ux = s.vx / sp, uy = s.vy / sp;
      g.fillRect(X(s.x), Y(s.y), 1, 1); g.fillRect(X(s.x - ux * 2), Y(s.y - uy * 2), 1, 1);
      g.fillStyle = "#fff3cf"; g.fillRect(X(s.x + ux), Y(s.y + uy), 1, 1); g.fillStyle = C.ballistic;
    }
    for (const b of run.bolts) {
      const x = X(b.x), y = Y(b.y);
      g.fillStyle = "#ff8a5c"; g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = "#ffe0c9"; g.fillRect(x, y, 1, 1);
    }

    // effects
    for (const f of run.fx) {
      const k = f.t / f.max;
      if (f.type === "beam") {
        const nx = -(f.y2 - f.y1), ny = f.x2 - f.x1, nl = Math.hypot(nx, ny), w = Math.max(1, f.w * k);
        for (let o = -w / 2; o <= w / 2; o += 0.5) {
          g.fillStyle = Math.abs(o) < w * 0.22 ? "#ffffff" : C.energy;
          linePx(g, X(f.x1 + (nx / nl) * o), Y(f.y1 + (ny / nl) * o), X(f.x2 + (nx / nl) * o), Y(f.y2 + (ny / nl) * o));
        }
      } else if (f.type === "ring") {
        g.fillStyle = f.color;
        const r = f.r * (1 - k * k * 0.7);
        circlePx(g, X(f.x), Y(f.y), r);
        if (f.thick) { circlePx(g, X(f.x), Y(f.y), r - 1); if (k > 0.5) circlePx(g, X(f.x), Y(f.y), r - 3); }
      } else if (f.type === "swing") {
        g.fillStyle = f.heavy ? "#ffd9c7" : "#f2f5f8";
        const spread = f.arc * (1.2 - k * 0.2);
        circlePx(g, X(f.x), Y(f.y), f.reach, f.a - spread / 2, f.a + spread / 2);
        circlePx(g, X(f.x), Y(f.y), f.reach - 1, f.a - spread / 2.6, f.a + spread / 2.6);
        if (f.heavy) circlePx(g, X(f.x), Y(f.y), f.reach - 2, f.a - spread / 4, f.a + spread / 4);
      } else if (f.type === "muzzle") {
        g.fillStyle = "#fff3cf"; g.fillRect(X(f.x) - 1, Y(f.y), 3, 1); g.fillRect(X(f.x), Y(f.y) - 1, 1, 3);
      }
    }
    for (const q of run.parts) {
      g.globalAlpha = q.steam ? (q.t / q.max) * 0.7 : Math.min(1, (q.t / q.max) * 2);
      g.fillStyle = q.color; g.fillRect(X(q.x), Y(q.y), q.size, q.size);
    }
    g.globalAlpha = 1;

    drawCapacitor(run, X, Y);

    // ---- blit to screen
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, -(1 + fx) * S, -(1 + fy) * S, buf.width * S, buf.height * S);

    // ---- native-res layer
    const toScreen = (wx, wy) => [(wx - left) * S, (wy - top) * S];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.round(7 * S)}px ui-monospace, "SF Mono", Menlo, monospace`;
    for (const t of run.texts) {
      const [x, y] = toScreen(t.x, t.y);
      ctx.globalAlpha = Math.min(1, (t.t / t.max) * 2);
      ctx.fillStyle = "#0b0c0f"; ctx.fillText(t.n, x + S * 0.5, y + S * 0.5);
      ctx.fillStyle = t.n >= 40 ? C.energy : "#f4f1ea"; ctx.fillText(t.n, x, y);
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

  function drawPlayer(run, X, Y) {
    const p = run.player, venting = run.cap.vent > 0;
    if (p.iframes > 0 && Math.floor(p.iframes * 20) % 2) return;
    const frame = p.moving ? 1 + (Math.floor(run.time * 8) % 2) : 0;
    const x = X(p.x), y = Y(p.y);
    g.drawImage((venting ? mechHot : mech)[frame], x - 9, y - 8);
    // barrels come off the shoulder mounts (left, right, alternating; later pairs stack)
    const offline = weaponsOffline(run), a = p.aim, cx = Math.cos(a), cy = Math.sin(a);
    run.weapons.forEach((w, i) => {
      const def = WEAPONS[w.key];
      const sx = x + (i % 2 ? 7 : -7), sy = y - 3 + (Math.floor(i / 2) - 1) * 2;
      const len = def.family === "melee" ? 5 : def.family === "energy" ? 8 : 7;
      const dim = offline || (venting && def.family === "energy");
      g.fillStyle = C.shadow;
      linePx(g, sx, sy + 1, sx + cx * len, sy + 1 + cy * len);
      g.fillStyle = dim ? "#6b4b44" : def.family === "energy" ? C.energy : def.family === "melee" ? "#f0e6dc" : C.ballistic;
      linePx(g, sx, sy, sx + cx * len, sy + cy * len);
    });
  }

  function drawCapacitor(run, X, Y) {
    const cap = run.cap, p = run.player;
    if (!run.weapons.some((w) => WEAPONS[w.key].family === "energy")) return;
    const x = X(p.x) - 9, y = Y(p.y) + 12, w = 19;
    g.fillStyle = "#0b0c0f"; g.fillRect(x - 1, y - 1, w + 2, 4);
    if (cap.vent > 0) {
      const k = cap.vent / cap.ventMax;
      g.fillStyle = Math.floor(run.time * 10) % 2 ? C.danger : "#ff9a6b";
      g.fillRect(x, y, Math.ceil(w * k), 2);
    } else {
      const full = cap.charge >= 1;
      g.fillStyle = full ? (Math.floor(run.time * 12) % 2 ? "#ffffff" : C.energy) : C.energy;
      g.fillRect(x, y, Math.floor(w * cap.charge), 2);
    }
  }

  return { draw, resize, get scale() { return S; }, get view() { return { vw, vh }; } };
}

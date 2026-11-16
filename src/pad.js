// Gamepad support (Bluetooth / USB controllers, including on phones).
// In combat the left stick or d-pad moves the mech and Start pauses. On every menu the d-pad or left
// stick moves a focus ring between buttons, A presses, B goes back, the right stick scrolls.

const DEAD = 0.18, NAV_AT = 0.55;
const REPEAT_FIRST = 0.36, REPEAT = 0.13;   // seconds: held direction repeats
const SCROLL = 900;                         // CSS px/s at full right-stick deflection
const A = 0, B = 1, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

function firstPad() {
  if (!navigator.getGamepads) return null;
  let found = null;
  for (const p of navigator.getGamepads()) {
    if (!p || !p.connected) continue;
    if (p.mapping === "standard") return p;
    found ||= p;
  }
  return found;
}
const down = (p, i) => !!p.buttons[i]?.pressed;

/** Movement vector (length 0..1) from the left stick or d-pad, or null when there's no pad input. */
export function padMove() {
  const p = firstPad();
  if (!p) return null;
  let x = p.axes[0] || 0, y = p.axes[1] || 0;
  const m = Math.hypot(x, y);
  if (m > DEAD) {
    const k = Math.min(1, (m - DEAD) / (1 - DEAD) / 0.85) / m;   // same curve as the touch stick
    return { x: x * k, y: y * k };
  }
  x = (down(p, RIGHT) ? 1 : 0) - (down(p, LEFT) ? 1 : 0); y = (down(p, DOWN) ? 1 : 0) - (down(p, UP) ? 1 : 0);
  const d = Math.hypot(x, y);
  return d ? { x: x / d, y: y / d } : null;
}

// The menu in front: the settings sheet if it's open, else the visible screen. Null during combat.
const menuRoot = () => document.getElementById("settings") || document.querySelector(".screen:not([hidden])");
const targets = (root) => [...root.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter((el) => el.getClientRects().length);
const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; };

function pinned(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) { const pos = getComputedStyle(n).position; if (pos === "sticky" || pos === "fixed") return !n.classList.contains("settings-overlay") && !n.classList.contains("screen"); }
  return false;
}

export function createPad({ onPause, inCombat }) {
  const was = [];              // button states last frame
  let navDir = null, navT = 0; // held direction and time to its next repeat
  let at = null;               // where the focus ring last was (screens re-render and drop focus)
  let lastT = performance.now();

  addEventListener("gamepadconnected", () => document.documentElement.classList.add("pad"));
  addEventListener("pointerdown", () => document.documentElement.classList.remove("pad"), true);

  function focus(el) {
    document.documentElement.classList.add("pad");
    el.focus({ preventScroll: true });
    if (!pinned(el)) {   // keep it clear of the screen edges and of a pinned footer (the Deploy bar)
      const r = el.getBoundingClientRect(), h = innerHeight;
      if (r.top < h * 0.12 || r.bottom > h * 0.8) el.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const c = center(el); at = { x: c.x, y: c.y };
  }
  // the focused target, or (after a re-render) the one nearest to where the ring was
  let rootId = "";
  function current(root, list) {
    if (root.id !== rootId) { rootId = root.id; at = null; }   // a different menu: start from its main button
    const a = document.activeElement;
    if (a && root.contains(a) && list.includes(a)) return a;
    if (!list.length) return null;
    if (!at) return root.querySelector("[data-resume], [data-buy]:not([disabled]), [data-perk], .primary:not([disabled])") || list[0];
    let best = null, bd = Infinity;
    for (const el of list) { const c = center(el), d = Math.hypot(c.x - at.x, c.y - at.y); if (d < bd) { bd = d; best = el; } }
    return best;
  }
  function nav(dx, dy) {
    const root = menuRoot(); if (!root) return;
    const list = targets(root), cur = current(root, list);
    if (!cur) return;
    if (document.activeElement !== cur) return focus(cur);   // first press just shows the ring
    if (dx && cur.type === "range") {   // sliders: left/right changes the value
      dx > 0 ? cur.stepUp() : cur.stepDown();
      cur.dispatchEvent(new Event("input", { bubbles: true })); cur.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // pinned bars (the Deploy footer) float over the list, so geometry lies about them: they come
    // after everything else going down, and going up from one lands on the last thing before it
    const i = list.indexOf(cur), fwd = dx > 0 || dy > 0;
    if (pinned(cur)) {
      if (dx) return;
      const rest = fwd ? list.slice(i + 1) : list.slice(0, i).reverse();
      const to = rest.find((el) => !pinned(el)) || rest[0];
      return to && focus(to);
    }
    const c = center(cur);
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === cur || pinned(el)) continue;
      const r = el.getBoundingClientRect();
      // distance along the pressed direction (edge to edge) and sideways (0 when the two overlap)
      const along = dx ? (dx > 0 ? r.left - c.r.right : c.r.left - r.right) : (dy > 0 ? r.top - c.r.bottom : c.r.top - r.bottom);
      const side = dx ? Math.max(0, r.top - c.r.bottom, c.r.top - r.bottom) : Math.max(0, r.left - c.r.right, c.r.left - r.right);
      const ctr = dx ? (r.left + r.width / 2 - c.x) * dx : (r.top + r.height / 2 - c.y) * dy;
      if (ctr <= 1 || along < -Math.min(dx ? r.width : r.height, dx ? c.r.width : c.r.height) * 0.6) continue;
      if (side > Math.max(0, along) * 2 + 40) continue;   // far off to the side: not really "that way"
      const score = Math.max(0, along) + side * 3 + ctr * 0.05;
      if (score < bs) { bs = score; best = el; }
    }
    if (dy) best ||= (fwd ? list.slice(i + 1) : list.slice(0, i).reverse()).find(pinned);
    if (best) focus(best);
  }
  function back() {
    const root = menuRoot(); if (!root) return;
    const b = root.querySelector("[data-close]") || root.querySelector("[data-resume]");   // settings: Done. Pause: Resume
    if (b && root.id !== "title") b.click();
  }

  return {
    /** Call once a frame. */
    poll() {
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
      const p = firstPad();
      if (!p) { was.length = 0; navDir = null; return; }
      const hit = (i) => down(p, i) && !was[i];
      const combat = inCombat();
      if (hit(START)) onPause();
      if (!combat) {
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        const dir = down(p, UP) || ay < -NAV_AT ? "u" : down(p, DOWN) || ay > NAV_AT ? "d" : down(p, LEFT) || ax < -NAV_AT ? "l" : down(p, RIGHT) || ax > NAV_AT ? "r" : null;
        if (dir !== navDir) { navDir = dir; navT = REPEAT_FIRST; if (dir) go(dir); }
        else if (dir && (navT -= dt) <= 0) { navT = REPEAT; go(dir); }
        if (hit(A)) {
          const root = menuRoot(), list = root ? targets(root) : [], cur = root && current(root, list);
          if (cur && document.activeElement === cur) cur.click();
          else if (cur) focus(cur);
        }
        if (hit(B)) back();
        const sy = p.axes[3] || 0;   // right stick scrolls the menu
        if (Math.abs(sy) > DEAD) { const root = menuRoot(); if (root) root.scrollTop += sy * SCROLL * dt; }
      } else navDir = null;
      for (let i = 0; i < p.buttons.length; i++) was[i] = down(p, i);
    },
  };
  function go(d) { nav(d === "l" ? -1 : d === "r" ? 1 : 0, d === "u" ? -1 : d === "d" ? 1 : 0); }
}

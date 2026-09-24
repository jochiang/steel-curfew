// Movement input: keyboard, plus a floating virtual stick for touch (and mouse drag).
// The stick appears wherever the finger lands and its base follows the finger when dragged
// past the rim, so direction changes never need a long thumb trip back.

const KEYS = {
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

export const STICK_RADIUS = 56;   // CSS px
const DEADZONE = 0.12;

export function createInput(surface) {
  const held = new Set();
  const stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };

  addEventListener("keydown", (e) => { if (KEYS[e.code]) { held.add(e.code); e.preventDefault(); } });
  addEventListener("keyup", (e) => held.delete(e.code));
  addEventListener("blur", () => { held.clear(); release(); });

  surface.addEventListener("pointerdown", (e) => {
    if (stick.active || (e.pointerType === "mouse" && e.button !== 0)) return;
    stick.active = true; stick.id = e.pointerId;
    stick.ox = stick.x = e.clientX; stick.oy = stick.y = e.clientY;
    surface.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  surface.addEventListener("pointermove", (e) => {
    if (!stick.active || e.pointerId !== stick.id) return;
    stick.x = e.clientX; stick.y = e.clientY;
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
    if (d > STICK_RADIUS) {   // drag the base along
      stick.ox = stick.x - (dx / d) * STICK_RADIUS;
      stick.oy = stick.y - (dy / d) * STICK_RADIUS;
    }
  });
  const end = (e) => { if (e.pointerId === stick.id) release(); };
  surface.addEventListener("pointerup", end);
  surface.addEventListener("pointercancel", end);
  surface.addEventListener("lostpointercapture", end);
  function release() { stick.active = false; stick.id = -1; }

  return {
    stick,
    /** Movement vector with length 0..1 */
    move() {
      if (stick.active) {
        let dx = (stick.x - stick.ox) / STICK_RADIUS, dy = (stick.y - stick.oy) / STICK_RADIUS;
        const m = Math.hypot(dx, dy);
        if (m < DEADZONE) return { x: 0, y: 0 };
        const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE) / 0.85) / m;   // full speed at 85% deflection
        return { x: dx * k, y: dy * k };
      }
      let x = 0, y = 0;
      for (const c of held) { x += KEYS[c][0]; y += KEYS[c][1]; }
      const m = Math.hypot(x, y);
      return m ? { x: x / m, y: y / m } : { x: 0, y: 0 };
    },
    reset() { held.clear(); release(); },
  };
}

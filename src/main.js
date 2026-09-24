import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import "./style.css";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";
import { newRun, update, nextWave, startWave } from "./game.js";
import { show, renderTitle, renderHangar, renderPaused, renderEnd, updateHud } from "./ui.js";
import { botMove, botShop } from "./bot.js";

// URL knobs for testing: ?start=lance&vent=energy&target=nearest&seed=1&wave=3&go (skip title) &bot (autopilot) &ts=4 (time scale)
const params = new URLSearchParams(location.search);
const BOT = params.has("bot");
const TIME_SCALE = Math.max(0.1, Math.min(16, +params.get("ts") || 1));
const STEP = 1 / 60;

const canvas = document.getElementById("game");
if (params.has("sheet")) { (await import("./sheet.js")).drawSheet(canvas); throw new Error("sprite sheet mode"); }
const hudEl = document.getElementById("hud");
const input = createInput(canvas);
const renderer = createRenderer(canvas);

const opts = {
  start: params.get("start") || "autocannon",
  ventMode: params.get("vent") === "energy" ? "energy" : "all",
  seed: params.has("seed") ? +params.get("seed") : null,
  targeting: params.get("target") || "crowd",
};
let run = null, paused = false, acc = 0, last = performance.now(), shownPhase = "";

function deploy() {
  run = newRun({ seed: opts.seed ?? (Date.now() & 0xffffffff), start: opts.start, ventMode: opts.ventMode, targeting: opts.targeting });
  if (params.has("wave")) { run.wave = Math.max(0, Math.min(4, +params.get("wave") - 1)); startWave(run); }
  paused = false; acc = 0; shownPhase = "";
  input.reset();
  syncScreens();
}

function toTitle() {
  run = null; paused = false;
  hudEl.hidden = true;
  renderTitle(opts, deploy);
}

function syncScreens() {
  if (!run) return;
  const key = run.phase + (paused ? "+p" : "");
  if (key === shownPhase) return;
  shownPhase = key;
  hudEl.hidden = run.phase !== "combat";
  if (run.phase === "combat") {
    if (paused) renderPaused(run, resume, toTitle);
    else show(null);
  } else if (run.phase === "hangar") {
    input.reset();
    if (BOT) { botShop(run); setTimeout(() => { nextWave(run); syncScreens(); }, 400); }
    renderHangar(run, () => { opts.targeting = run.targeting; nextWave(run); syncScreens(); });
  } else {
    renderEnd(run, deploy, toTitle);
  }
}

function pause() { if (run?.phase === "combat" && !paused) { paused = true; input.reset(); syncScreens(); } }
function resume() { paused = false; last = performance.now(); syncScreens(); }

hudEl.querySelector(".pause").addEventListener("click", pause);
addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") paused ? resume() : pause();
});
if (!BOT) {
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  addEventListener("blur", pause);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (run && run.phase === "combat" && !paused && run.freeze > 0) run.freeze -= dt;
  else if (run && run.phase === "combat" && !paused) {
    acc += dt * TIME_SCALE;
    let steps = 0;
    const maxSteps = Math.ceil(6 * TIME_SCALE);
    while (acc >= STEP && steps++ < maxSteps) {
      update(run, STEP, BOT ? botMove(run) : input.move());
      acc -= STEP;
      if (run.phase !== "combat") { acc = 0; break; }
    }
    if (steps > maxSteps) acc = 0;
    syncScreens();
  }
  if (run) {
    renderer.draw(run, dt, input);
    if (run.phase === "combat") updateHud(run);
  }
  requestAnimationFrame(frame);
}

// test hook
window.__mech = { get run() { return run; }, get paused() { return paused; }, deploy, pause, resume, opts };

if (params.has("go")) deploy(); else toTitle();
requestAnimationFrame(frame);

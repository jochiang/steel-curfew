import "@fontsource/pixelify-sans/500.css";
import "@fontsource/pixelify-sans/700.css";
import "./style.css";
import { createInput } from "./input.js";
import { createRenderer } from "./render.js";
import { newRun, update, nextWave, startWave, darkness, stayOut, rainAt } from "./game.js";
import { show, renderTitle, renderHangar, renderLevelUp, renderPaused, renderEnd, updateHud } from "./ui.js";
import { botMove, botShop, botLevelUp } from "./bot.js";
import { play, setRain } from "./audio.js";
import { toggle as toggleFullscreen, syncButtons as syncFs } from "./fullscreen.js";
import { updateMusic, stinger, musicState } from "./music.js";
import { WAVES } from "./content.js";
import { getMeta, saveSettings, allowedWeapons, recordProgress, recordEnd, saveRun, loadRun, savedRunSummary, unlockForSession } from "./meta.js";

// URL knobs for testing: ?chassis=bulwark&start=lance&vent=energy&target=nearest&seed=1&wave=3&tod=night&go (skip title) &bot (autopilot) &endless (bot stays out) &ts=4 (time scale)
const params = new URLSearchParams(location.search);
const BOT = params.has("bot");
const TIME_SCALE = Math.max(0.1, Math.min(16, +params.get("ts") || 1));
const STEP = 1 / 60;

const canvas = document.getElementById("game");
if (params.has("sheet")) { (await import("./sheet.js")).drawSheet(canvas); throw new Error("sprite sheet mode"); }
if (params.has("sheet2")) { (await import("./sheet2.js")).drawSheet2(canvas); throw new Error("sprite sheet mode"); }
const hudEl = document.getElementById("hud");
const input = createInput(canvas);
const renderer = createRenderer(canvas);
renderer.setZoom(getMeta().settings.zoom || "normal");

if (params.has("unlockall")) unlockForSession();
const saved = getMeta().settings;   // last choices, unless the URL says otherwise
const opts = {
  chassis: params.get("chassis") || saved.chassis || "warden",
  start: params.get("start") || saved.start || "autocannon",
  ventMode: params.get("vent") === "energy" ? "energy" : "all",   // full shutdown; ?vent=energy keeps the old test mode
  seed: params.has("seed") ? +params.get("seed") : null,
  targeting: params.get("target") || saved.targeting || "crowd",
  tod: params.get("tod"),
};
let run = null, paused = false, acc = 0, last = performance.now(), shownPhase = "";

function deploy() {
  if (!BOT) saveSettings({ chassis: opts.chassis, start: opts.start, targeting: opts.targeting });
  run = newRun({ seed: opts.seed ?? (Date.now() >>> 0), chassis: opts.chassis, start: opts.start, ventMode: opts.ventMode, targeting: opts.targeting, tod: opts.tod, allowed: allowedWeapons() });
  if (params.has("wave")) { run.wave = Math.max(0, Math.min(40, +params.get("wave") - 1)); run.endless = run.wave >= WAVES.length; startWave(run); }   // ?wave=6 is past curfew +1
  paused = false; acc = 0; shownPhase = "";
  input.reset();
  syncScreens();
}

function toTitle() {
  if (run && !run.ended && run.phase === "combat") { run.ended = true; recordEnd(run); }   // abandoned
  run = null; paused = false;
  hudEl.hidden = true;
  renderTitle(opts, deploy, resumeRun);
}

function resumeRun() {
  const r = loadRun(newRun);
  if (!r) return toTitle();
  run = r; paused = false; acc = 0; shownPhase = "";
  input.reset();
  syncScreens();
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
  } else if (run.phase === "levelup") {
    input.reset();
    recordProgress(run, run.wave + 2); saveRun(run);
    if (BOT) { setTimeout(() => { botLevelUp(run); syncScreens(); }, 300); }
    renderLevelUp(run, syncScreens);
  } else if (run.phase === "hangar") {
    input.reset();
    recordProgress(run, run.wave + 2); saveRun(run);
    if (BOT) { botShop(run); setTimeout(() => { nextWave(run); syncScreens(); }, 400); }
    renderHangar(run, () => { opts.targeting = run.targeting; nextWave(run); syncScreens(); });
  } else {
    if (!run.ended) { run.ended = true; recordEnd(run); }
    if (BOT && run.phase === "won" && params.has("endless")) setTimeout(stay, 400);
    renderEnd(run, deploy, toTitle, stay);
  }
}

function stay() {   // after the wave-5 boss: carry on past curfew instead of extracting
  if (run?.phase !== "won") return;
  stayOut(run); run.ended = false;
  syncScreens();
}

function pause() { if (run?.phase === "combat" && !paused) { paused = true; input.reset(); syncScreens(); } }
function resume() { paused = false; last = performance.now(); syncScreens(); }

hudEl.querySelector(".pause").addEventListener("click", pause);
hudEl.querySelector(".fs").addEventListener("click", () => toggleFullscreen());
syncFs();
addEventListener("keydown", (e) => {
  if (e.code === "Escape" || e.code === "KeyP") paused ? resume() : pause();
  if (e.code === "KeyF" && !e.repeat && !(e.target instanceof HTMLInputElement)) toggleFullscreen();
});
if (!BOT) {
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  addEventListener("blur", pause);
}

// One bad frame must never freeze the game: the next frame is always scheduled first, and an
// error is reported on screen (once per message) while the loop carries on.
// The bar stays until tapped (a freeze would otherwise hide the only clue), and the title screen shows
// the saved error with a Copy button. `count` says whether it happened once or on every frame.
const seenErrors = new Map();
function reportError(err) {
  const msg = String(err?.message || err);
  const seen = seenErrors.get(msg);
  if (seen) {   // a repeat: just count it (every 60th, so an error on every frame doesn't hammer storage)
    if (++seen.count % 60 === 0 || seen.count < 5) { try { localStorage.setItem("mech.lastError", JSON.stringify(seen)); } catch {} }
    return;
  }
  console.error(err);
  const info = { msg, count: 1, stack: String(err?.stack || "").split("\n").slice(0, 8).join("\n"), at: new Date().toISOString(),
    wave: run ? run.wave + 1 : null, waveTime: run ? +run.waveTime.toFixed(1) : null, phase: run?.phase, chassis: run?.chassisKey,
    weapons: run?.weapons.map((w) => w.key + w.tier), enemies: run?.enemies.length, ua: navigator.userAgent };
  seenErrors.set(msg, info);
  try { localStorage.setItem("mech.lastError", JSON.stringify(info)); } catch {}
  let el = document.getElementById("errbar");
  if (!el) { el = document.createElement("div"); el.id = "errbar"; el.onclick = () => { el.hidden = true; }; document.body.appendChild(el); }
  el.textContent = `Something went wrong: ${msg} · wave ${info.wave ?? "-"} (tap to hide; it's saved on the title screen)`;
  el.hidden = false;
}

let lastFrameAt = performance.now(), simSeen = { t: -1, at: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  lastFrameAt = performance.now();
  try { step(now); } catch (err) { reportError(err); }
}

// Watchdog for freezes that throw nothing: the browser stops giving us frames, or frames arrive but
// the simulation doesn't advance, or the canvas loses its graphics context. Runs on a timer (like the
// music), so it still fires when the frame loop doesn't; whatever it sees lands in mech.lastError.
setInterval(() => {
  if (!run || run.phase !== "combat" || paused || document.visibilityState !== "visible") { simSeen.t = -1; return; }
  const now = performance.now();
  if (now - lastFrameAt > 2500) reportError(new Error(`no frames for ${((now - lastFrameAt) / 1000).toFixed(0)}s`));
  if (run.waveTime !== simSeen.t) simSeen = { t: run.waveTime, at: now };
  else if (now - simSeen.at > 3000) reportError(new Error(`simulation stuck at ${run.waveTime.toFixed(1)}s (freeze ${run.freeze}, player ${Math.round(run.player.x)},${Math.round(run.player.y)})`));
}, 1000);
canvas.addEventListener("contextlost", () => reportError(new Error("the screen lost its graphics context")));
canvas.addEventListener("contextrestored", () => reportError(new Error("graphics context restored")));

function step(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
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
  updateMusic(musicContext(), dt);
  setRain(run?.phase === "combat" ? rainAt(darkness(run)) * (paused ? 0.35 : 1) : 0);   // the rain hiss follows the weather
  if (run) {
    for (const e of run.events) {   // musical punctuation for the big moments
      if (e.type === "waveClear") stinger(run.wave === WAVES.length - 1 && !run.endless ? "won" : "clear");
      else if (e.type === "spawnBoss") stinger("boss");
      else if (e.type === "dead") stinger("dead");
    }
    play(run.events);
    renderer.draw(run, dt, input);
    if (run.phase === "combat") updateHud(run);
  }
}

// What the score should be doing right now
function musicContext() {
  if (!run) return { mode: "title" };
  if (run.phase === "hangar" || run.phase === "levelup") return { mode: "hangar" };
  if (run.phase !== "combat") return { mode: "over" };
  const p = run.player;
  let near = 0, boss = false;
  for (const e of run.enemies) {
    if (e.d.boss) boss = true;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < 170) near += (e.d.boss ? 6 : e.d.mass >= 3 ? 3 : e.elite ? 2 : 1) * (d < 80 ? 1.5 : 1);
  }
  return {
    mode: "combat", boss, paused, vent: run.cap.vent > 0, darkness: darkness(run),
    threat: Math.min(1, near / 28 + run.wave * 0.08),
    danger: p.hp / run.stats.maxHp < 0.35 ? 1 : 0,
  };
}

// test hook
window.__mech = { get run() { return run; }, get paused() { return paused; }, deploy, pause, resume, opts };

if (params.has("go")) deploy(); else toTitle();
window.__mech.resumeRun = resumeRun;
window.__mech.music = musicState;
window.__mech.lastError = () => { try { return JSON.parse(localStorage.getItem("mech.lastError")); } catch { return null; } };
window.__mech.renderer = renderer;
addEventListener("mech:zoom", (e) => renderer.setZoom(e.detail));
requestAnimationFrame(frame);

import { WEAPONS, MODULES, WAVES, TIER_NAMES, TARGETING, CHASSIS, HARDPOINT, PERKS, XP, armorMul, waveDef, pastCurfew } from "./content.js";

const waveName = (w) => (pastCurfew(w) ? `Past curfew +${pastCurfew(w)}` : `Wave ${w + 1}`);
import {
  blocked, buy, reroll, rerollCost, combine, combinable, sell, sellValue, weaponDmg, speedOf, capTimes, canMount, buyMerges, darkness, timeLabel,
  choosePerk, rerollPerks, perkRerollCost, capacityOf,
} from "./game.js";
import { ui as sfx, sfxVolume, setSfxVolume } from "./audio.js";
import { musicVolume, setMusicVolume } from "./music.js";
import { mechFrames } from "./art.js";
import { afterAction, billSoFar } from "./report.js";
import { isUnlocked, UNLOCKS, getMeta, setUnlockAll, savedRunSummary, saveSettings } from "./meta.js";
import { toggle as toggleFullscreen, syncButtons as syncFs, isIOS, standalone, supported as fsSupported } from "./fullscreen.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const FAM = { ballistic: "Ballistic", energy: "Energy", melee: "Melee", module: "Module" };
const fmt = (n) => (Math.round(n * 10) / 10).toString();


export function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
}

// ---------------------------------------------------------------- settings (a sheet over the title or the pause screen)
const ZOOMS_UI = [["close", "Close"], ["normal", "Normal"], ["wide", "Wide"]];
export function openSettings(onClose) {
  document.getElementById("settings")?.remove();
  const el = document.createElement("div");
  el.id = "settings"; el.className = "settings-overlay";
  const zoom = getMeta().settings.zoom || "close", pct = (v) => Math.round(v * 100);
  el.innerHTML = `
    <div class="panel small-panel settings-panel" role="dialog" aria-label="Settings">
      <h2>Settings</h2>
      <label class="set-row"><span>Music</span><input type="range" min="0" max="100" step="5" value="${pct(musicVolume())}" data-vol="music"><output>${pct(musicVolume())}%</output></label>
      <label class="set-row"><span>Effects</span><input type="range" min="0" max="100" step="5" value="${pct(sfxVolume())}" data-vol="sfx"><output>${pct(sfxVolume())}%</output></label>
      <div class="set-row"><span>Zoom</span><div class="seg seg3">${ZOOMS_UI.map(([k, n]) => `<button data-zoomset="${k}" class="${zoom === k ? "on" : ""}">${n}</button>`).join("")}</div></div>
      ${fsSupported() ? `<button class="ghost" data-fs>${document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"}</button>`
        : isIOS() && !standalone() ? `<p class="ios-tip">For fullscreen on iPhone: Share → Add to Home Screen, then play from the icon.</p>` : ""}
      <label class="toggle"><input type="checkbox" data-shaders ${getMeta().settings.shaders !== false ? "checked" : ""}> Shader effects <em>(bloom, heat haze, shockwaves)</em></label>
      <label class="toggle"><input type="checkbox" data-unlockall ${getMeta().unlockAll ? "checked" : ""}> Unlock everything <em>(for testing)</em></label>
      <button class="primary" data-close>Done</button>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("input", (e) => {
    const r = e.target.closest("[data-vol]"); if (!r) return;
    const v = +r.value / 100;
    (r.dataset.vol === "music" ? setMusicVolume : setSfxVolume)(v);
    r.nextElementSibling.textContent = `${r.value}%`;
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.vol === "sfx") sfx("click");   // hear the new level
    if ("unlockall" in e.target.dataset) setUnlockAll(e.target.checked);
    if ("shaders" in e.target.dataset) { saveSettings({ shaders: e.target.checked }); dispatchEvent(new CustomEvent("mech:shaders", { detail: e.target.checked })); }
  });
  el.onclick = (e) => {
    if (e.target === el) return close();   // tap outside the panel
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.zoomset) {
      saveSettings({ zoom: b.dataset.zoomset }); dispatchEvent(new CustomEvent("mech:zoom", { detail: b.dataset.zoomset }));
      el.querySelectorAll("[data-zoomset]").forEach((x) => x.classList.toggle("on", x === b)); sfx("click");
    }
    if ("fs" in b.dataset) toggleFullscreen().then(() => { b.textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"; });
    if ("close" in b.dataset) { sfx("click"); close(); }
  };
  function close() { el.remove(); onClose?.(); }
}

// ---------------------------------------------------------------- title
const HP_LABEL = { E: "Energy", B: "Ballistic", M: "Melee", U: "Universal" };
const hpChips = (list) => list.map((h) => `<i class="hp-chip hp-${h}" title="${HP_LABEL[h]} hardpoint">${h}</i>`).join("");
const statBar = (v, max) => `<span class="sbar"><i style="width:${Math.round(Math.min(1, v / max) * 100)}%"></i></span>`;

/** The last error the game saved (see reportError in main.js), so a freeze can be reported after a reload */
function lastErrorBox() {
  let e = null;
  try { e = JSON.parse(localStorage.getItem("mech.lastError")); } catch {}
  if (!e) return "";
  const when = new Date(e.at), ago = Math.round((Date.now() - when) / 60000);
  const bits = [`wave ${e.wave ?? "-"}${e.waveTime != null ? ` at ${e.waveTime}s` : ""}`, e.phase, [e.chassis, (e.weapons || []).join(",")].filter(Boolean).join(" "), e.enemies != null && `${e.enemies} enemies`];
  const text = `${e.msg}${e.count > 1 ? ` (x${e.count})` : ""} · ${bits.filter(Boolean).join(" · ")}${e.stack ? "\n" + e.stack : ""}`;
  return `<div class="lasterr"><b>Last error</b> (${ago < 90 ? ago + " min" : Math.round(ago / 60) + " h"} ago). Send this to get it fixed:<code>${esc(text)}</code><button class="ghost" data-copyerr>Copy</button><button class="ghost" data-clearerr>Dismiss</button></div>`;
}

export function renderTitle(opts, onDeploy, onResume) {
  const el = $("#title"), meta = getMeta(), car = meta.career, resume = savedRunSummary();
  if (!isUnlocked("chassis", opts.chassis)) opts.chassis = "warden";
  const ch = CHASSIS[opts.chassis] || CHASSIS.warden;
  const usable = (k) => canMount(ch, WEAPONS[k].family) && isUnlocked("weapons", k);
  if (!usable(opts.start)) opts.start = Object.keys(WEAPONS).find(usable);
  const frames = Object.entries(CHASSIS).map(([k, c]) => `
    ${isUnlocked("chassis", k) ? `<button class="frame${opts.chassis === k ? " on" : ""}" data-chassis="${k}">` : `<button class="frame locked" disabled title="${esc(UNLOCKS.chassis[k].req)}">`}
      <canvas class="frame-art" data-art="${k}" width="25" height="25" aria-hidden="true"></canvas>
      <span class="frame-text"><span class="tag">${esc(c.cls)}</span><b>${esc(c.name)}</b>
        <span class="frame-stats">
          <span>HP</span>${statBar(c.hp, 90)}<span>SPD</span>${statBar(c.speed, 100)}<span>TON</span>${statBar(c.capacity, 85)}
        </span>
        <span class="chips">${isUnlocked("chassis", k) ? hpChips(c.hardpoints) : `<span class="lock-req">🔒 ${esc(UNLOCKS.chassis[k].req)}</span>`}</span>
      </span>
    </button>`).join("");
  const card = ([k, w]) => isUnlocked("weapons", k) ? `
    <button class="pick compact fam-${w.family}${opts.start === k ? " on" : ""}" data-start="${k}"><b>${esc(w.name)}</b></button>` : `
    <button class="pick compact locked" disabled><b>${esc(w.name)}</b><small class="lock-req">🔒 ${esc(UNLOCKS.weapons[k].req)}</small></button>`;
  const cards = ["ballistic", "energy", "melee"].map((fam) => {
    const list = Object.entries(WEAPONS).filter(([, w]) => w.family === fam && canMount(ch, fam));
    return list.length ? `<div class="picks-group"><span class="fam-label fam-${fam}">${FAM[fam]}</span><div class="picks">${list.map(card).join("")}</div></div>` : "";
  }).join("");
  const sel = WEAPONS[opts.start];
  el.innerHTML = `
    <div class="panel title-panel">
      <div class="title-head"><h1>STEEL<span>CURFEW</span></h1><canvas class="title-mech" width="25" height="25" aria-hidden="true"></canvas>
        <button class="gear" data-settings aria-label="Settings"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm6.3 3.7-.1-1.8 1.4-1.1-1.5-2.6-1.7.6a5.8 5.8 0 0 0-1.5-.9L10.6 1H7.4L7 3.1c-.5.2-1 .5-1.5.9l-1.7-.6L2.4 6l1.4 1.1-.1.9.1.9-1.4 1.1 1.5 2.6 1.7-.6c.5.4 1 .7 1.5.9l.4 2.1h3.1l.4-2.1c.5-.2 1-.5 1.5-.9l1.7.6 1.5-2.6z"/></svg></button></div>
      <p class="sub tagline">Hold the city until curfew. Try not to flatten it doing so.</p>
      ${car.runs ? `<p class="sub career">Best: wave ${Math.min(car.bestWave, WAVES.length)}${car.bestCurfew ? `, +${car.bestCurfew} past curfew` : ""} · ${car.runs} run${car.runs > 1 ? "s" : ""}${car.wins ? ` · ${car.wins} won` : ""}</p>` : ""}
      ${lastErrorBox()}
      ${resume ? `<button class="resume" data-resume>Resume run <span>${resume.curfew ? `past curfew +${resume.curfew}` : `wave ${resume.wave}`} · ${esc(CHASSIS[resume.chassis]?.name || "")} · pilot level ${resume.level}</span></button>` : ""}
      <h3>Frame</h3>
      <div class="frames">${frames}</div>
      <p class="pick-desc frame-desc"><b>${esc(ch.name)}:</b> ${esc(ch.blurb)} <em>${esc(ch.quirk)}.</em></p>
      <h3>Starting weapon</h3>
      <div class="pick-groups">${cards}</div>
      <p class="pick-desc fam-${sel.family}"><b>${esc(sel.name)}:</b> ${esc(sel.desc)}</p>
      <button class="primary" data-deploy>Deploy</button>
      <p class="hint">${matchMedia("(pointer: coarse)").matches ? "Drag anywhere to move." : "Move with <kbd>WASD</kbd> or the arrow keys."} Your weapons aim and fire on their own.</p>
    </div>`;
  syncFs();
  const le = el.querySelector(".lasterr");
  if (le) le.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if ("copyerr" in b.dataset) { const text = localStorage.getItem("mech.lastError") || ""; navigator.clipboard?.writeText(text).then(() => (b.textContent = "Copied"), () => (b.textContent = "Copy failed: select the text")); }
    if ("clearerr" in b.dataset) { try { localStorage.removeItem("mech.lastError"); } catch {} le.remove(); }
  };
  for (const cv of el.querySelectorAll(".frame-art")) {
    const f = mechFrames(cv.dataset.art, false)[0], g = cv.getContext("2d");
    g.drawImage(f, (cv.width - f.width) >> 1, cv.height - f.height);
  }
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("settings" in b.dataset) { sfx("click"); return openSettings(() => renderTitle(opts, onDeploy, onResume)); }
    sfx("click");
    if ("resume" in b.dataset) return onResume();
    if (b.dataset.chassis) opts.chassis = b.dataset.chassis;
    if (b.dataset.start) opts.start = b.dataset.start;
    if ("deploy" in b.dataset) return onDeploy();
    const scroll = el.scrollTop;
    renderTitle(opts, onDeploy);
    el.scrollTop = scroll;
  };
  show("title");
  animateTitleMech($(".title-mech", el), opts.chassis);
}

// the chosen frame idling/walking in place next to the logo
let titleAnim = 0;
const titleFrames = {};
function animateTitleMech(cv, kind) {
  cancelAnimationFrame(titleAnim);
  titleFrames[kind] ??= { cold: mechFrames(kind, false), hot: mechFrames(kind, true, 0) };
  const fr = titleFrames[kind], g = cv.getContext("2d");
  const tick = (t) => {
    if (!cv.isConnected) return;
    const s = t / 1000, walking = s % 6 < 4, hot = s % 6 > 4.6;
    const f = (hot ? fr.hot : fr.cold)[walking ? Math.floor(s * 7) % 4 : 0];
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(f, (cv.width - f.width) >> 1, cv.height - f.height);
    titleAnim = requestAnimationFrame(tick);
  };
  titleAnim = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- hangar
let selected = -1;

export function renderHangar(run, onDeploy) {
  const el = $("#hangar");
  const s = run.stats, times = capTimes(run), next = run.wave + 2;
  const offers = run.shop.offers.map((o, i) => {
    const def = o.kind === "weapon" ? WEAPONS[o.key] : MODULES[o.key];
    const why = blocked(run, o);
    const fam = o.kind === "weapon" ? def.family : "module";
    const merge = !why && buyMerges(run, o);
    return `
      <div class="offer fam-${fam}${o.sold ? " sold" : ""}${o.locked ? " locked" : ""}">
        <div class="offer-top"><span class="tag">${FAM[fam]}</span>
          ${o.sold ? "" : `<button class="lock" data-lock="${i}" aria-label="${o.locked ? "Unlock" : "Lock"}" aria-pressed="${o.locked}">${o.locked ? "Locked" : "Lock"}</button>`}</div>
        <b>${esc(def.name)}${o.kind === "weapon" ? ` <em>${TIER_NAMES[o.tier]}</em>` : ""}</b>
        <small>${esc(def.desc)}</small>
        <div class="offer-meta">${o.kind === "weapon" ? statLine(def, o.tier) : ""}<span>${def.weight} t</span></div>
        ${o.sold ? `<div class="soldmark">Bought</div>` : `<button class="buy${why === "Can't afford" ? " poor" : ""}" data-buy="${i}" ${why ? "disabled" : ""}>
          ${why && why !== "Can't afford" ? esc(why) : `◆ ${o.price}${merge ? " · merge" : ""}`}</button>`}
      </div>`;
  }).join("");

  const slots = run.chassis.hardpoints.map((h, hi) => {
    const i = run.mounts[hi], w = run.weapons[i];
    if (!w) return `<div class="slot empty hp-${h}"><i class="hp-chip hp-${h}">${h}</i>${HP_LABEL[h].toLowerCase()} hardpoint</div>`;
    const def = WEAPONS[w.key], open = selected === i;
    return `
      <div class="slot fam-${def.family}${open ? " open" : ""}">
        <button class="slot-main" data-slot="${i}"><b><i class="hp-chip hp-${h}">${h}</i>${esc(def.name)} <em>${TIER_NAMES[w.tier]}</em></b>
          <small>${fmt(weaponDmg(run, w))} dmg · ${def.weight} t</small></button>
        ${open ? `<div class="slot-actions">
          <button data-combine="${i}" ${combinable(run, i) ? "" : "disabled"}>Combine → ${TIER_NAMES[Math.min(3, w.tier + 1)]}</button>
          <button data-sell="${i}" ${run.weapons.length > 1 ? "" : "disabled"}>Sell ◆ ${sellValue(run, i)}</button>
        </div>` : ""}
      </div>`;
  }).join("");

  const counts = {};
  for (const m of run.modules) counts[m] = (counts[m] || 0) + 1;
  const mods = Object.entries(counts).map(([k, n]) => `<span class="chip" title="${esc(MODULES[k].desc)}">${esc(MODULES[k].name)}${n > 1 ? ` ×${n}` : ""}</span>`).join("") || `<span class="none">none yet</span>`;
  const loadPct = Math.min(100, (run.load / capacityOf(run)) * 100);
  const targeting = times ? `
          <h3>Capacitor targeting</h3>
          <div class="seg seg3" role="radiogroup">${Object.entries(TARGETING).map(([k, t]) =>
            `<button data-target="${k}" class="${run.targeting === k ? "on" : ""}" role="radio" aria-checked="${run.targeting === k}"><b>${t.name}</b></button>`).join("")}</div>
          <p class="seg-desc">${esc(TARGETING[run.targeting].desc)}</p>` : "";

  el.innerHTML = `
    <div class="panel hangar-panel">
      <header>
        <div><h2>Hangar</h2><p class="sub">${waveName(run.wave)} survived · next: ${run.endless ? waveName(run.wave + 1) : `wave ${next} of ${WAVES.length}`}</p>
          ${billSoFar(run) ? `<p class="sub bill">${esc(billSoFar(run))}</p>` : ""}
          ${(run.unlocks || []).filter((u) => !u.seen).map((u) => `<p class="unlock">Unlocked: <b>${esc(u.name)}</b>${u.kind === "weapons" ? " · now in the market" : ""}</p>`).join("")}</div>
        <div class="purse">◆ <b>${run.salvage}</b></div>
      </header>
      <div class="cols">
        <div class="market">
          <div class="row"><h3>Parts market</h3>
            <button class="reroll" data-reroll ${run.salvage < rerollCost(run) ? "disabled" : ""}>Reroll ◆ ${rerollCost(run)}</button></div>
          <div class="offers">${offers}</div>
        </div>
        <div class="loadout">
          ${targeting}
          <h3>Hardpoints <em>${run.weapons.length}/${run.chassis.hardpoints.length}</em></h3>
          <div class="slots">${slots}</div>
          <h3>Modules</h3>
          <div class="chips">${mods}</div>
          <h3>Pilot <em>level ${run.level}</em></h3>
          <div class="chips">${perkChips(run)}</div>
          <h3>Frame · ${esc(run.chassis.name)} <em>${esc(run.chassis.quirk)}</em></h3>
          <div class="load"><div class="bar"><i style="width:${loadPct}%"></i></div><span>${run.load} / ${capacityOf(run)} t</span></div>
          <dl class="stats">
            <dt>Hull</dt><dd>${s.maxHp}</dd>
            <dt>Armor</dt><dd>${s.armor} <small>(−${Math.round((1 - armorMul(s.armor)) * 100)}% dmg)</small></dd>
            ${s.dodge ? `<dt>Glance</dt><dd>${Math.round(s.dodge * 100)}% <small>of hits</small></dd>` : ""}
            <dt>Speed</dt><dd>${Math.round(speedOf(run))} <small>px/s</small></dd>
            <dt>Repair</dt><dd>${fmt(s.regen)} <small>HP/s</small></dd>
            <dt>Capacitor</dt><dd>${times ? `${fmt(times.fill)}s charge · ${fmt(times.vent)}s vent` : "<small>no energy weapons</small>"}</dd>
            <dt>Vent mode</dt><dd>${run.ventMode === "all" && !s.isolatedLoops ? "full shutdown" : "energy only"}</dd>
          </dl>
        </div>
      </div>
      <footer><button class="primary" data-deploy>Deploy · ${run.endless ? waveName(run.wave + 1).toLowerCase() : `wave ${next}`}</button></footer>
    </div>`;

  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const d = b.dataset;
    if ("deploy" in d) { selected = -1; sfx("click"); for (const u of run.unlocks || []) u.seen = true; return onDeploy(); }
    sfx(d.buy && buy(run, +d.buy) ? "buy" : "click");
    if (d.lock) run.shop.offers[+d.lock].locked = !run.shop.offers[+d.lock].locked;
    else if ("reroll" in d) reroll(run);
    else if (d.target) run.targeting = d.target;
    else if (d.slot) selected = selected === +d.slot ? -1 : +d.slot;
    else if (d.combine) { combine(run, +d.combine); selected = -1; }
    else if (d.sell) { sell(run, +d.sell); selected = -1; }
    const scroll = el.scrollTop;
    renderHangar(run, onDeploy);
    el.scrollTop = scroll;
  };
  show("hangar");
}

function perkChips(run) {
  if (!run.perks.length) return `<span class="none">no upgrades yet</span>`;
  const counts = {};
  for (const pk of run.perks) { const k = pk.key + (pk.rare ? "*" : ""); counts[k] = (counts[k] || 0) + 1; }
  return Object.entries(counts).map(([k, n]) => { const key = k.replace("*", ""); return `<span class="chip${k.endsWith("*") ? " rare" : ""}">${esc(PERKS[key][0])}${n > 1 ? ` ×${n}` : ""}</span>`; }).join("");
}

function statLine(def, tier) {
  const m = [1, 1.6, 2.4, 3.5][tier];
  if (def.family === "ballistic") return `<span>${fmt(def.dmg * m)}${def.pellets > 1 ? `×${def.pellets}` : ""} dmg</span>`;
  if (def.family === "energy") return `<span>${fmt(def.dmg * m)} dmg · ${def.heat} heat</span>`;
  return `<span>${fmt(def.dmg * m)} dmg</span>`;
}

// ---------------------------------------------------------------- pilot level-up
const pct = (v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const FX_TEXT = {
  maxHp: (v) => `+${v} max HP`, armor: (v) => `+${v} armor`, speedMul: (v) => `${pct(v)} speed`, regen: (v) => `+${v} HP/s repair`,
  dmgBallistic: (v) => `${pct(v)} ballistic damage`, dmgEnergy: (v) => `${pct(v)} energy damage`, dmgMelee: (v) => `${pct(v)} melee damage`,
  rangeMul: (v) => `${pct(v)} weapon range`, reloadMul: (v) => `${pct(v)} reload time`, fillMul: (v) => `${pct(v)} capacitor charge time`,
  ventMul: (v) => `${pct(v)} vent time`, pickup: (v) => `+${v} salvage pickup range`, dodge: (v) => `${pct(v)} glance chance`,
  capacity: (v) => `+${v} t tonnage capacity`,
};
export const fxText = (fx) => Object.entries(fx).map(([k, v]) => (FX_TEXT[k] ? FX_TEXT[k](v) : `${k} ${v}`)).join(", ");

export function renderLevelUp(run, onDone) {
  const el = $("#levelup"), lv = run.level - run.pending + 1;
  const cards = run.perkOffers.map((o, i) => `
    <button class="perk${o.rare ? " rare" : ""}" data-perk="${i}">
      <span class="tag">${o.rare ? "Rare" : "Upgrade"}</span>
      <b>${esc(PERKS[o.key][0])}</b>
      <span class="perk-fx">${esc(fxText(o.fx))}</span>
    </button>`).join("");
  el.innerHTML = `
    <div class="panel levelup-panel">
      <header>
        <div><h2>Pilot level ${lv}</h2><p class="sub">${run.pending > 1 ? `${run.pending} upgrades to choose` : "Choose an upgrade"}</p></div>
        <div class="purse">◆ <b>${run.salvage}</b></div>
      </header>
      <div class="perks">${cards}</div>
      <button class="reroll" data-reroll ${run.salvage < perkRerollCost(run) ? "disabled" : ""}>Reroll ◆ ${perkRerollCost(run)}</button>
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.perk) { choosePerk(run, +b.dataset.perk); sfx("buy"); }
    else if ("reroll" in b.dataset) { rerollPerks(run); sfx("click"); }
    if (run.phase === "levelup") renderLevelUp(run, onDone); else onDone();
  };
  show("levelup");
}

// ---------------------------------------------------------------- pause / end
export function renderPaused(run, onResume, onQuit) {
  const el = $("#paused");
  el.innerHTML = `
    <div class="panel small-panel">
      <h2>Paused</h2>
      <p class="sub">Wave ${run.wave + 1} · ${run.kills} wrecks</p>
      <button class="primary" data-resume>Resume</button>
      <button class="ghost" data-settings>Settings</button>
      <button class="ghost" data-quit>Abandon run</button>
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.settings !== undefined) { sfx("click"); return openSettings(); }
    if (b?.dataset.resume !== undefined) onResume();
    if (b?.dataset.quit !== undefined) onQuit();
  };
  show("paused");
}

/** The After-Action Report (see report.js): a Hitman-style rating on how much of the city you wrecked */
function reportHtml(run) {
  const r = afterAction(run), c = r.collateral, k = r.combat;
  const bars = k.byWeapon.slice(0, 5).map((w) => `<li><span>${esc(w.name)}</span><i style="width:${Math.max(2, w.pct)}%"></i><b>${w.dmg}</b></li>`).join("");
  return `<section class="aar">
    <p class="aar-kicker">After-action report · ${esc(r.status)}</p>
    <p class="aar-title">${esc(r.title)}</p>
    <p class="aar-quote">“${esc(r.quote)}”<small>the Mayor</small></p>
    <div class="aar-bill"><span>Property damage</span><b>${r.bill.total}</b><small>${r.bill.you} yours (${r.bill.yourPct}%) · ${r.bill.invaders} the invaders'</small></div>
    <p class="aar-coll"><b>${c.leveled}</b> buildings leveled${c.leveledByInvaders ? ` <small>(+${c.leveledByInvaders} by the invaders)</small>` : ""} · <b>${c.fires}</b> fires · <b>${c.cars}</b> cars · <b>${c.lamps}</b> lamps${c.trees ? ` · <b>${c.trees}</b> trees` : ""}</p>
    ${r.medals.length ? `<ul class="aar-medals">${r.medals.map((m) => `<li><b>${esc(m.name)}</b><small>${esc(m.text)}</small></li>`).join("")}</ul>` : ""}
    ${bars ? `<ul class="aar-bars">${bars}</ul>` : ""}
    <p class="aar-line">${k.kills} kills${k.elites ? ` · ${k.elites} elites` : ""}${k.bosses ? ` · ${k.bosses} boss${k.bosses > 1 ? "es" : ""}` : ""}${k.worst ? ` · hurt most by ${esc(k.worst.name)} (${k.worst.dmg})` : ""} · salvage ${k.earned} earned, ${k.spent} spent</p>
  </section>`;
}

export function renderEnd(run, onAgain, onTitle, onStay) {
  const el = $("#end"), won = run.phase === "won", car = getMeta().career;
  const how = won ? `All ${WAVES.length} waves survived${run.m.bossKillT != null ? ", the boss is down" : ""}`
    : run.endless ? `Held ${run.curfew} wave${run.curfew === 1 ? "" : "s"} past curfew` : `Fell on wave ${run.wave + 1}`;
  el.innerHTML = `
    <div class="panel small-panel ${won || run.endless ? "won" : "lost"}">
      <h2>${won ? "City held" : "Mech destroyed"}</h2>
      <p class="sub">${how} · ${run.kills} wrecks · pilot level ${run.level} · ${Math.floor(run.time)}s</p>
      ${(run.unlocks || []).map((u) => `<p class="unlock">Unlocked: <b>${esc(u.name)}</b> <small>(${u.kind === "chassis" ? "frame" : "weapon"})</small></p>`).join("")}
      ${reportHtml(run)}
      <p class="sub career">Best wave ${Math.min(car.bestWave, WAVES.length)}${car.bestCurfew ? ` · best +${car.bestCurfew} past curfew` : ""} · ${car.runs} run${car.runs === 1 ? "" : "s"} · ${car.kills} wrecks total</p>
      ${won ? `<button class="primary stay" data-stay>Stay out past curfew<small>endless: harder every wave, a boss every third</small></button>
      <button class="ghost" data-title>Extract</button>` : `
      <button class="primary" data-again>Redeploy</button>
      <button class="ghost" data-title>Change loadout</button>`}
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.stay !== undefined) { for (const u of run.unlocks || []) u.seen = true; onStay(); }   // already announced here
    if (b?.dataset.again !== undefined) onAgain();
    if (b?.dataset.title !== undefined) onTitle();
  };
  show("end");
}

// ---------------------------------------------------------------- HUD
const hud = { el: null, last: {} };
export function updateHud(run) {
  if (!hud.el) {
    hud.el = $("#hud");
    Object.assign(hud, {
      hpBar: $(".hp i", hud.el), hpText: $(".hp span", hud.el), salvage: $(".salvage span", hud.el),
      xpBar: $(".xp i", hud.el), xpText: $(".xp span", hud.el),
      wave: $(".wave", hud.el), timer: $(".timer", hud.el), boss: $(".boss", hud.el),
      bossName: $(".boss span", hud.el), bossBar: $(".boss i", hud.el), banner: $(".banner", hud.el),
    });
  }
  const p = run.player, set = (k, v, fn) => { if (hud.last[k] !== v) { hud.last[k] = v; fn(v); } };
  set("hp", Math.ceil(p.hp) + "/" + run.stats.maxHp, (v) => (hud.hpText.textContent = v));
  set("hpw", Math.round((p.hp / run.stats.maxHp) * 1000) / 10, (v) => (hud.hpBar.style.width = v + "%"));
  set("sal", run.salvage, (v) => (hud.salvage.textContent = v));
  set("xpw", Math.round((run.xp / XP.next(run.level)) * 100), (v) => (hud.xpBar.style.width = v + "%"));
  set("xpt", `LV ${run.level}${run.pending ? ` · +${run.pending}` : ""}`, (v) => (hud.xpText.textContent = v));
  const k = pastCurfew(run.wave);
  set("wave", k ? `CURFEW +${k}` : `WAVE ${run.wave + 1}/${WAVES.length}`, (v) => (hud.wave.textContent = v));
  const left = Math.max(0, Math.ceil(waveDef(run.wave).duration - run.waveTime));
  set("timer", left, (v) => { hud.timer.textContent = v; hud.timer.classList.toggle("low", v <= 5); });
  const banner = run.clearing > 0 ? (run.wave === WAVES.length - 1 && !run.endless ? "City held" : "Wave cleared")
    : run.waveTime < 1.6 && !(run.intro && !run.intro.playing) ? `${waveName(run.wave)}${k || darkness(run) < 0.15 ? "" : ` · ${timeLabel(darkness(run))}`}` : "";
  set("banner", banner, (v) => { if (v) hud.banner.textContent = v; hud.banner.classList.toggle("show", !!v); hud.banner.classList.toggle("clear", run.clearing > 0); });
  const boss = run.enemies.find((e) => e.d.boss);
  set("boss", !!boss, (v) => (hud.boss.hidden = !v));
  if (boss) {
    set("bossName", boss.d.name, (v) => (hud.bossName.textContent = v));
    set("bossw", Math.round((boss.hp / boss.maxHp) * 1000) / 10, (v) => (hud.bossBar.style.width = Math.max(0, v) + "%"));
  }
}

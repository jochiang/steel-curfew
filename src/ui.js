import { WEAPONS, MODULES, WAVES, TIER_NAMES, TARGETING, CHASSIS, HARDPOINT, PERKS, XP, armorMul } from "./content.js";
import {
  blocked, buy, reroll, rerollCost, combine, combinable, sell, sellValue, weaponDmg, speedOf, capTimes, canMount, fits,
  choosePerk, rerollPerks, perkRerollCost, capacityOf,
} from "./game.js";
import { isMuted, setMuted, ui as sfx } from "./audio.js";
import { mechFrames } from "./art.js";
import { isUnlocked, UNLOCKS, getMeta, setUnlockAll, savedRunSummary } from "./meta.js";
import { toggle as toggleFullscreen, syncButtons as syncFs, isIOS, standalone, supported as fsSupported } from "./fullscreen.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const FAM = { ballistic: "Ballistic", energy: "Energy", melee: "Melee", module: "Module" };
const fmt = (n) => (Math.round(n * 10) / 10).toString();

const soundBtn = () => `<button class="ghost sound" data-sound aria-pressed="${!isMuted()}">Sound: ${isMuted() ? "off" : "on"}</button>`;
function toggleSound(b) { setMuted(!isMuted()); b.outerHTML = soundBtn(); sfx("click"); }

export function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
}

// ---------------------------------------------------------------- title
const HP_LABEL = { E: "Energy", B: "Ballistic", M: "Melee", U: "Universal" };
const hpChips = (list) => list.map((h) => `<i class="hp-chip hp-${h}" title="${HP_LABEL[h]} hardpoint">${h}</i>`).join("");
const statBar = (v, max) => `<span class="sbar"><i style="width:${Math.round(Math.min(1, v / max) * 100)}%"></i></span>`;

export function renderTitle(opts, onDeploy, onResume) {
  const el = $("#title"), meta = getMeta(), car = meta.career, resume = savedRunSummary();
  if (!isUnlocked("chassis", opts.chassis)) opts.chassis = "warden";
  const ch = CHASSIS[opts.chassis] || CHASSIS.warden;
  const usable = (k) => canMount(ch, WEAPONS[k].family) && isUnlocked("weapons", k);
  if (!usable(opts.start)) opts.start = Object.keys(WEAPONS).find(usable);
  const frames = Object.entries(CHASSIS).map(([k, c]) => `
    ${isUnlocked("chassis", k) ? `<button class="frame${opts.chassis === k ? " on" : ""}" data-chassis="${k}">` : `<button class="frame locked" disabled title="${esc(UNLOCKS.chassis[k].req)}">`}
      <canvas class="frame-art" data-art="${k}" width="23" height="22" aria-hidden="true"></canvas>
      <span class="frame-text"><span class="tag">${esc(c.cls)}</span><b>${esc(c.name)}</b>
        <span class="frame-stats">
          <span>HP</span>${statBar(c.hp, 90)}<span>SPD</span>${statBar(c.speed, 100)}<span>TON</span>${statBar(c.capacity, 85)}
        </span>
        <span class="chips">${isUnlocked("chassis", k) ? hpChips(c.hardpoints) : `<span class="lock-req">🔒 ${esc(UNLOCKS.chassis[k].req)}</span>`}</span>
      </span>
    </button>`).join("");
  const cards = Object.entries(WEAPONS).filter(([, w]) => canMount(ch, w.family)).map(([k, w]) => isUnlocked("weapons", k) ? `
    <button class="pick fam-${w.family}${opts.start === k ? " on" : ""}" data-start="${k}">
      <span class="tag">${FAM[w.family]}</span>
      <b>${esc(w.name)}</b>
      <small>${esc(w.desc)}</small>
    </button>` : `
    <button class="pick locked" disabled>
      <span class="tag">${FAM[w.family]}</span>
      <b>${esc(w.name)}</b>
      <small class="lock-req">🔒 ${esc(UNLOCKS.weapons[k].req)}</small>
    </button>`).join("");
  const sel = WEAPONS[opts.start];
  el.innerHTML = `
    <div class="panel title-panel">
      <div class="title-head"><h1>MECH<span>ARENA</span></h1><canvas class="title-mech" width="23" height="22" aria-hidden="true"></canvas></div>
      <p class="sub">prototype · 5 waves · procedural city${car.runs ? ` · best wave ${car.bestWave} · ${car.runs} run${car.runs > 1 ? "s" : ""}${car.wins ? ` · ${car.wins} won` : ""}` : ""}</p>
      ${resume ? `<button class="resume" data-resume>Resume run <span>wave ${resume.wave} · ${esc(CHASSIS[resume.chassis]?.name || "")} · pilot level ${resume.level}</span></button>` : ""}
      <h3>Frame</h3>
      <div class="frames">${frames}</div>
      <p class="pick-desc frame-desc"><b>${esc(ch.name)}:</b> ${esc(ch.blurb)} <em>${esc(ch.quirk)}.</em></p>
      <h3>Starting weapon</h3>
      <div class="picks">${cards}</div>
      <p class="pick-desc fam-${sel.family}"><b>${esc(sel.name)}:</b> ${esc(sel.desc)}</p>
      <h3>Vent mode <em>(testing)</em></h3>
      <div class="seg" role="radiogroup">
        <button data-vent="all" class="${opts.ventMode === "all" ? "on" : ""}"><b>Full shutdown</b><small>every weapon goes offline while venting</small></button>
        <button data-vent="energy" class="${opts.ventMode === "energy" ? "on" : ""}"><b>Energy only</b><small>ballistic + melee keep firing</small></button>
      </div>
      <label class="toggle"><input type="checkbox" data-unlockall ${meta.unlockAll ? "checked" : ""}> Unlock everything <em>(testing)</em></label>
      <button class="primary" data-deploy>Deploy</button>
      <p class="hint">Move with <kbd>WASD</kbd> / arrows, or touch and drag anywhere. Weapons fire on their own.</p>
      <div class="title-foot">${soundBtn()}<button class="ghost fs-btn" data-fs>${document.fullscreenElement ? "Exit fullscreen" : "Fullscreen"}</button></div>
      ${isIOS() && !fsSupported() && !standalone() ? `<p class="ios-tip">For fullscreen on iPhone: Share → Add to Home Screen, then play from the icon.</p>` : ""}
    </div>`;
  syncFs();
  el.querySelector("[data-unlockall]").onchange = (e) => { setUnlockAll(e.target.checked); renderTitle(opts, onDeploy, onResume); };
  for (const cv of el.querySelectorAll(".frame-art")) {
    const f = mechFrames(cv.dataset.art, false)[0], g = cv.getContext("2d");
    g.drawImage(f, (cv.width - f.width) >> 1, cv.height - f.height);
  }
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("sound" in b.dataset) return toggleSound(b);
    if ("fs" in b.dataset) { toggleFullscreen().then(() => renderTitle(opts, onDeploy, onResume)); return; }
    sfx("click");
    if ("resume" in b.dataset) return onResume();
    if (b.dataset.chassis) opts.chassis = b.dataset.chassis;
    if (b.dataset.start) opts.start = b.dataset.start;
    if (b.dataset.vent) opts.ventMode = b.dataset.vent;
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
    const merge = o.kind === "weapon" && !why && !fits(run, def.family);
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
        <div><h2>Hangar</h2><p class="sub">Wave ${run.wave + 1} survived · next: wave ${next} of ${WAVES.length}</p>
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
      <footer><button class="primary" data-deploy>Deploy · wave ${next}</button></footer>
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
      ${soundBtn()}
      <button class="ghost" data-quit>Abandon run</button>
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.sound !== undefined) return toggleSound(b);
    if (b?.dataset.resume !== undefined) onResume();
    if (b?.dataset.quit !== undefined) onQuit();
  };
  show("paused");
}

export function renderEnd(run, onAgain, onTitle) {
  const el = $("#end"), won = run.phase === "won";
  el.innerHTML = `
    <div class="panel small-panel ${won ? "won" : "lost"}">
      <h2>${won ? "Arena cleared" : "Mech destroyed"}</h2>
      <p class="sub">${won ? `All ${WAVES.length} waves survived` : `Fell on wave ${run.wave + 1}`} · ${run.kills} wrecks · pilot level ${run.level} · ${Math.floor(run.time)}s</p>
      ${(run.unlocks || []).map((u) => `<p class="unlock">Unlocked: <b>${esc(u.name)}</b> <small>(${u.kind === "chassis" ? "frame" : "weapon"})</small></p>`).join("")}
      <p class="sub career">Best wave ${getMeta().career.bestWave} · ${getMeta().career.runs} runs · ${getMeta().career.kills} wrecks total</p>
      <button class="primary" data-again>Redeploy</button>
      <button class="ghost" data-title>Change loadout</button>
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
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
  set("wave", `WAVE ${run.wave + 1}/${WAVES.length}`, (v) => (hud.wave.textContent = v));
  const left = Math.max(0, Math.ceil(WAVES[run.wave].duration - run.waveTime));
  set("timer", left, (v) => { hud.timer.textContent = v; hud.timer.classList.toggle("low", v <= 5); });
  const banner = run.clearing > 0 ? (run.wave >= WAVES.length - 1 ? "Arena cleared" : "Wave cleared")
    : run.waveTime < 1.6 ? `Wave ${run.wave + 1}${run.tod === "day" ? "" : ` · ${run.tod}`}` : "";
  set("banner", banner, (v) => { if (v) hud.banner.textContent = v; hud.banner.classList.toggle("show", !!v); hud.banner.classList.toggle("clear", run.clearing > 0); });
  const boss = run.enemies.find((e) => e.d.boss);
  set("boss", !!boss, (v) => (hud.boss.hidden = !v));
  if (boss) {
    set("bossName", boss.d.name, (v) => (hud.bossName.textContent = v));
    set("bossw", Math.round((boss.hp / boss.maxHp) * 1000) / 10, (v) => (hud.bossBar.style.width = Math.max(0, v) + "%"));
  }
}

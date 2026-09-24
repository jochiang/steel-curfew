import { WEAPONS, MODULES, WAVES, TIER_NAMES, TARGETING, armorMul } from "./content.js";
import {
  blocked, buy, reroll, rerollCost, combine, combinable, sell, sellValue, weaponDmg, speedOf, capTimes,
} from "./game.js";
import { isMuted, setMuted, ui as sfx } from "./audio.js";

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
export function renderTitle(opts, onDeploy) {
  const el = $("#title");
  const cards = Object.entries(WEAPONS).map(([k, w]) => `
    <button class="pick fam-${w.family}${opts.start === k ? " on" : ""}" data-start="${k}">
      <span class="tag">${FAM[w.family]}</span>
      <b>${esc(w.name)}</b>
      <small>${esc(w.desc)}</small>
    </button>`).join("");
  const sel = WEAPONS[opts.start];
  el.innerHTML = `
    <div class="panel title-panel">
      <h1>MECH<span>ARENA</span></h1>
      <p class="sub">greybox build · 5 waves · Warden frame</p>
      <h3>Starting weapon</h3>
      <div class="picks">${cards}</div>
      <p class="pick-desc fam-${sel.family}"><b>${esc(sel.name)}:</b> ${esc(sel.desc)}</p>
      <h3>Vent mode <em>(testing)</em></h3>
      <div class="seg" role="radiogroup">
        <button data-vent="all" class="${opts.ventMode === "all" ? "on" : ""}"><b>Full shutdown</b><small>every weapon goes offline while venting</small></button>
        <button data-vent="energy" class="${opts.ventMode === "energy" ? "on" : ""}"><b>Energy only</b><small>ballistic + melee keep firing</small></button>
      </div>
      <button class="primary" data-deploy>Deploy</button>
      <p class="hint">Move with <kbd>WASD</kbd> / arrows, or touch and drag anywhere. Weapons fire on their own.</p>
      <div class="title-foot">${soundBtn()}</div>
    </div>`;
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if ("sound" in b.dataset) return toggleSound(b);
    sfx("click");
    if (b.dataset.start) opts.start = b.dataset.start;
    if (b.dataset.vent) opts.ventMode = b.dataset.vent;
    if ("deploy" in b.dataset) return onDeploy();
    renderTitle(opts, onDeploy);
  };
  show("title");
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
    const merge = o.kind === "weapon" && !why && run.weapons.length >= run.chassis.slots;
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

  const slots = Array.from({ length: run.chassis.slots }, (_, i) => {
    const w = run.weapons[i];
    if (!w) return `<div class="slot empty">empty hardpoint</div>`;
    const def = WEAPONS[w.key], open = selected === i;
    return `
      <div class="slot fam-${def.family}${open ? " open" : ""}">
        <button class="slot-main" data-slot="${i}"><b>${esc(def.name)} <em>${TIER_NAMES[w.tier]}</em></b>
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
  const loadPct = Math.min(100, (run.load / run.chassis.capacity) * 100);
  const targeting = times ? `
          <h3>Capacitor targeting</h3>
          <div class="seg seg3" role="radiogroup">${Object.entries(TARGETING).map(([k, t]) =>
            `<button data-target="${k}" class="${run.targeting === k ? "on" : ""}" role="radio" aria-checked="${run.targeting === k}"><b>${t.name}</b></button>`).join("")}</div>
          <p class="seg-desc">${esc(TARGETING[run.targeting].desc)}</p>` : "";

  el.innerHTML = `
    <div class="panel hangar-panel">
      <header>
        <div><h2>Hangar</h2><p class="sub">Wave ${run.wave + 1} survived · next: wave ${next} of ${WAVES.length}</p></div>
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
          <h3>Hardpoints <em>${run.weapons.length}/${run.chassis.slots}</em></h3>
          <div class="slots">${slots}</div>
          <h3>Modules</h3>
          <div class="chips">${mods}</div>
          <h3>Frame · ${esc(run.chassis.name)}</h3>
          <div class="load"><div class="bar"><i style="width:${loadPct}%"></i></div><span>${run.load} / ${run.chassis.capacity} t</span></div>
          <dl class="stats">
            <dt>Hull</dt><dd>${s.maxHp}</dd>
            <dt>Armor</dt><dd>${s.armor} <small>(−${Math.round((1 - armorMul(s.armor)) * 100)}% dmg)</small></dd>
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
    if ("deploy" in d) { selected = -1; sfx("click"); return onDeploy(); }
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

function statLine(def, tier) {
  const m = [1, 1.6, 2.4, 3.5][tier];
  if (def.family === "ballistic") return `<span>${fmt(def.dmg * m)}${def.pellets > 1 ? `×${def.pellets}` : ""} dmg</span>`;
  if (def.family === "energy") return `<span>${fmt(def.dmg * m)} dmg · ${def.heat} heat</span>`;
  return `<span>${fmt(def.dmg * m)} dmg</span>`;
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
      <p class="sub">${won ? `All ${WAVES.length} waves survived` : `Fell on wave ${run.wave + 1}`} · ${run.kills} wrecks · ${Math.floor(run.time)}s</p>
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
      wave: $(".wave", hud.el), timer: $(".timer", hud.el), boss: $(".boss", hud.el),
      bossName: $(".boss span", hud.el), bossBar: $(".boss i", hud.el), banner: $(".banner", hud.el),
    });
  }
  const p = run.player, set = (k, v, fn) => { if (hud.last[k] !== v) { hud.last[k] = v; fn(v); } };
  set("hp", Math.ceil(p.hp) + "/" + run.stats.maxHp, (v) => (hud.hpText.textContent = v));
  set("hpw", Math.round((p.hp / run.stats.maxHp) * 1000) / 10, (v) => (hud.hpBar.style.width = v + "%"));
  set("sal", run.salvage, (v) => (hud.salvage.textContent = v));
  set("wave", `WAVE ${run.wave + 1}/${WAVES.length}`, (v) => (hud.wave.textContent = v));
  const left = Math.max(0, Math.ceil(WAVES[run.wave].duration - run.waveTime));
  set("timer", left, (v) => { hud.timer.textContent = v; hud.timer.classList.toggle("low", v <= 5); });
  const banner = run.clearing > 0 ? (run.wave >= WAVES.length - 1 ? "Arena cleared" : "Wave cleared")
    : run.waveTime < 1.6 ? `Wave ${run.wave + 1}` : "";
  set("banner", banner, (v) => { if (v) hud.banner.textContent = v; hud.banner.classList.toggle("show", !!v); hud.banner.classList.toggle("clear", run.clearing > 0); });
  const boss = run.enemies.find((e) => e.d.boss);
  set("boss", !!boss, (v) => (hud.boss.hidden = !v));
  if (boss) {
    set("bossName", boss.d.name, (v) => (hud.bossName.textContent = v));
    set("bossw", Math.round((boss.hp / boss.maxHp) * 1000) / 10, (v) => (hud.bossBar.style.width = Math.max(0, v) + "%"));
  }
}

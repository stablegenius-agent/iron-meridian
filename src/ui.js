// DOM interface: HUD, forces roster, dossier/operation planner, crises, comms, labels, sheets.
// Visual language follows Apple's HIG (docs/design-study.md): glass controls over the globe, one prominent
// button per view (the action bar's verb), segmented controls, inset grouped lists, Cancel-leading sheets.
import * as THREE from 'three';
import { CLASSES, CRISES, MEDALS, OPS, PROCURE, SITE_TYPES, STANCE_STYLE, UNIT_TYPES } from './data.js';
import { GLOBE_R, distanceKm, llToVec3 } from './geo.js';
import { availableOps, eligibleUnits, estimate } from './ops.js';
import { icon } from './icons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtPop = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const fmtGdp = (m) => m >= 1e6 ? '$' + (m / 1e6).toFixed(1) + 'T' : m >= 1e3 ? '$' + Math.round(m / 1e3) + 'B' : '$' + m + 'M';
const hrs = (h) => h >= 48 ? `${Math.round(h / 24)}d` : `${Math.max(0, Math.ceil(h))}h`;
// Game code speaks in ALL CAPS; the interface uses title/sentence case (HIG) but keeps acronyms.
const KEEP = new Set(['DEFCON', 'US', 'USA', 'SAM', 'SAMS', 'ICBM', 'HQ', 'UN', 'ETA', 'RTB', 'SOF', 'B-2', 'F-35', 'MQ-9', 'II', 'III']);
const SMALL = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'by']);
export const nice = (s) => {
  s = String(s);
  if (s !== s.toUpperCase() || !/[A-Z]{2}/.test(s)) return s;
  return s.split(/(\s+)/).map((w, i) => KEEP.has(w.replace(/[^A-Z0-9-]/g, '')) ? w :
    (i > 0 && SMALL.has(w.toLowerCase())) ? w.toLowerCase() : w.charAt(0) + w.slice(1).toLowerCase()).join('');
};
const sentence = (s) => { s = String(s); return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase().replace(/\bdefcon\b/g, 'DEFCON').replace(/\bh\b/, 'h') : s; };
const stanceLabel = (st) => nice(STANCE_STYLE[st].label);
// The prominent button names the result (HIG: "consider starting the label with a verb").
const VERB = { recon: 'Begin Recon', aid: 'Deploy Aid', patrol: 'Start Patrol', cyber_ad: 'Blind Air Defenses', strike: 'Launch Strike',
  raid: 'Launch Raid', cyber_grid: 'Black Out Grid', blockade: 'Begin Blockade', campaign: 'Launch Air Campaign', invade: 'Begin Invasion' };
const GROUPS = [['Intelligence & Support', (e) => e <= 0], ['Limited Force', (e) => e > 0 && e <= 2], ['Major Operations', (e) => e > 2]];
const tileCls = (e) => ({ '-1': 'e0', 0: 'e1', 1: 'e1', 2: 'e2', 3: 'e3', 4: 'e4' })[e] || 'e2';

export class UI {
  constructor(game) {
    this.g = game;
    this.dirtyTop = true;
    this.dirtyForces = true;
    this.forceTab = 'all';
    this.selUnit = null;
    this.dossier = null;          // { c, op, site, picked:Set<unitId> }
    this.labels = new Map();      // key -> {el, pos, kind, ...}
    this.labelsEl = $('labels');
    this.modalOpen = false;
    this._acc = 0;
    this.v = new THREE.Vector3();
    // static markup carries <i data-icon="name"> placeholders
    document.querySelectorAll('i[data-icon]').forEach(el => {
      const small = el.closest('.speeds, .mode, .btn.small');
      el.outerHTML = icon(el.dataset.icon, small ? 15 : 19);
    });
    this._bindHud();
  }

  // ====================================================================== title & lifecycle
  bindTitle() {
    const g = this.g;
    document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
      g.audio.init(); g.audio.confirm();
      this._applyQuality();
      g.start(b.dataset.mode, parseFloat($('opt-diff').value));
    }));
    const save = g.constructor.loadSave?.();
    if (save) {
      const btn = $('btn-continue');
      btn.classList.remove('hidden');
      btn.textContent = `Continue Campaign · Day ${Math.floor(save.time / 24) + 1}`;
      btn.addEventListener('click', () => { g.audio.init(); this._applyQuality(); g.start(save.mode, save.difficulty, save.seed, save); });
    }
    $('opt-quality').addEventListener('change', () => this._applyQuality());
  }

  _applyQuality() {
    const q = $('opt-quality').value;
    this.g.quality.mode = q;
    this.g.quality.scale = 1;
    this.g.quality.bloom = q !== 'low';
    this.g.applySize();
  }

  startHud() {
    $('screen-title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this._renderTabs();
    this.renderForces();
    this.renderTop();
    this.renderCrises();
    this.refreshLabels();
    this.refreshSites();
  }

  _bindHud() {
    document.querySelectorAll('.speeds button').forEach(b => b.addEventListener('click', () => this.setSpeed(parseFloat(b.dataset.speed))));
    $('dossier-close').addEventListener('click', () => this.closeDossier());
    $('btn-help').addEventListener('click', () => this.help());
    $('btn-menu').addEventListener('click', () => this.menu());
    $('btn-procure').addEventListener('click', () => this.procureMenu());
    $('btn-threats').addEventListener('click', () => this.threatBoard());
    $('dossier').addEventListener('pointerdown', () => { this._dossierPress = true; });
    addEventListener('pointerup', () => { this._dossierPress = false; });
    $('force-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-unit]');
      if (!row) return;
      const u = this.g.units.find(x => x.id === +row.dataset.unit);
      if (e.target.closest('[data-recall]')) { this.g.recall(u); this.g.audio.click(); return; }
      this.selectUnit(u);
    });
  }

  setSpeed(s) {
    this.g.speed = s;
    document.querySelectorAll('.speeds button').forEach(b => {
      const on = parseFloat(b.dataset.speed) === s;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });
    this.g.audio.click();
  }

  // ====================================================================== per-frame
  frame(dt) {
    this._acc += dt;
    if (this.dirtyTop) { this.renderTop(); this.dirtyTop = false; }
    if (this._acc > 0.25) {
      this._acc = 0;
      if (this.dirtyForces) { this.renderForces(); this.dirtyForces = false; }
      this._updateCrisisTimers();
      this._tick = (this._tick || 0) + 1;
      if (this._tick % 4 === 0) {
        this.renderForces();
        // Rebuild the dossier only when something changed, and never under a pressed mouse button
        // (replacing the DOM between mousedown and mouseup swallows the click).
        if (this.dossier && this.dirtyDossier && !this._dossierPress) { this.dirtyDossier = false; this.renderDossier(); }
        else if (this.dossier) this._refreshMeters();
      }
      this.renderTop();
    }
    this._positionLabels();
  }

  renderTop() {
    const g = this.g;
    if (!g.started) return;
    const h = g.time % 24;
    $('date').textContent = `Day ${g.day} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}Z`;
    const dc = 5 - Math.min(4, Math.floor(g.tension / 20));
    const d = document.querySelector('.defcon');
    d.className = `defcon d${dc}`;
    d.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i >= dc - 1));
    $('defcon-num').textContent = dc;
    $('tension-bar').style.width = `${g.tension}%`;
    $('tension-val').textContent = Math.round(g.tension);
    $('approval-bar').style.width = `${g.approval}%`;
    $('approval-val').textContent = Math.round(g.approval);
    $('budget-val').textContent = g.sandbox ? '∞' : `$${g.budget.toFixed(1)}B`;
    $('score-val').textContent = Math.round(g.score).toLocaleString();
  }

  // ====================================================================== forces
  _renderTabs() {
    // HIG: segmented controls use text or images, not both; nouns for labels.
    const tabs = [['all', 'All'], ...Object.entries(CLASSES).map(([k, v]) => [k, nice(v.label)])];
    $('force-tabs').innerHTML = tabs.map(([k, l]) => `<button role="radio" aria-checked="${k === this.forceTab}" data-tab="${k}" class="${k === this.forceTab ? 'on' : ''}">${l}</button>`).join('');
    $('force-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      this.forceTab = b.dataset.tab; this._renderTabs(); this.renderForces(); this.g.audio.click();
    }));
  }

  renderForces() {
    const g = this.g;
    if (!g.started) return;
    const list = g.units.filter(u => this.forceTab === 'all' || u.cls === this.forceTab);
    const ready = g.units.filter(u => u.available).length;
    $('forces-count').textContent = `${ready} of ${g.units.length} ready`;
    const html = list.map(u => {
      const st = u.state === 'lost' ? 'down' : u.state === 'ready' || (u.cls === 'naval' && u.state === 'onstation') ? 'ready' : 'busy';
      const where = u.task ? `${OPS[u.task.op]?.name || ''} · ${g.world.countries[u.task.ci]?.name || ''}` :
        u.cls === 'naval' ? (u.stationCi >= 0 ? `Off ${g.world.countries[u.stationCi].name}` : 'Patrolling') : u.base.name;
      const canRecall = (u.state === 'onstation' || u.state === 'moving') && (u.cls !== 'space' && u.cls !== 'cyber');
      return `<div class="unit ${this.selUnit === u ? 'sel' : ''}" data-unit="${u.id}">
        <div class="tile">${icon(u.type, 19)}</div>
        <div style="min-width:0"><div class="nm">${esc(u.callsign)}<small>${u.t.short}</small></div><div class="sub">${esc(where)}</div></div>
        <div class="right"><span class="pill ${st}">${sentence(u.statusText())}</span>${canRecall ? `<button class="btn gray small" data-recall="1" style="height:24px;padding:0 9px;font-size:11.5px">${icon('recall', 13)}Recall</button>` : ''}</div>
        <div class="hp ${u.hp >= 99.5 ? 'full' : ''}"><b style="width:${Math.max(0, u.hp)}%"></b></div>
      </div>`;
    }).join('');
    if (html !== this._lastForces) { $('force-list').innerHTML = html; this._lastForces = html; }
  }

  selectUnit(u) {
    const g = this.g;
    this.selUnit = this.selUnit === u ? null : u;
    g.audio.select();
    if (this.selUnit) {
      if (u.cls !== 'cyber') g.focusLL(u.ll, Math.max(1.6, Math.min(2.6, g.camera.position.length())));
      this.showHint(`${u.callsign} selected · click any country to task it`);
      if (this.dossier) this.openDossier(this.dossier.c);
    } else this.showHint('');
    this.dirtyForces = true;
  }

  // ====================================================================== dossier & planner
  openDossier(c, opts = {}) {
    const keep = this.dossier && this.dossier.c === c;
    this.dossier = { c, op: opts.op ?? (keep ? this.dossier.op : null), site: opts.site ?? (keep ? this.dossier.site : null), picked: null };
    // A selected unit narrows the op list to what it can do and pre-picks it.
    if (this.selUnit && !opts.op) {
      const ops = availableOps(this.g, c).filter(k => OPS[k].uses.includes(this.selUnit.type));
      if (ops.length === 1) this.dossier.op = ops[0];
    }
    this.g.globe.setSelected(c.i);
    $('dossier').classList.remove('hidden');
    $('hud').classList.add('dz-open');
    this.renderDossier();
    this.refreshSites();
    this.refreshLabels();
  }

  closeDossier() {
    this.dossier = null;
    this.g.setPreview(null);
    $('dossier').classList.add('hidden');
    $('hud').classList.remove('dz-open');
    $('action-bar').innerHTML = '';
    this.g.globe.setSelected(-1);
    this.refreshSites();
  }

  _meter(label, v, cls = '') {
    return `<div class="meter ${cls}"><label><span>${label}</span><span>${Math.round(v)}</span></label><div class="meter-line"><b style="width:${Math.max(0, Math.min(100, v))}%"></b></div></div>`;
  }

  renderDossier() {
    const g = this.g, d = this.dossier;
    if (!d) return;
    const c = d.c;
    const body = $('dossier-body');
    const keepScroll = body.scrollTop;
    const sites = g.world.sitesOf(c);
    const visible = sites.filter(s => g.world.visible(s));
    const hiddenN = sites.filter(s => s.alive && !g.world.visible(s)).length;
    const crises = g.crises.filter(cr => cr.ci === c.i);
    const flags = [];
    if (c.blockaded) flags.push('Blockaded');
    if (c.adDownUntil > g.time) flags.push(`Air defense blind · ${hrs(c.adDownUntil - g.time)}`);
    if (c.gridDownUntil > g.time) flags.push(`Grid down · ${hrs(c.gridDownUntil - g.time)}`);
    const present = g.units.filter(u => u.state === 'onstation' && (u.task?.ci === c.i || u.stationCi === c.i));

    let html = `<div class="dz-top"><div class="dz-head"><h3>${esc(c.name)}</h3><span class="tag ${c.stance}">${stanceLabel(c.stance)}</span></div>
      <div class="dz-meta">${esc(c.region || c.continent || '')} · Population ${fmtPop(c.pop)} · GDP ${fmtGdp(c.gdp)}</div></div>`;
    if (flags.length) html += `<div class="flags">${flags.map(f => `<span class="pill">${f}</span>`).join('')}</div>`;
    if (c.stance !== 'home') html += `<div class="meters" id="dz-meters">${this._meters(c)}</div>`;
    for (const cr of crises) html += `<div class="callout">${icon('warning', 17)}<div><b>${esc(cr.title)}</b> · ${hrs(cr.end - g.time)} left<br>${esc(CRISES[cr.type].hint)}</div></div>`;

    if (sites.length || c.stance !== 'home') {
      html += `<div class="sect">Targets ${hiddenN ? `<span class="note">${hiddenN} unconfirmed · raise intel</span>` : ''}</div>`;
      if (!visible.length) html += `<div class="list"><div class="li note">No confirmed targets.${c.intel < 50 ? ' Run Recon to find them.' : ''}</div></div>`;
      else html += `<div class="list">` + visible.map(s => `<div class="li site-row ${d.site === s ? 'on' : ''} ${s.alive ? '' : 'dead'}" data-site="${s.id}">
          <span class="ic-site">${icon(s.faction ? 'cell' : 'site', 17)}</span><span class="grow">${esc(s.name)}</span>
          <div class="hpbar"><b style="width:${s.hp / s.maxHp * 100}%"></b></div></div>`).join('') + `</div>`;
    }
    if (present.length) {
      html += `<div class="sect">US Forces Present</div><div class="list">` + present.map(u => `<div class="li" data-unit="${u.id}">
        <div class="tile sm">${icon(u.type, 16)}</div><span class="grow"><span class="t">${esc(u.callsign)}</span><span class="d">${esc(OPS[u.task?.op]?.name || 'On station')}</span></span>
        <button class="btn gray small" data-recall="${u.id}">${icon('recall', 14)}Recall</button></div>`).join('') + `</div>`;
    }

    // Operations: an inset grouped list ordered by escalation; selection shows a checkmark.
    const ops = availableOps(g, c).filter(k => !this.selUnit || OPS[k].uses.includes(this.selUnit.type));
    html += `<div class="sect">Operations ${this.selUnit ? `<span class="note">for ${esc(this.selUnit.callsign)} · <a href="#" id="clear-unit">Show all forces</a></span>` : ''}</div><div class="list ops-list">`;
    const canTalk = (c.stance === 'hostile' || c.stance === 'rival') && !this.selUnit;
    for (const [gname, test] of GROUPS) {
      const ks = ops.filter(k => test(OPS[k].esc));
      if (!ks.length && !(canTalk && gname === GROUPS[0][0])) continue;
      html += `<div class="group-label">${gname}</div>`;
      for (const k of ks) {
        const op = OPS[k];
        html += `<button class="li ${d.op === k ? 'on' : ''}" data-op="${k}"><div class="tile sm ${tileCls(op.esc)}">${icon(k, 16)}</div>
          <span class="grow"><span class="t">${op.name}</span><span class="d">${op.desc}</span></span><span class="chk">${icon('check', 18)}</span></button>`;
      }
      if (canTalk && gname === GROUPS[0][0]) {
        const wait = Math.max(0, (g.talksReadyAt || 0) - g.time);
        html += `<button class="li op-talks" data-talks="1" ${wait ? 'disabled' : ''}><div class="tile sm">${icon('talks', 16)}</div>
          <span class="grow"><span class="t">Back-Channel Talks</span><span class="d">${wait ? `Diplomats busy · ${Math.ceil(wait)}h` : `Tension −${c.stance === 'rival' ? 14 : 8} · approval −2 · ${g.sandbox ? 'free' : '$6B'} · 36h cooldown`}</span></span></button>`;
      }
    }
    html += `</div>`;
    if (c.stance !== 'home' && c.stance !== 'controlled' && !this.selUnit) {
      html += `<div class="war-zone"><button class="btn destructive block" data-war="1">${icon('war', 17)}Declare War…</button></div>`;
    }
    this._preview = null;
    const plan = d.op ? this._plan() : null;
    if (plan) html += plan.body;
    body.innerHTML = html;
    $('action-bar').innerHTML = plan ? plan.bar : '';
    this._bindDossier();
    g.setPreview(this._preview?.[0], this._preview?.[1]);
    if (d.op && this._lastOp !== d.op) {
      const p = body.querySelector('#plan-assets') || body.querySelector('.ops-list .li.on');
      if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else body.scrollTop = keepScroll;
    this._lastOp = d.op;
  }

  _meters(c) {
    let h = this._meter('Military', c.mil) + this._meter('Air defense', c.ad) + this._meter('Air force', c.air) +
      (c.coastal ? this._meter('Navy', c.navy) : this._meter('Missiles', c.missiles * 10)) + this._meter('Intel', c.intel, 'intel') + this._meter('Stability', c.stability, 'intel');
    if (c.control > 0 && c.stance !== 'controlled') h += this._meter('US control', c.control, 'intel');
    return h;
  }

  _refreshMeters() {
    const m = $('dz-meters');
    if (m && this.dossier) m.innerHTML = this._meters(this.dossier.c);
    // keep site health bars live without rebuilding the panel
    if (this.dossier) for (const el of $('dossier-body').querySelectorAll('[data-site]')) {
      const s = this.g.world.sites.find(x => x.id === +el.dataset.site);
      const b = el.querySelector('.hpbar b');
      if (s && b) b.style.width = `${s.hp / s.maxHp * 100}%`;
      if (s && !s.alive) el.classList.add('dead');
    }
  }

  /** Asset picker (in the scrolling body) + the pinned action bar with odds and the one prominent button. */
  _plan() {
    const g = this.g, d = this.dossier, c = d.c, op = OPS[d.op];
    const bar = (inner, verb = VERB[d.op], enabled = false) => `<div class="ab-title"><span class="tile sm ${tileCls(op.esc)}">${icon(d.op, 15)}</span><b>${op.name}</b>${d.site ? `<span>· ${esc(d.site.name)}</span>` : ''}</div>
      ${inner}<button class="btn prominent large block" id="go" ${enabled ? '' : 'disabled'}>${verb}</button>`;
    if (op.target === 'site' && !d.site) return { body: '', bar: bar(`<div class="ab-notes"><div class="warn">Choose a target in the list above.</div></div>`) };
    const elig = eligibleUnits(g, d.op, c, d.site);
    if (!elig.length) return { body: '', bar: bar(`<div class="ab-notes"><div class="warn">No assets can perform this operation${d.site ? ' on this target' : ''}.</div></div>`) };
    if (!d.picked) {
      d.picked = new Set();
      const ready = elig.filter(e => e.ready);
      if (this.selUnit && ready.some(e => e.u === this.selUnit)) d.picked.add(this.selUnit.id);
      else {
        const n = { campaign: 3, invade: 2 }[d.op] ?? 1;
        let pool = ready;
        // strikes: prefer the hardest hitter among the quickest few; recon: the best sensor
        if (d.op === 'strike') pool = [...ready].sort((a, b) => (b.u.t.strike || b.u.t.cyber || 0) / (1 + b.eta / 12) - (a.u.t.strike || a.u.t.cyber || 0) / (1 + a.eta / 12));
        if (d.op === 'recon') pool = [...ready].sort((a, b) => (b.u.t.recon || 15) / (1 + b.eta / 6) - (a.u.t.recon || 15) / (1 + a.eta / 6));
        pool.slice(0, n).forEach(e => d.picked.add(e.u.id));
      }
    }
    const picked = elig.filter(e => d.picked.has(e.u.id) && e.ready);
    const units = picked.map(e => e.u);
    const body = `<div class="sect" id="plan-assets">Assets <span class="note">${units.length} selected</span></div><div class="list assets">` +
      elig.map(e => `<button class="li ${d.picked.has(e.u.id) && e.ready ? 'picked' : ''} ${e.ready ? '' : 'na'}" data-pick="${e.u.id}" ${e.ready ? '' : 'aria-disabled="true"'}>
        <span class="radio">${icon('check', 13)}</span><div class="tile sm">${icon(e.u.type, 16)}</div>
        <span class="grow"><span class="t">${esc(e.u.callsign)}</span><span class="d">${e.u.t.name}</span></span>
        <span class="eta">${e.ready ? 'ETA ' + hrs(e.eta) : esc(sentence(e.why))}</span></button>`).join('') + `</div>`;
    this._preview = [units, d.site ? d.site.ll : c.ll];
    const est = estimate(g, d.op, c, d.site, units);
    const lvl = (v) => v === 'MIN' || v === 'LOW' ? 'var(--green)' : v === 'MED' ? 'var(--orange)' : 'var(--red)';
    const eta = units.length ? Math.max(...picked.map(e => e.eta)) : 0;
    const inner = `<div class="odds">
      <div><label>Success</label><b style="color:${est.successPct > 70 ? 'var(--green)' : est.successPct > 40 ? 'var(--orange)' : 'var(--red)'}">${units.length ? est.successPct + '%' : '—'}</b></div>
      <div><label>Loss risk</label><b style="color:${est.lossPct < 15 ? 'var(--green)' : est.lossPct < 35 ? 'var(--orange)' : 'var(--red)'}">${est.lossPct}%</b></div>
      <div><label>Collateral</label><b style="color:${lvl(est.collLabel)}">${nice(est.collLabel)}</b></div>
      <div><label>Tension</label><b style="color:${est.tension > 8 ? 'var(--red)' : est.tension > 0 ? 'var(--orange)' : 'var(--green)'}">${est.tension > 0 ? '+' : ''}${est.tension}</b></div>
    </div>
    ${est.notes.length ? `<div class="ab-notes">${est.notes.map(n => `<div class="warn">${esc(n)}</div>`).join('')}</div>` : ''}
    <div class="ab-meta"><span>${units.length ? `${units.length} asset${units.length > 1 ? 's' : ''} · arrives in ${hrs(eta)}` : 'Select at least one asset'}</span><span>${g.sandbox ? 'Unrestricted' : 'Cost $' + est.cost.toFixed(1) + 'B'}</span></div>`;
    return { body, bar: bar(inner, VERB[d.op], units.length > 0) };
  }

  _bindDossier() {
    const g = this.g, d = this.dossier, body = $('dossier-body');
    body.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => {
      d.op = d.op === b.dataset.op ? null : b.dataset.op; d.picked = null;
      if (d.op && OPS[d.op].target === 'site' && !d.site) {
        // auto-pick the most relevant visible site (crisis target first)
        const cr = g.crises.find(x => x.ci === d.c.i && x.siteId);
        const vis = g.world.sitesOf(d.c).filter(s => g.world.visible(s) && s.alive);
        d.site = (cr && vis.find(s => s.id === cr.siteId)) || vis.find(s => d.op === 'raid' ? SITE_TYPES[s.type].raidOnly || s.faction : !SITE_TYPES[s.type].raidOnly) || null;
      }
      g.audio.click(); this.renderDossier(); this.refreshSites();
    }));
    body.querySelectorAll('[data-site]').forEach(b => b.addEventListener('click', () => {
      const s = g.world.sites.find(x => x.id === +b.dataset.site);
      d.site = d.site === s ? null : s; d.picked = null;
      if (d.site && !d.op) d.op = SITE_TYPES[s.type].raidOnly ? 'raid' : 'strike';
      if (d.site) g.focusLL(s.ll, Math.min(g.camera.position.length(), 1.9));
      g.audio.click(); this.renderDossier(); this.refreshSites();
    }));
    body.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      if (b.classList.contains('na')) return;
      const id = +b.dataset.pick;
      if (d.picked.has(id)) d.picked.delete(id); else d.picked.add(id);
      g.audio.click();
      this._lastOp = d.op; // keep scroll position
      this.renderDossier();
    }));
    body.querySelectorAll('[data-recall]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const u = g.units.find(x => x.id === +b.dataset.recall); g.recall(u); this.renderDossier();
    }));
    const talks = body.querySelector('[data-talks]');
    if (talks) talks.addEventListener('click', () => { if (g.talks(d.c)) this.renderDossier(); });
    const war = body.querySelector('[data-war]');
    if (war) war.addEventListener('click', () => this.confirmWar(d.c));
    const clear = $('clear-unit');
    if (clear) clear.addEventListener('click', (e) => { e.preventDefault(); this.selUnit = null; this.dirtyForces = true; this.showHint(''); this.renderDossier(); });
    const go = $('go');
    if (go) go.addEventListener('click', () => {
      const units = g.units.filter(u => d.picked?.has(u.id) && u.available);
      if (g.order(d.op, d.c, d.site, units)) {
        d.op = null; d.picked = null;
        if (this.selUnit && units.includes(this.selUnit)) { this.selUnit = null; this.showHint(''); }
        this.renderDossier();
      }
    });
  }

  confirmWar(c) {
    // HIG: uncommon, irreversible action -> alert with a clear Cancel; the destructive choice is never the default.
    this.modal(`<h2>Declare war on ${esc(c.name)}?</h2>
      <p>Every available cyber team, satellite, aircraft in range, nearby fleet and ground battalion will be committed against ${esc(c.name)}.</p>
      ${c.stance === 'rival' ? `<div class="callout">${icon('warning', 17)}<div><b>This is a rival superpower.</b> Expect massive escalation.</div></div>` : ''}
      ${c.stance === 'ally' ? `<div class="callout">${icon('warning', 17)}<div><b>${esc(c.name)} is your ally.</b></div></div>` : ''}`,
      [['Cancel', null, 'gray'], ['Declare War', () => { this.g.declareWar(c); this.renderDossier(); }, 'destructive']]);
  }

  hover(c) {
    if (!c) { this.showHint(this.selUnit ? `${this.selUnit.callsign} selected · click any country to task it` : ''); return; }
    this.g.audio.hover();
    this.showHint(`${c.name} · ${stanceLabel(c.stance)}${this.selUnit ? ` · task ${this.selUnit.callsign} here` : ''}`);
  }

  showHint(t) { const h = $('hint'); if (h.textContent !== t) h.textContent = t; }

  // ====================================================================== crises
  renderCrises() {
    const g = this.g;
    $('crises').innerHTML = g.crises.map(cr => {
      const def = CRISES[cr.type];
      return `<button class="crisis glass" data-crisis="${cr.id}">
        <div class="top">${icon('warning', 17)}<h4>${esc(cr.title)}</h4></div>
        <div class="loc">${esc(cr.where)} · <span data-left="${cr.id}"></span></div>
        <div class="timer"><b data-timer="${cr.id}"></b></div>
        <div class="foot"><span class="rw">+${def.reward} pts</span><span class="go-hint">Respond ${icon('chevron', 13)}</span></div></button>`;
    }).join('');
    $('crises').querySelectorAll('[data-crisis]').forEach(el => el.addEventListener('click', () => {
      const cr = g.crises.find(x => x.id === +el.dataset.crisis);
      if (!cr) return;
      const c = g.world.countries[cr.ci];
      const site = cr.siteId ? g.world.sites.find(s => s.id === cr.siteId && g.world.visible(s)) : null;
      const op = { plot: site ? 'strike' : 'recon', hostage: 'raid', missile: site ? 'strike' : 'recon', pirates: 'patrol', cyber: site ? 'strike' : 'recon',
        invasion: 'patrol', disaster: 'aid', rivalfleet: 'patrol' }[cr.type];
      g.audio.select();
      this.openDossier(c, { op, site });
      g.focusLL(site ? site.ll : c.ll, Math.min(2.4, Math.max(1.6, g.camera.position.length())));
    }));
    this._updateCrisisTimers();
    this.refreshSites();
  }

  _updateCrisisTimers() {
    const g = this.g;
    for (const cr of g.crises) {
      const left = cr.end - g.time, frac = left / (cr.end - cr.start);
      const b = document.querySelector(`[data-timer="${cr.id}"]`);
      if (b) b.style.width = `${Math.max(0, frac * 100)}%`;
      const l = document.querySelector(`[data-left="${cr.id}"]`);
      if (l) l.textContent = `${hrs(left)} left${cr.type === 'invasion' ? ` · defense ${Math.round(cr.progress || 0)}/${Math.round(g.world.countries[cr.data.aggressor].mil * 0.6)}` : ''}${(cr.type === 'pirates' || cr.type === 'rivalfleet') && cr.progress ? ` · securing ${Math.round(cr.progress * 10)}%` : ''}`;
      const card = b?.closest('.crisis');
      if (card) card.classList.toggle('urgent', frac < 0.3);
    }
  }

  // ====================================================================== feed / toasts / alerts
  feed(msg, cls = '') {
    const g = this.g;
    const h = g.time % 24;
    const t = `D${g.day} ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const el = document.createElement('div');
    el.className = `msg ${cls}`;
    el.innerHTML = `<time>${t}</time>${esc(sentence(msg))}`;
    const list = $('feed-list');
    list.prepend(el);
    while (list.children.length > 80) list.lastChild.remove();
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = `toast glass ${cls}`;
    el.textContent = nice(msg);
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3700);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  alert(title, sub = '', kind = 'bad') {
    const spoken = title.toLowerCase().replace(/defcon (\d)/, 'DEFCON $1').replace(/[:·]/g, ',');
    this.g.audio.say(spoken.charAt(0).toUpperCase() + spoken.slice(1), /missile|global war|defcon 1/i.test(title));
    const el = $('alert');
    el.className = `glass ${kind}`;
    el.innerHTML = `${esc(nice(title))}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._alertT);
    this._alertT = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  // ====================================================================== labels & pins
  _label(key, cls, html, pos, onClick) {
    let L = this.labels.get(key);
    if (!L) {
      const el = document.createElement('div');
      el.className = cls;
      if (onClick) { el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', onClick); }
      this.labelsEl.appendChild(el);
      L = { el, pos: new THREE.Vector3(), html: null };
      this.labels.set(key, L);
    }
    if (L.html !== html) { L.el.innerHTML = html; L.html = html; }
    if (L.el.className !== cls) L.el.className = cls;
    L.pos.copy(pos);
    L.keep = true;
    return L;
  }

  _sweep(prefix) {
    for (const [k, L] of this.labels) {
      if (!k.startsWith(prefix)) continue;
      if (!L.keep) { L.el.remove(); this.labels.delete(k); } else L.keep = false;
    }
  }

  refreshLabels() {
    const g = this.g;
    if (!g.started) return;
    for (const c of g.world.countries) {
      const important = c.stance !== 'neutral' || c.pop > 6e7 || (this.dossier?.c === c);
      if (!important) continue;
      this._label('c' + c.i, `lbl ${c.stance}`, esc(c.name), llToVec3(c.ll[0], c.ll[1], GLOBE_R * 1.004)).minDist = c.stance === 'neutral' ? 2.3 : c.pop > 3e7 || c.stance === 'rival' ? 9 : 2.9;
    }
    for (const b of g.bases) this._label('b' + b.id, 'unit-tag', `◆ ${esc(b.name)}`, llToVec3(b.ll[0], b.ll[1], GLOBE_R * 1.01)).minDist = 1.75;
    this._sweep('c'); this._sweep('b');
  }

  refreshSites() {
    const g = this.g;
    if (!g.started) return;
    this.dirtyDossier = true;
    const sel = this.dossier?.c;
    const perCountry = new Map();
    for (const s of g.world.sites) {
      if (!g.world.visible(s)) continue;
      const crisis = g.crises.find(cr => cr.siteId === s.id);
      const isSel = this.dossier?.site === s;
      const show = crisis || s.faction || sel?.i === s.ci || isSel || ['hostage', 'launcher', 'server'].includes(s.type);
      if (!show) continue;
      const L = this._label('s' + s.id, `marker site-pin ${s.alive ? '' : 'dead'} ${isSel ? 'sel' : ''}`, `${icon(s.faction ? 'cell' : 'site', 12)}${esc(s.name)}`,
        llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.006), () => { this.openDossier(g.world.countries[s.ci], { site: s, op: SITE_TYPES[s.type].raidOnly ? 'raid' : 'strike' }); });
      L.minDist = crisis || isSel ? 9 : sel?.i === s.ci ? 2.5 : 2.0;
      // stagger pins within a country so small states don't stack labels on top of each other
      const n = perCountry.get(s.ci) || 0;
      perCountry.set(s.ci, n + 1);
      L.offsetY = (n % 6) * 20 - 10;
    }
    for (const cr of g.crises) {
      const s = cr.siteId ? g.world.sites.find(x => x.id === cr.siteId) : null;
      const vis = s && g.world.visible(s);
      const c = g.world.countries[cr.ci];
      const ll = vis ? s.ll : c.ll;
      const urgent = (cr.end - g.time) / (cr.end - cr.start) < 0.3;
      const L = this._label('k' + cr.id, `marker crisis-pin ${urgent ? 'urgent' : ''}`, icon('warning', 15), llToVec3(ll[0], ll[1], GLOBE_R * 1.012), () => {
        document.querySelector(`[data-crisis="${cr.id}"]`)?.click();
      });
      L.minDist = 99;
      L.offsetY = vis ? -26 : 0;
    }
    this._sweep('s'); this._sweep('k');
  }

  _positionLabels() {
    const g = this.g;
    const cam = g.camera;
    const camDist = cam.position.length();
    const camDir = this.v.copy(cam.position).normalize();
    const w = innerWidth, h = innerHeight;
    const tmp = new THREE.Vector3();
    for (const [k, L] of this.labels) {
      const facing = tmp.copy(L.pos).normalize().dot(camDir);
      const visible = facing > 0.18 && camDist < (L.minDist ?? 99);
      if (!visible) { if (L.shown !== false) { L.el.style.display = 'none'; L.shown = false; } continue; }
      tmp.copy(L.pos).project(cam);
      if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) { if (L.shown !== false) { L.el.style.display = 'none'; L.shown = false; } continue; }
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h + (L.offsetY || 0);
      if (L.shown !== true) { L.el.style.display = ''; L.shown = true; }
      L.el.style.left = `${x.toFixed(1)}px`;
      L.el.style.top = `${y.toFixed(1)}px`;
      L.el.style.opacity = Math.min(1, (facing - 0.18) * 5).toFixed(2);
    }
  }

  // ====================================================================== sheets
  /** buttons: [label, fn, style] with style prominent | gray | destructive | tinted. Order them Cancel-first:
   *  HIG puts the most likely choice on the trailing side. opts.stack lays choices out vertically. */
  modal(html, buttons = [['Done', null, 'prominent']], opts = {}) {
    this.modalOpen = true;
    $('screen-modal').classList.remove('hidden');
    $('modal-body').innerHTML = html + `<div class="row ${opts.stack ? 'stack' : ''}">${buttons.map(([l, , cls], i) => `<button data-b="${i}" class="btn ${cls || 'gray'}">${l}</button>`).join('')}</div>`;
    $('modal-body').querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
      this.closeModal();
      const fn = buttons[+b.dataset.b][1];
      if (fn) fn();
    }));
    $('modal-body').scrollTop = 0;
  }

  closeModal() { this.modalOpen = false; $('screen-modal').classList.add('hidden'); }

  briefing() {
    const g = this.g, w = g.world;
    const hostiles = w.countries.filter(c => c.stance === 'hostile').map(c => c.name);
    this.modal(`<h2>Commander's Briefing</h2>
      <p>${g.sandbox ? '<b>Unrestricted mode.</b> Unlimited budget, no failure. The world is your theater.' : `You have <b>60 days</b>. Keep approval up, keep the world from tipping into global war, and resolve crises before their clocks run out.`}</p>
      <h3>The World</h3>
      <p><b style="color:var(--rival)">Rival powers:</b> ${w.rivals.map(r => esc(r.name)).join(', ')}. Strike them and the world holds its breath.<br>
      <b style="color:var(--hostile)">Hostile regimes:</b> ${hostiles.map(esc).join(', ')}.<br>
      <b style="color:var(--purple)">Non-state threats:</b> ${w.factions.map(f => `${esc(f.name)} (${f.kind})`).join(', ')}, hidden until you find them.</p>
      <h3>How to Command</h3>
      <ul><li><b>Choose a country</b> to open its dossier, pick an operation and its assets, check the odds, then press the action button at the bottom.</li>
      <li>Or <b>select a unit</b> in Forces, then click any country to task it.</li>
      <li><b>Crisis cards</b> along the bottom are timed. Choose one to jump straight to the right operation.</li>
      <li>Hidden targets need <b>intel</b>: satellites, drones and cyber recon reveal them. Blind their air defenses before you send aircraft.</li>
      <li><kbd>Space</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> speed · <kbd>T</kbd> threats · <kbd>P</kbd> procure · <kbd>C</kbd> cinematic camera · <kbd>Tab</kbd> next crisis · <kbd>H</kbd> manual · <kbd>M</kbd> <kbd>V</kbd> mute, voice</li></ul>`,
      [['Take Command', () => this.toast('The theater is yours, General.', 'good'), 'prominent']]);
  }

  help() {
    this.modal(`<h2>Field Manual</h2>
      <h3>Escalation Ladder</h3>
      <p>Recon and Aid (calm) → Patrol and Cyber blinding (low) → Strikes, Raids, Blockades, Grid attacks (medium) → Air Campaign (high) → Invasion and declared war (maximum).
      Tension rises with escalation, far more against rivals, allies and neutrals. At <b>DEFCON 1</b> (tension 80+) you have 48 hours to calm things down.</p>
      <h3>Assets</h3>
      <div class="list">${Object.entries(UNIT_TYPES).map(([k, t]) => `<div class="li"><div class="tile sm">${icon(k, 16)}</div><span class="grow"><span class="t">${t.name}</span><span class="d">${t.blurb}</span></span></div>`).join('')}</div>
      <h3>Tips</h3>
      <ul><li>Air losses come from SAMs and enemy fighters. <b>Cyber: Blind Air Defense</b> cuts SAMs by 85% for a day; stealth (B-2, F-35) and fighter escorts help too.</li>
      <li>Destroyers and carriers near a target automatically try to <b>intercept</b> incoming missiles. Park them near allies you care about.</li>
      <li><b>Invasions</b> need ground power greater than the defenders; air and naval forces on station add support. Captured countries pay you every day.</li>
      <li><b>Humanitarian aid</b> lowers tension and can turn neutrals into allies.</li>
      <li>Collateral damage costs approval. Better intel means more precise strikes.</li></ul>`);
  }

  threatBoard() {
    const g = this.g, w = g.world;
    g.audio.click();
    const bar = (v, col) => `<div class="meter-line" style="width:110px"><b style="width:${Math.max(0, Math.min(100, v))}%;background:${col}"></b></div>`;
    let html = `<h2>Threat Board</h2><p>Known organizations and states. Choose a located cell or a country to plan an operation.</p><h3>Organizations</h3>`;
    for (const f of w.factions) {
      const alive = f.cells.filter(s => s.alive);
      const known = alive.filter(s => w.visible(s));
      html += `<div class="row-card" style="grid-template-columns:34px 1fr auto"><div class="tile" style="color:${f.color};background:${f.color}22">${icon('cell', 18)}</div>
        <div><b style="color:${f.color}">${esc(f.name)}</b><span class="note">${esc(f.kind)} · ${alive.length ? `${alive.length} active cell${alive.length > 1 ? 's' : ''}, ${known.length} located` : '<b style="color:var(--green)">Dismantled</b>'}</span>
        <div class="chips">${known.map(s => `<button class="btn tinted small" data-cell="${s.id}">${icon('pin', 14)}${esc(s.name.replace(f.name + ' ', ''))} · ${esc(w.countries[s.ci].name)}</button>`).join('')}
        ${alive.length > known.length ? `<span class="note">${alive.length - known.length} unlocated · suspected hosts: ${[...new Set(alive.filter(s => !w.visible(s)).map(s => w.countries[s.ci].name))].map(esc).join(', ')}</span>` : ''}</div></div>
        <div>${bar(f.strength, f.color)}</div></div>`;
    }
    html += `<h3>Hostile States and Rival Powers</h3>`;
    const states = w.countries.filter(c => c.stance === 'hostile' || c.stance === 'rival').sort((a, b) => b.mil - a.mil);
    for (const c of states) {
      html += `<div class="row-card"><div class="tile" style="color:var(--${c.stance});background:${c.stance === 'rival' ? 'rgba(255,159,10,.16)' : 'rgba(255,105,97,.16)'}">${icon(c.stance === 'rival' ? 'threats' : 'strike', 18)}</div>
        <div><b>${esc(c.name)}</b> <span class="tag ${c.stance}">${stanceLabel(c.stance)}</span><span class="note">Military ${Math.round(c.mil)} · missiles ${c.missiles} · aggression ${Math.round(c.aggression)} · intel ${Math.round(c.intel)}</span></div>
        <div>${bar(c.mil, 'var(--red)')}</div><button class="btn tinted small" data-country="${c.i}">Plan</button></div>`;
    }
    this.modal(html);
    $('modal-body').querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', () => {
      const s = w.sites.find(x => x.id === +b.dataset.cell);
      this.closeModal();
      this.openDossier(w.countries[s.ci], { site: s, op: 'strike' });
      g.focusLL(s.ll, 1.8);
    }));
    $('modal-body').querySelectorAll('[data-country]').forEach(b => b.addEventListener('click', () => {
      const c = w.countries[+b.dataset.country];
      this.closeModal();
      this.openDossier(c);
      g.focusLL(c.ll, 2.2);
    }));
  }

  dilemma(d, fill, onPick) {
    const fxText = (fx) => {
      const parts = [];
      const sign = (v) => (v > 0 ? '+' : '') + v;
      if (fx.approval) parts.push(`approval ${sign(fx.approval)}`);
      if (fx.tension) parts.push(`tension ${sign(fx.tension)}`);
      if (fx.budget && !this.g.sandbox) parts.push(`budget ${sign(fx.budget)}B`);
      if (fx.intel) parts.push(`intel ${sign(fx.intel)}`);
      if (fx.relation) parts.push(`relations ${fx.relation > 0 ? '↑' : '↓'}`);
      if (fx.stance) parts.push(`becomes ${nice(fx.stance.toUpperCase())}`);
      if (fx.procure) parts.push(`+${[].concat(fx.procure).length} unit`);
      if (fx.adDown) parts.push(`their SAMs down ${fx.adDown}h`);
      const s = parts.join(' · ');
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    // HIG: no default button when people should read the choices; equal-weight stacked options.
    this.modal(`<div class="kicker">Priority Traffic · Decision Required</div>
      <h2>${esc(nice(d.title))}</h2><p style="font-size:16px">${esc(fill(d.text))}</p>`,
      d.options.map((o) => [`${esc(fill(o.label))}<small>${fxText(o.fx)}${o.note ? ' · ' + esc(o.note) : ''}</small>`, () => onPick(o), 'gray']), { stack: true });
    $('modal-body').querySelectorAll('.row button').forEach((b, i) => {
      const cost = -(d.options[i].fx.budget || 0);
      if (!this.g.sandbox && cost > 0 && this.g.budget < cost) { b.disabled = true; b.title = 'Insufficient budget'; }
    });
  }

  procureMenu() {
    const g = this.g;
    g.audio.click();
    const rows = Object.entries(PROCURE).map(([type, p]) => {
      const t = UNIT_TYPES[type];
      const owned = g.units.filter(u => u.type === type && u.state !== 'lost').length;
      const afford = g.sandbox || g.budget >= p.price;
      return `<div class="row-card"><div class="tile">${icon(type, 19)}</div>
        <div><b>${t.name}</b><span class="note">${esc(t.blurb)} · you have ${owned} · delivered in ${g.sandbox ? Math.round(p.hours / 4) : p.hours}h</span></div>
        <span class="price">${g.sandbox ? 'Free' : '$' + p.price + 'B'}</span>
        <button class="btn tinted small" data-buy="${type}" ${afford ? '' : 'disabled'}>Buy</button></div>`;
    }).join('');
    this.modal(`<h2>Procurement</h2><p>Budget: <b>${g.sandbox ? 'unrestricted' : '$' + g.budget.toFixed(1) + 'B'}</b>. New forces are stationed at a suitable base when delivered.</p>${rows}`);
    $('modal-body').querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      if (g.procure(b.dataset.buy)) { this.closeModal(); this.procureMenu(); }
    }));
  }

  menu() {
    const g = this.g;
    this.modal(`<h2>Command Menu</h2><p>Day ${g.day} · Score ${Math.round(g.score).toLocaleString()}</p>
      <p class="note">Campaign progress saves automatically every in-game day.</p>`,
      [['Quit to Title', () => { g.save(); location.reload(); }, 'gray'], [g.audio.muted ? 'Unmute' : 'Mute', () => g.audio.toggleMute(), 'gray'],
        ['Field Manual', () => this.help(), 'gray'], ['Resume', null, 'prominent']]);
  }

  endScreen(won, title, text) {
    const g = this.g, l = g.log;
    const r = g.rank();
    const final = g.finalScore();
    this.modal(`<h2>${esc(nice(title))}</h2><p>${esc(text)}</p>
      ${won ? `<div class="grade">${r[1]}</div><p style="text-align:center"><b>${esc(nice(r[2]))}</b> · command rating ${final}/100</p>` : `<div class="grade" style="color:var(--red)">F</div>`}
      <div class="kv">
        <span>Points earned</span><span>${Math.round(g.score).toLocaleString()}</span>
        <span>Operations ordered</span><span>${l.ops}</span>
        <span>Crises resolved / failed</span><span>${l.crisesWon} / ${l.crisesLost}</span>
        <span>Targets destroyed</span><span>${l.sitesDestroyed}</span>
        <span>Terror cells eliminated</span><span>${l.cellsDestroyed}</span>
        <span>Countries secured</span><span>${l.controlled}</span>
        <span>Units lost</span><span>${l.unitsLost}</span>
        <span>Civilian harm index</span><span>${l.collateral.toFixed(1)}</span>
        <span>Final approval / tension</span><span>${Math.round(g.approval)} / ${Math.round(g.tension)}</span>
      </div>
      <h3>Commendations · ${g.medals.length} of ${Object.keys(MEDALS).length}</h3>
      <div class="chips">${g.medals.length ? g.medals.map(id => `<span class="medal" title="${esc(MEDALS[id][2])}">${icon('medal', 15)}${esc(MEDALS[id][1])}</span>`).join('') : '<span class="note">None.</span>'}</div>`,
      [['New Campaign', () => location.reload(), 'prominent']]);
  }

  key(e) {
    const g = this.g;
    if (!g.started || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); this.setSpeed(g.speed === 0 ? (this._lastSpeed || 0.5) : (this._lastSpeed = g.speed, 0)); }
    else if (e.key === '1') this.setSpeed(0.5);
    else if (e.key === '2') this.setSpeed(1.5);
    else if (e.key === '3') this.setSpeed(4);
    else if (e.key === 'h' || e.key === 'H') this.help();
    else if (e.key === 'm' || e.key === 'M') this.toast(g.audio.toggleMute() ? 'Audio muted' : 'Audio on');
    else if (e.key === 'c' || e.key === 'C') { g.cinematic = !g.cinematic; if (!g.cinematic) g.followUnit = null; this.toast(g.cinematic ? 'Cinematic camera on · follows your next operation' : 'Cinematic camera off'); }
    else if (e.key === 't' || e.key === 'T') this.threatBoard();
    else if (e.key === 'p' || e.key === 'P') this.procureMenu();
    else if (e.key === 'v' || e.key === 'V') this.toast(g.audio.toggleVoice() ? 'Voice callouts on' : 'Voice callouts off');
    else if (e.key === 'Tab') { e.preventDefault(); const cards = [...document.querySelectorAll('[data-crisis]')]; if (cards.length) { this._crisisIdx = ((this._crisisIdx ?? -1) + 1) % cards.length; cards[this._crisisIdx].click(); } }
    else if (e.key === 'Enter' && !this.modalOpen && e.target.tagName !== 'BUTTON') { const go = $('go'); if (go && !go.disabled) go.click(); }
    else if (e.key === 'Escape') { if (this.modalOpen) this.closeModal(); else if (this.selUnit) { this.selUnit = null; this.showHint(''); this.dirtyForces = true; } else if (this.dossier) this.closeDossier(); else this.menu(); }
    else if ((e.key === 'f' || e.key === 'F') && this.selUnit) g.focusLL(this.selUnit.ll, 1.6);
  }
}

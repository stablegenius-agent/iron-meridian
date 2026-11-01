// DOM interface: HUD, forces roster, dossier/operation planner, crises, comms, labels, modals.
import * as THREE from 'three';
import { CLASSES, CRISES, MEDALS, OPS, SITE_TYPES, STANCE_STYLE, UNIT_TYPES } from './data.js';
import { GLOBE_R, distanceKm, llToVec3 } from './geo.js';
import { availableOps, eligibleUnits, estimate } from './ops.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const fmtPop = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const fmtGdp = (m) => m >= 1e6 ? '$' + (m / 1e6).toFixed(1) + 'T' : m >= 1e3 ? '$' + Math.round(m / 1e3) + 'B' : '$' + m + 'M';
const hrs = (h) => h >= 48 ? `${Math.round(h / 24)}d` : `${Math.max(0, Math.ceil(h))}h`;
const OP_ICON = { recon: '◎', aid: '✚', patrol: '⛨', cyber_ad: '⌁', strike: '✛', raid: '✠', cyber_grid: '⚡', blockade: '⚓', campaign: '✈', invade: '▲' };

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
    this._feedItems = [];
    this.v = new THREE.Vector3();
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
      btn.textContent = `Continue campaign · Day ${Math.floor(save.time / 24) + 1}`;
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
    document.querySelectorAll('.speeds button').forEach(b => b.classList.toggle('on', parseFloat(b.dataset.speed) === s));
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
      if (this._tick % 4 === 0) { this.renderForces(); if (this.dossier && !this.dossier.op) this.renderDossier(); else if (this.dossier) this._refreshMeters(); }
      this.renderTop();
    }
    this._positionLabels();
  }

  renderTop() {
    const g = this.g;
    if (!g.started) return;
    const h = g.time % 24;
    $('date').textContent = `DAY ${g.day} · ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}Z`;
    const dc = 5 - Math.min(4, Math.floor(g.tension / 20));
    const d = document.querySelector('.defcon');
    d.className = `defcon d${dc}`;
    d.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i >= dc - 1));
    $('tension-bar').style.width = `${g.tension}%`;
    $('tension-val').textContent = Math.round(g.tension);
    $('approval-bar').style.width = `${g.approval}%`;
    $('approval-val').textContent = Math.round(g.approval);
    $('budget-val').textContent = g.sandbox ? '∞' : `$${g.budget.toFixed(1)}B`;
    $('score-val').textContent = Math.round(g.score);
  }

  // ====================================================================== forces
  _renderTabs() {
    const tabs = [['all', 'ALL'], ...Object.entries(CLASSES).map(([k, v]) => [k, `${v.icon} ${v.label}`])];
    $('force-tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === this.forceTab ? 'on' : ''}">${l}</button>`).join('');
    $('force-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      this.forceTab = b.dataset.tab; this._renderTabs(); this.renderForces(); this.g.audio.click();
    }));
  }

  renderForces() {
    const g = this.g;
    if (!g.started) return;
    const list = g.units.filter(u => this.forceTab === 'all' || u.cls === this.forceTab);
    const ready = g.units.filter(u => u.available).length;
    $('forces-count').textContent = `${ready}/${g.units.length} READY`;
    const html = list.map(u => {
      const st = u.state === 'lost' ? 'down' : u.state === 'ready' || (u.cls === 'naval' && u.state === 'onstation') ? 'ready' : 'busy';
      const where = u.task ? `${OPS[u.task.op]?.name || ''} · ${g.world.countries[u.task.ci]?.name || ''}` :
        u.cls === 'naval' ? (u.stationCi >= 0 ? `Off ${g.world.countries[u.stationCi].name}` : 'Patrolling') : u.base.name;
      const canRecall = (u.state === 'onstation' || u.state === 'moving') && (u.cls !== 'space' && u.cls !== 'cyber');
      return `<div class="unit ${this.selUnit === u ? 'sel' : ''}" data-unit="${u.id}">
        <div class="ic">${u.t.icon}</div>
        <div><div class="nm">${esc(u.callsign)} <span class="sub">${u.t.short}</span></div><div class="sub">${esc(where)}</div></div>
        <div style="text-align:right"><span class="st ${st}">${u.statusText()}</span>${canRecall ? `<div><button data-recall="1" style="font-size:10px;padding:0 5px;margin-top:3px">RECALL</button></div>` : ''}</div>
        <div class="hp"><b style="width:${Math.max(0, u.hp)}%"></b></div>
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
      this.showHint(`${u.t.name} ${u.callsign} selected — click any country to task it`);
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
    this.renderDossier();
    this.refreshSites();
    this.refreshLabels();
  }

  closeDossier() {
    this.dossier = null;
    this.g.setPreview(null);
    $('dossier').classList.add('hidden');
    this.g.globe.setSelected(-1);
    this.refreshSites();
  }

  _meter(label, v, cls = '') {
    return `<div class="meter ${cls}"><label><span>${label}</span><span>${Math.round(v)}</span></label><div class="bar"><b style="width:${Math.max(0, Math.min(100, v))}%"></b></div></div>`;
  }

  renderDossier() {
    const g = this.g, d = this.dossier;
    if (!d) return;
    const c = d.c;
    const st = STANCE_STYLE[c.stance];
    const sites = g.world.sitesOf(c);
    const visible = sites.filter(s => g.world.visible(s));
    const hiddenN = sites.filter(s => s.alive && !g.world.visible(s)).length;
    const crises = g.crises.filter(cr => cr.ci === c.i);
    const flags = [];
    if (c.blockaded) flags.push('BLOCKADED');
    if (c.adDownUntil > g.time) flags.push(`AIR DEF. BLIND ${hrs(c.adDownUntil - g.time)}`);
    if (c.gridDownUntil > g.time) flags.push(`GRID DOWN ${hrs(c.gridDownUntil - g.time)}`);
    const present = g.units.filter(u => u.state === 'onstation' && (u.task?.ci === c.i || u.stationCi === c.i));

    let html = `<div class="dz-head"><h3>${esc(c.name)}</h3><span class="tag ${c.stance}">${st.label}</span></div>
      <div class="dz-meta">${esc(c.region || c.continent || '')} · pop ${fmtPop(c.pop)} · GDP ${fmtGdp(c.gdp)}${flags.length ? ` · <span class="warn">${flags.join(' · ')}</span>` : ''}</div>`;
    if (c.stance !== 'home') {
      html += `<div class="meters" id="dz-meters">${this._meters(c)}</div>`;
    }
    for (const cr of crises) html += `<div class="warn" style="margin:4px 0">⚠ ${esc(cr.title)} — ${hrs(cr.end - g.time)} left. ${esc(CRISES[cr.type].hint)}</div>`;

    if (sites.length || c.stance !== 'home') {
      html += `<div class="sect">TARGETS ${hiddenN ? `<span class="note">· ${hiddenN} unconfirmed signature${hiddenN > 1 ? 's' : ''} — raise intel</span>` : ''}</div><div class="sites">`;
      if (!visible.length) html += `<div class="note">No confirmed targets. ${c.intel < 50 ? 'Run Recon to find them.' : ''}</div>`;
      for (const s of visible) {
        html += `<div class="site ${d.site === s ? 'on' : ''}" data-site="${s.id}"><span>${s.faction ? '☠' : '◉'}</span><span>${esc(s.name)}</span>
          <div class="hp"><b style="width:${s.hp / s.maxHp * 100}%"></b></div></div>`;
      }
      html += `</div>`;
    }
    if (present.length) {
      html += `<div class="sect">US FORCES PRESENT</div>`;
      html += present.map(u => `<div class="site" data-unit="${u.id}"><span>${u.t.icon}</span><span>${esc(u.callsign)} · ${esc(OPS[u.task?.op]?.name || 'Station')}</span><button data-recall="${u.id}" style="margin-left:auto;font-size:10px;padding:0 6px">RECALL</button></div>`).join('');
    }

    const ops = availableOps(g, c).filter(k => !this.selUnit || OPS[k].uses.includes(this.selUnit.type));
    html += `<div class="sect">OPERATIONS ${this.selUnit ? `<span class="note">· for ${esc(this.selUnit.callsign)} <a href="#" id="clear-unit" style="color:var(--cyan)">(all forces)</a></span>` : ''}</div><div class="ops">`;
    for (const k of ops) {
      const op = OPS[k];
      html += `<button class="op esc${Math.max(0, op.esc)} ${d.op === k ? 'on' : ''}" data-op="${k}"><b>${OP_ICON[k] || ''} ${op.name}</b><span>${op.desc}</span></button>`;
    }
    if (c.stance !== 'home' && c.stance !== 'controlled' && !this.selUnit) html += `<button class="op warop" data-war="1"><b>☢ DECLARE WAR</b><span>Commit every available asset: cyber, air campaign, blockade, invasion.</span></button>`;
    html += `</div>`;
    this._preview = null;
    if (d.op) html += this._planHtml();
    $('dossier-body').innerHTML = html;
    this._bindDossier();
    g.setPreview(this._preview?.[0], this._preview?.[1]);
  }

  _meters(c) {
    const g = this.g;
    let h = this._meter('MILITARY', c.mil) + this._meter('AIR DEFENSE', c.ad) + this._meter('AIR FORCE', c.air) +
      (c.coastal ? this._meter('NAVY', c.navy) : this._meter('MISSILES', c.missiles * 10)) + this._meter('INTEL', c.intel, 'intel') + this._meter('STABILITY', c.stability, 'intel');
    if (c.control > 0 && c.stance !== 'controlled') h += this._meter('US CONTROL', c.control, 'intel');
    return h;
  }

  _refreshMeters() {
    const m = $('dz-meters');
    if (m && this.dossier) m.innerHTML = this._meters(this.dossier.c);
  }

  _planHtml() {
    const g = this.g, d = this.dossier, c = d.c, op = OPS[d.op];
    let h = `<div class="plan"><b>${op.name.toUpperCase()}</b> <span class="note">${op.desc}</span>`;
    if (op.target === 'site' && !d.site) {
      return h + `<div class="warn" style="margin-top:6px">Select a target above.</div></div>`;
    }
    const elig = eligibleUnits(g, d.op, c, d.site);
    if (!elig.length) return h + `<div class="warn" style="margin-top:6px">No assets can perform this operation${d.site ? ' on this target' : ''}.</div></div>`;
    if (!d.picked) {
      d.picked = new Set();
      const ready = elig.filter(e => e.ready);
      if (this.selUnit && ready.some(e => e.u === this.selUnit)) d.picked.add(this.selUnit.id);
      else {
        const n = { campaign: 3, invade: 2, strike: 1, patrol: 1, blockade: 1, recon: 1, raid: 1, aid: 1 }[d.op] ?? 1;
        // strikes: prefer the hardest hitter among the quickest few
        let pool = ready;
        if (d.op === 'strike') pool = [...ready].sort((a, b) => (b.u.t.strike || b.u.t.cyber || 0) / (1 + b.eta / 12) - (a.u.t.strike || a.u.t.cyber || 0) / (1 + a.eta / 12));
        pool.slice(0, n).forEach(e => d.picked.add(e.u.id));
      }
    }
    h += `<div class="assets">` + elig.map(e => `<label class="asset-row" style="${e.ready ? '' : 'opacity:.45'}">
        <input type="checkbox" data-pick="${e.u.id}" ${d.picked.has(e.u.id) ? 'checked' : ''} ${e.ready ? '' : 'disabled'}>
        <span>${e.u.t.icon} ${esc(e.u.callsign)} <span class="note">${e.u.t.short}</span></span>
        <span class="eta">${e.ready ? 'ETA ' + hrs(e.eta) : e.why}</span></label>`).join('') + `</div>`;
    const units = elig.filter(e => d.picked.has(e.u.id) && e.ready).map(e => e.u);
    this._preview = [units, d.site ? d.site.ll : c.ll];
    const est = estimate(g, d.op, c, d.site, units);
    const col = (v, good) => v === 'MIN' || v === 'LOW' ? 'var(--green)' : v === 'MED' ? 'var(--amber)' : 'var(--red)';
    h += `<div class="odds">
      <div><label>SUCCESS</label><b style="color:${est.successPct > 70 ? 'var(--green)' : est.successPct > 40 ? 'var(--amber)' : 'var(--red)'}">${units.length ? est.successPct + '%' : '—'}</b></div>
      <div><label>LOSS RISK</label><b style="color:${est.lossPct < 15 ? 'var(--green)' : est.lossPct < 35 ? 'var(--amber)' : 'var(--red)'}">${est.lossPct}%</b></div>
      <div><label>COLLATERAL</label><b style="color:${col(est.collLabel)}">${est.collLabel}</b></div>
      <div><label>TENSION</label><b style="color:${est.tension > 8 ? 'var(--red)' : est.tension > 0 ? 'var(--amber)' : 'var(--green)'}">${est.tension > 0 ? '+' : ''}${est.tension}</b></div>
    </div>`;
    for (const n of est.notes) h += `<div class="warn">${esc(n)}</div>`;
    h += `<div class="note" style="margin:4px 0 8px">Cost: ${g.sandbox ? 'unrestricted' : '$' + est.cost.toFixed(1) + 'B'} · Escort fighters and Cyber: Blind Air Defense first to cut losses.</div>`;
    h += `<button class="go" id="go" ${units.length ? '' : 'disabled'}>EXECUTE</button></div>`;
    return h;
  }

  _bindDossier() {
    const g = this.g, d = this.dossier, body = $('dossier-body');
    body.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => {
      d.op = d.op === b.dataset.op ? null : b.dataset.op; d.picked = null;
      if (d.op && OPS[d.op].target === 'site' && !d.site) {
        // auto-pick the most relevant visible site (crisis target first)
        const cr = g.crises.find(x => x.ci === d.c.i && x.siteId);
        const vis = g.world.sitesOf(d.c).filter(s => g.world.visible(s));
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
    body.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('change', () => {
      const id = +b.dataset.pick;
      if (b.checked) d.picked.add(id); else d.picked.delete(id);
      g.audio.click();
      const scroll = body.querySelector('.assets')?.scrollTop;
      this.renderDossier();
      const a = body.querySelector('.assets'); if (a && scroll) a.scrollTop = scroll;
    }));
    body.querySelectorAll('[data-recall]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const u = g.units.find(x => x.id === +b.dataset.recall); g.recall(u); this.renderDossier();
    }));
    const war = body.querySelector('[data-war]');
    if (war) war.addEventListener('click', () => this.confirmWar(d.c));
    const clear = $('clear-unit');
    if (clear) clear.addEventListener('click', (e) => { e.preventDefault(); this.selUnit = null; this.dirtyForces = true; this.showHint(''); this.renderDossier(); });
    const go = $('go');
    if (go) go.addEventListener('click', () => {
      const units = g.units.filter(u => d.picked.has(u.id) && u.available);
      if (g.order(d.op, d.c, d.site, units)) {
        d.op = null; d.picked = null;
        if (this.selUnit && units.includes(this.selUnit)) { this.selUnit = null; this.showHint(''); }
        this.renderDossier();
      }
    });
  }

  confirmWar(c) {
    this.modal(`<h2>DECLARE WAR ON ${esc(c.name.toUpperCase())}?</h2>
      <p>Every available cyber team, satellite, aircraft in range, nearby fleet and ground battalion will be committed against ${esc(c.name)}.
      ${c.stance === 'rival' ? '<b style="color:var(--red)">This is a rival superpower. Expect massive escalation.</b>' : ''}
      ${c.stance === 'ally' ? '<b style="color:var(--red)">They are your ally.</b>' : ''}</p>`,
      [['STAND DOWN', null], ['COMMIT ALL FORCES', () => { this.g.declareWar(c); this.renderDossier(); }, 'go']]);
  }

  hover(c) {
    if (!c) { this.showHint(this.selUnit ? `${this.selUnit.t.name} ${this.selUnit.callsign} selected — click any country to task it` : ''); return; }
    this.g.audio.hover();
    const st = STANCE_STYLE[c.stance];
    this.showHint(`${c.name.toUpperCase()} · ${st.label}${this.selUnit ? ` — task ${this.selUnit.callsign} here` : ''}`);
  }

  showHint(t) { $('hint').textContent = t; }

  // ====================================================================== crises
  renderCrises() {
    const g = this.g;
    $('crises').innerHTML = g.crises.map(cr => {
      const def = CRISES[cr.type];
      return `<div class="crisis" data-crisis="${cr.id}">
        <h4>⚠ ${esc(cr.title)}</h4><div class="loc">${esc(cr.where)} · <span data-left="${cr.id}"></span></div>
        <div class="hint">${esc(def.hint)}</div><div class="rw">+${def.reward} pts</div>
        <div class="timer"><b data-timer="${cr.id}"></b></div></div>`;
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
    el.innerHTML = `<time>${t}</time>${esc(msg)}`;
    const list = $('feed-list');
    list.prepend(el);
    while (list.children.length > 80) list.lastChild.remove();
  }

  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3700);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  }

  alert(title, sub = '', kind = 'bad') {
    const spoken = title.toLowerCase().replace(/defcon (\d)/, 'DEFCON $1').replace(/[:·]/g, ',');
    this.g.audio.say(spoken.charAt(0).toUpperCase() + spoken.slice(1), /missile|global war|defcon 1/i.test(title));
    const el = $('alert');
    el.classList.remove('hidden');
    el.style.color = kind === 'good' ? 'var(--green)' : '';
    el.style.borderColor = kind === 'good' ? 'var(--green)' : '';
    el.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
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
    const sel = this.dossier?.c;
    for (const s of g.world.sites) {
      if (!g.world.visible(s)) continue;
      const crisis = g.crises.find(cr => cr.siteId === s.id);
      const isSel = this.dossier?.site === s;
      const show = crisis || s.faction || sel?.i === s.ci || isSel || ['hostage', 'launcher', 'server'].includes(s.type);
      if (!show) continue;
      const L = this._label('s' + s.id, `marker site-pin ${s.alive ? '' : 'dead'}`, `${s.faction ? '☠ ' : ''}${esc(s.name)}`,
        llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.006), () => { this.openDossier(g.world.countries[s.ci], { site: s, op: SITE_TYPES[s.type].raidOnly ? 'raid' : 'strike' }); });
      L.minDist = crisis || isSel ? 9 : sel?.i === s.ci ? 3.2 : 2.2;
      L.el.style.borderColor = isSel ? '#fff' : '';
    }
    for (const cr of g.crises) {
      const s = cr.siteId ? g.world.sites.find(x => x.id === cr.siteId) : null;
      const vis = s && g.world.visible(s);
      const c = g.world.countries[cr.ci];
      const ll = vis ? s.ll : c.ll;
      const urgent = (cr.end - g.time) / (cr.end - cr.start) < 0.3;
      const L = this._label('k' + cr.id, `marker crisis-pin ${urgent ? 'urgent' : ''}`, '!', llToVec3(ll[0], ll[1], GLOBE_R * 1.012), () => {
        document.querySelector(`[data-crisis="${cr.id}"]`)?.click();
      });
      L.minDist = 99;
      L.offsetY = vis ? -22 : 0;
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
      const x = (tmp.x * 0.5 + 0.5) * w, y = (-tmp.y * 0.5 + 0.5) * h + (L.offsetY || 0);
      if (L.shown !== true) { L.el.style.display = ''; L.shown = true; }
      L.el.style.left = `${x.toFixed(1)}px`;
      L.el.style.top = `${y.toFixed(1)}px`;
      L.el.style.opacity = Math.min(1, (facing - 0.18) * 5).toFixed(2);
    }
  }

  // ====================================================================== modals
  modal(html, buttons = [['CLOSE', null]]) {
    this.modalOpen = true;
    $('screen-modal').classList.remove('hidden');
    $('modal-body').innerHTML = html + `<div class="row">${buttons.map(([l, , cls], i) => `<button data-b="${i}" class="${cls || ''}" style="${cls === 'go' ? 'width:auto;padding:8px 18px' : ''}">${l}</button>`).join('')}</div>`;
    $('modal-body').querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
      this.closeModal();
      const fn = buttons[+b.dataset.b][1];
      if (fn) fn();
    }));
  }

  closeModal() { this.modalOpen = false; $('screen-modal').classList.add('hidden'); }

  briefing() {
    const g = this.g, w = g.world;
    const hostiles = w.countries.filter(c => c.stance === 'hostile').map(c => c.name);
    this.modal(`<h2>COMMANDER'S BRIEFING</h2>
      <p>${g.sandbox ? '<b>UNRESTRICTED MODE.</b> Unlimited budget, no failure. The world is your theater.' : `You have <b>60 days</b>. Keep approval up, keep the world from tipping into global war, and resolve crises before their clocks run out.`}</p>
      <h3>THE WORLD</h3>
      <p><b style="color:#ff8b3d">Rival powers:</b> ${w.rivals.map(r => esc(r.name)).join(', ')} — strike them and the world holds its breath.<br>
      <b style="color:var(--red)">Hostile regimes:</b> ${hostiles.map(esc).join(', ')}.<br>
      <b style="color:#d85cff">Non-state threats:</b> ${w.factions.map(f => `${esc(f.name)} (${f.kind})`).join(', ')} — hidden until you find them.</p>
      <h3>HOW TO COMMAND</h3>
      <ul><li><b>Click a country</b> to open its dossier, pick an <b>operation</b>, tick the assets you want, check the odds, <b>EXECUTE</b>.</li>
      <li>Or <b>select a unit</b> in FORCES, then click any country to task it.</li>
      <li><b>Crisis cards</b> at the bottom are timed. Click one to jump straight to the right operation.</li>
      <li>Hidden targets need <b>intel</b>: satellites, drones and cyber recon reveal them. Blind their air defenses before you send aircraft.</li>
      <li><kbd>Space</kbd> pause · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed · <kbd>H</kbd> field manual · <kbd>M</kbd> mute · double-click to zoom.</li></ul>`,
      [['TAKE COMMAND', () => this.toast('The theater is yours, General.', 'good'), 'go']]);
  }

  help() {
    this.modal(`<h2>FIELD MANUAL</h2>
      <h3>ESCALATION LADDER</h3>
      <p>Recon & Aid (calm) → Patrol & Cyber blinding (low) → Strikes, Raids, Blockades, Grid attacks (medium) → Air Campaign (high) → Invasion & Declared War (maximum).
      Tension rises with escalation — far more against rivals, allies and neutrals. At <b>DEFCON 1</b> (tension 80+) you have 48 hours to calm things down.</p>
      <h3>ASSETS</h3>
      <ul>${Object.values(UNIT_TYPES).map(t => `<li><b>${t.icon} ${t.name}</b> — ${t.blurb}</li>`).join('')}</ul>
      <h3>TIPS</h3>
      <ul><li>Air losses come from SAMs and enemy fighters. <b>Cyber: Blind Air Defense</b> cuts SAMs by 85% for a day; stealth (B-2, F-35) and fighter escorts help too.</li>
      <li>Destroyers and carriers near a target automatically try to <b>intercept</b> incoming missiles. Park them near allies you care about.</li>
      <li><b>Invasions</b> need ground power greater than the defenders; air and naval forces on station add support. Captured countries pay you every day.</li>
      <li><b>Humanitarian aid</b> lowers tension and can turn neutrals into allies.</li>
      <li>Collateral damage costs approval. Better intel = more precise strikes.</li></ul>`);
  }

  menu() {
    const g = this.g;
    this.modal(`<h2>COMMAND MENU</h2><p>Day ${g.day} · Score ${Math.round(g.score)}</p>
      <p class="note">Campaign progress saves automatically every in-game day.</p>`,
      [['RESUME', null], [g.audio.muted ? 'UNMUTE' : 'MUTE', () => g.audio.toggleMute()], ['FIELD MANUAL', () => this.help()], ['QUIT TO TITLE', () => { g.save(); location.reload(); }]]);
  }

  endScreen(won, title, text) {
    const g = this.g, l = g.log;
    const r = g.rank();
    const final = g.finalScore();
    this.modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p>
      ${won ? `<div class="grade">${r[1]}</div><p style="text-align:center"><b>${r[2]}</b> · final score ${final}</p>` : `<div class="grade" style="color:var(--red)">F</div>`}
      <div class="kv">
        <span>Operations ordered</span><span>${l.ops}</span>
        <span>Crises resolved / failed</span><span>${l.crisesWon} / ${l.crisesLost}</span>
        <span>Targets destroyed</span><span>${l.sitesDestroyed}</span>
        <span>Terror cells eliminated</span><span>${l.cellsDestroyed}</span>
        <span>Countries secured</span><span>${l.controlled}</span>
        <span>Units lost</span><span>${l.unitsLost}</span>
        <span>Civilian harm index</span><span>${l.collateral.toFixed(1)}</span>
        <span>Final approval / tension</span><span>${Math.round(g.approval)} / ${Math.round(g.tension)}</span>
      </div>
      <h3>COMMENDATIONS (${g.medals.length}/${Object.keys(MEDALS).length})</h3>
      <p>${g.medals.length ? g.medals.map(id => `<span title="${esc(MEDALS[id][2])}" style="margin-right:12px">${MEDALS[id][0]} <b>${esc(MEDALS[id][1])}</b></span>`).join('') : '<span class="note">None.</span>'}</p>`, [['NEW CAMPAIGN', () => location.reload(), 'go']]);
  }

  key(e) {
    const g = this.g;
    if (!g.started || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); this.setSpeed(g.speed === 0 ? (this._lastSpeed || 1) : (this._lastSpeed = g.speed, 0)); }
    else if (e.key === '1') this.setSpeed(1);
    else if (e.key === '2') this.setSpeed(3);
    else if (e.key === '3') this.setSpeed(8);
    else if (e.key === 'h' || e.key === 'H') this.help();
    else if (e.key === 'm' || e.key === 'M') this.toast(g.audio.toggleMute() ? 'Audio muted' : 'Audio on');
    else if (e.key === 'v' || e.key === 'V') this.toast(g.audio.toggleVoice() ? 'Voice callouts on' : 'Voice callouts off');
    else if (e.key === 'Tab') { e.preventDefault(); const cards = [...document.querySelectorAll('[data-crisis]')]; if (cards.length) { this._crisisIdx = ((this._crisisIdx ?? -1) + 1) % cards.length; cards[this._crisisIdx].click(); } }
    else if (e.key === 'Escape') { if (this.modalOpen) this.closeModal(); else if (this.selUnit) { this.selUnit = null; this.showHint(''); this.dirtyForces = true; } else if (this.dossier) this.closeDossier(); else this.menu(); }
    else if ((e.key === 'f' || e.key === 'F') && this.selUnit) g.focusLL(this.selUnit.ll, 1.6);
  }
}

// Campaign world state: per-country military/diplomatic state, target sites and faction networks.
import { FACTIONS, SITE_TYPES, STANCE_STYLE } from './data.js';
import { distanceKm, jitterLL } from './geo.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let SITE_SEQ = 1;

export class World {
  constructor(data, globe, nav, rng) {
    this.data = data;
    this.globe = globe;
    this.nav = nav;
    this.rng = rng;
    this.sites = [];
    this.countries = data.countries.map((d, i) => this._initCountry(d, i));
    this.byId = new Map(this.countries.map(c => [c.id, c]));
    this.home = this.byId.get('USA');
    this.capitals = new Map();
    for (const city of data.cities) if (city.capital && !this.capitals.has(city.iso)) this.capitals.set(city.iso, city);
    this.listeners = [];
  }

  _initCountry(d, i) {
    const power = Math.log10(Math.max(2000, d.gdp));       // ~3.3 .. 7.4
    const mil = clamp((power - 3.2) * 23 + this.rng() * 8, 4, 100);
    const station = this.nav.stationFor(d);
    return {
      i, id: d.id, name: d.name, ll: d.label, pop: d.pop, gdp: d.gdp, area: d.area, region: d.region, continent: d.continent,
      stance: 'neutral', coastal: !!station, station,
      base: { mil, ad: mil * 0.85, air: mil * 0.9, navy: station ? mil * 0.75 : 0, missiles: mil > 50 ? Math.round(mil / 14) : (mil > 30 && this.rng() < 0.4 ? 2 : 0) },
      mil, ad: mil * 0.85, air: mil * 0.9, navy: station ? mil * 0.75 : 0, missiles: 0,
      intel: 10, stability: 60 + this.rng() * 30, relation: 0, aggression: 0, control: 0,
      adDownUntil: -1, gridDownUntil: -1, blockaded: false, usGround: 0, sitesBuilt: false,
      lastRetaliation: -999, struck: 0, collateral: 0,
    };
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev, data) { for (const fn of this.listeners) fn(ev, data); }

  // ------------------------------------------------------------------ scenario
  generate() {
    const rng = this.rng;
    const pool = this.countries.filter(c => c !== this.home && c.pop > 500000);
    const byPower = [...pool].sort((a, b) => b.base.mil - a.base.mil);
    this.setStance(this.home, 'home');
    this.home.intel = 100;

    // Two rival powers drawn from the strongest dozen militaries.
    const top = byPower.slice(0, 12);
    this.rivals = [];
    while (this.rivals.length < 2) {
      const c = top[Math.floor(rng() * top.length)];
      if (!this.rivals.includes(c)) this.rivals.push(c);
    }
    for (const c of this.rivals) { this.setStance(c, 'rival'); c.relation = -40; c.intel = 25; }

    // Hostile regimes: mid-tier states, spread out.
    const mid = byPower.slice(10, 90).filter(c => !this.rivals.includes(c));
    const hostiles = [];
    while (hostiles.length < 7 && mid.length) {
      const c = mid.splice(Math.floor(rng() * mid.length), 1)[0];
      if (hostiles.some(h => distanceKm(h.ll, c.ll) < 900)) continue;
      hostiles.push(c);
    }
    for (const c of hostiles) { this.setStance(c, 'hostile'); c.relation = -60; c.aggression = 20 + rng() * 30; c.intel = 20; }

    // Allies: a broad coalition of the remaining larger economies.
    const rest = pool.filter(c => c.stance === 'neutral').sort((a, b) => b.gdp - a.gdp).slice(0, 45);
    let allies = 0;
    for (const c of rest) {
      if (allies >= 17) break;
      if (this.rivals.some(r => distanceKm(r.ll, c.ll) < 1200) && rng() < 0.6) continue;
      if (rng() < 0.55) { this.setStance(c, 'ally'); c.relation = 60; c.intel = 55; allies++; }
    }

    // Faction networks in weak or hostile states.
    this.factions = FACTIONS.map(f => ({ ...f, cells: [], strength: 40 + rng() * 30 }));
    const weak = this.countries.filter(c => c.stance !== 'home' && c.stance !== 'ally' && c.stance !== 'rival' && c.pop > 300000);
    for (const f of this.factions) {
      const hosts = weak.filter(c => !f.coastal || c.coastal).sort(() => rng() - 0.5).slice(0, 3);
      for (const host of hosts) for (const t of f.sites) this.addSite(host, t, { faction: f.id });
    }
    this.globe.redrawAll();
  }

  setStance(c, stance, redraw = false) {
    const prev = c.stance;
    c.stance = stance;
    const st = STANCE_STYLE[stance];
    this.globe.setStyle(c.i, st.fill, st.border);
    if ((stance === 'hostile' || stance === 'rival') && !c.sitesBuilt) this.buildMilitarySites(c);
    if (redraw) this.globe.redrawAll();
    if (prev !== stance) this.emit('stance', { c, prev, stance });
  }

  /** Random point inside a country (falls back to its label point). */
  pointIn(c, spreadScale = 1) {
    const spread = clamp(Math.sqrt(c.area) * 0.55 * spreadScale, 0.6, 12);
    for (let k = 0; k < 40; k++) {
      const p = jitterLL(c.ll, spread, this.rng);
      if (this.globe.countryAt(p[0], p[1]) === c.i) return p;
    }
    return [...c.ll];
  }

  buildMilitarySites(c) {
    c.sitesBuilt = true;
    const n = (k) => Math.max(1, Math.round(k));
    for (let i = 0; i < n(c.base.mil / 35); i++) this.addSite(c, 'ad');
    for (let i = 0; i < n(c.base.mil / 50); i++) this.addSite(c, 'air');
    if (c.coastal && c.base.navy > 15) this.addSite(c, 'navy');
    const msl = c.base.missiles > 0 ? n(c.base.missiles / 3) : 0;
    for (let i = 0; i < msl; i++) this.addSite(c, 'missile');
    this.addSite(c, 'hq');
    this.recompute(c);
  }

  addSite(c, type, extra = {}) {
    const t = SITE_TYPES[type];
    const ll = type === 'navy' && c.station ? this._coastPoint(c) : type === 'hq' && this.capitals.get(c.id) ? this.capitals.get(c.id).ll : this.pointIn(c);
    const s = { id: SITE_SEQ++, type, name: t.name, ci: c.i, ll, hp: t.hp, maxHp: t.hp, alive: true, hidden: t.hidden || 0, obj: null, ...extra };
    if (extra.faction) {
      const f = this.factions?.find(x => x.id === extra.faction);
      if (f) { s.name = `${f.name} ${t.name.replace('Terror ', '')}`; f.cells.push(s); }
    }
    this.sites.push(s);
    this.emit('site', s);
    return s;
  }

  _coastPoint(c) {
    // a land point near the sea station
    const [lon, lat] = c.station;
    let best = c.ll, bd = Infinity;
    for (let k = 0; k < 30; k++) {
      const p = this.pointIn(c, 1.2);
      const d = distanceKm(p, [lon, lat]);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  sitesOf(c) { return this.sites.filter(s => s.ci === c.i); }
  visible(s) { return s.alive && this.countries[s.ci].intel >= s.hidden; }

  /** Re-derive a country's combat stats from its surviving sites and status effects. */
  recompute(c, now = 0) {
    const sum = (type) => {
      const list = this.sites.filter(s => s.ci === c.i && s.type === type);
      if (!list.length) return 1;
      return list.reduce((a, s) => a + (s.alive ? s.hp : 0), 0) / list.reduce((a, s) => a + s.maxHp, 0);
    };
    const hq = sum('hq');
    const blockade = c.blockaded ? 0.85 : 1;
    const grid = c.gridDownUntil > now ? 0.75 : 1;
    c.ad = c.base.ad * sum('ad') * (c.adDownUntil > now ? 0.15 : 1) * grid;
    c.air = c.base.air * sum('air') * grid * (0.7 + 0.3 * hq);
    c.navy = c.base.navy * sum('navy') * blockade;
    c.missiles = Math.round(c.base.missiles * sum('missile'));
    c.mil = c.base.mil * (0.4 + 0.6 * ((sum('ad') + sum('air') + sum('missile') + hq) / 4)) * blockade * grid;
  }

  damageSite(s, amount) {
    if (!s.alive) return false;
    s.hp -= amount;
    if (s.hp <= 0) { s.hp = 0; s.alive = false; }
    this.recompute(this.countries[s.ci]);
    return !s.alive;
  }

  nearestCapital(c) { return this.capitals.get(c.id)?.ll || c.ll; }

  /** Pick an allied city near a point (for terror attacks / missile targets). */
  allyCityNear(ll) {
    let best = null, bd = Infinity;
    for (const city of this.data.cities) {
      const c = this.byId.get(city.iso);
      if (!c || !(c.stance === 'ally' || c.stance === 'home')) continue;
      const d = distanceKm(ll, city.ll) * (0.7 + this.rng() * 0.6);
      if (d < bd && city.pop > 500000) { bd = d; best = city; }
    }
    return best;
  }
}

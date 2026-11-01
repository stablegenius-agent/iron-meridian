// Game orchestrator: time, simulation ticks, crises, enemy AI, input, camera, persistence.
import * as THREE from 'three';
import { BASES, CRISES, FACTIONS, MEDALS, PROCURE, RANKS, ROSTER, SANDBOX_EXTRA, SITE_TYPES, STANCE_STYLE, UNIT_TYPES } from './data.js';
import { GLOBE_R, distanceKm, llToVec3, makeRng, slerpUnit, vec3ToLL } from './geo.js';
import { SeaNav } from './nav.js';
import { World } from './world.js';
import { Unit } from './units.js';
import { FX } from './fx.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { campaignSortie, execute } from './ops.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CAMPAIGN_DAYS = 60;

export class Game {
  constructor(ctx) {
    Object.assign(this, ctx);
    this.unitLayer = new THREE.Group();
    this.enemyLayer = new THREE.Group();
    this.scene.add(this.unitLayer, this.enemyLayer);
    this.nav = new SeaNav(this.globe);
    this.fx = new FX(this.scene, document.getElementById('labels'));
    this.audio = new Audio();
    this.ui = new UI(this);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.started = false;
    this.speed = 1;
    this.time = 6;
    this.timers = [];
    this.camAnim = null;
    this.fps = 60;
    this.titleSpin = true;
    this._bindInput();
    this.ui.bindTitle();
  }

  // ====================================================================== lifecycle
  start(mode, difficulty = 1, seed = (Math.random() * 1e9) | 0, save = null) {
    this.mode = mode;
    this.sandbox = mode === 'sandbox';
    this.difficulty = difficulty;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.time = 6;
    this.nextOpId = 1;
    this.budget = this.sandbox ? Infinity : 45;
    this.procured = [];
    this.approval = 62;
    this.tension = 22;
    this.score = 0;
    this.crises = [];
    this.crisisSeq = 1;
    this.nextCrisisAt = 10;
    this.defcon1Since = -1;
    this.log = { ops: 0, sitesDestroyed: 0, cellsDestroyed: 0, crisesWon: 0, crisesLost: 0, unitsLost: 0, collateral: 0, controlled: 0, aid: 0 };
    this.medals = [];
    this.peakTension = 0;
    this.lastHour = Math.floor(this.time);
    this.over = false;

    this.world = new World(this.globe.world, this.globe, this.nav, this.rng);
    this.world.on((ev, d) => this._onWorld(ev, d));
    this.world.generate();

    this.bases = BASES.map(b => ({ ...b }));
    const baseById = new Map(this.bases.map(b => [b.id, b]));
    const roster = this.sandbox ? [...ROSTER, ...SANDBOX_EXTRA] : ROSTER;
    this.units = roster.map(([type, base, cs]) => new Unit(this, type, baseById.get(base), cs));
    this._buildBaseMarkers();
    this._buildSiteVisuals();

    if (save) this._applySave(save);

    this.started = true;
    this.titleSpin = false;
    this.ui.startHud();
    this.focusLL(this.world.home.ll, 3.0, 1.6);
    if (!save) {
      this.feed(`Theater command established. ${this.world.rivals.map(r => r.name).join(' and ')} are on the rise.`, 'info');
      this.after(2.5, () => this.spawnCrisis('plot'));
      this.after(6, () => this.spawnCrisis(this.rng() < 0.5 ? 'disaster' : 'pirates'));
      this.ui.briefing();
    }
  }

  // ====================================================================== frame
  update(dt, t) {
    this.globe.update(dt, t, this.camera);
    this._camera(dt, t);
    const camDist = this.camera.position.length();
    this.viewScale = clamp((camDist - 1) * 1.05, 0.22, 2.6);

    if (!this.started) {
      this.fx.update(dt, this.camera, innerWidth, innerHeight);
      return;
    }

    const run = this.speed > 0 && !this.over && !this.ui.modalOpen;
    const gdt = run ? dt * this.speed : 0;
    this.time += gdt;
    this.globe.setSunLon((12 - (this.time % 24)) * 15);

    // real-time timers (frozen while paused)
    if (run) {
      for (let i = this.timers.length - 1; i >= 0; i--) {
        const tm = this.timers[i];
        tm.left -= dt;
        if (tm.left <= 0) { this.timers.splice(i, 1); tm.fn(); }
      }
    }

    for (const u of this.units) u.update(gdt, run ? dt : 0, this.viewScale);
    this._selectionRing(dt);
    this._updateEnemyVisuals(dt);
    while (this.lastHour < Math.floor(this.time)) {
      this.lastHour++;
      this._tickHour(this.lastHour);
      if (this.lastHour % 24 === 6) this._tickDay();
    }
    this.fx.update(run ? dt : dt * 0.25, this.camera, innerWidth, innerHeight);
    this.ui.frame(dt);
    this.audio.setTension(this.tension);
    this.globe.uniforms.warTint.value += ((this.tension > 80 ? 1 : this.tension > 60 ? 0.4 : 0) - this.globe.uniforms.warTint.value) * dt;
  }

  after(sec, fn) { this.timers.push({ left: sec, fn }); }

  /** Dashed route previews from each unit to the target while an operation is being planned. */
  setPreview(units, targetLL) {
    if (!this.previewGroup) { this.previewGroup = new THREE.Group(); this.scene.add(this.previewGroup); }
    for (const l of this.previewGroup.children) { l.geometry.dispose(); l.material.dispose(); }
    this.previewGroup.clear();
    if (!units?.length || !targetLL) return;
    const b = llToVec3(targetLL[0], targetLL[1], 1).normalize();
    for (const u of units) {
      if (u.cls === 'cyber') continue;
      const a = u.cls === 'space' ? u.worldPos().clone().normalize() : llToVec3(u.ll[0], u.ll[1], 1).normalize();
      const peak = u.cls === 'naval' ? 0.004 : u.cls === 'space' ? 0.2 : 0.03;
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const p = slerpUnit(a, b, i / 40, new THREE.Vector3()).normalize();
        pts.push(p.multiplyScalar(GLOBE_R + 0.002 + peak * Math.sin(Math.PI * i / 40)));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: u.cls === 'naval' ? 0x7fd8ff : 0xffe28a, dashSize: 0.012, gapSize: 0.01, transparent: true, opacity: 0.85, depthWrite: false }));
      line.computeLineDistances();
      this.previewGroup.add(line);
    }
  }

  _selectionRing(dt) {
    if (!this.selRing) {
      this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color: 0x66e0ff, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.scene.add(this.selRing);
    }
    const u = this.ui.selUnit;
    this.selRing.visible = !!u && u.state !== 'lost' && u.cls !== 'cyber';
    if (!this.selRing.visible) return;
    const p = u.worldPos();
    if (u.cls === 'air' && !u.obj?.visible) llToVec3(u.ll[0], u.ll[1], GLOBE_R * 1.002, p);
    this.selRing.position.copy(p);
    this.selRing.lookAt(p.clone().multiplyScalar(2));
    const pulse = 1 + 0.25 * Math.sin(performance.now() / 180);
    this.selRing.scale.setScalar(0.022 * this.viewScale * pulse);
    this.selRing.material.opacity = 0.9;
  }

  _ambient(h) {
    // Enemy air forces fly patrols over their own territory so the world feels alive.
    if (h % 2) return;
    const w = this.world;
    const fliers = w.countries.filter(c => (c.stance === 'hostile' || c.stance === 'rival') && c.air > 20);
    if (!fliers.length) return;
    const c = fliers[Math.floor(this.rng() * fliers.length)];
    const bases = w.sites.filter(s => s.ci === c.i && s.alive && s.type === 'air');
    const from = bases.length ? bases[0].ll : w.pointIn(c);
    const to = w.pointIn(c, 1.2);
    const jet = this.models.create('fighter', c.stance === 'rival' ? 'rival' : 'hostile', 0.018 * this.viewScale);
    this.fx.projectile(llToVec3(from[0], from[1], GLOBE_R * 1.001), llToVec3(to[0], to[1], GLOBE_R * 1.001),
      { peak: 0.025, duration: 4 + this.rng() * 3, color: 0xff8070, model: jet });
  }

  medal(id) {
    if (!MEDALS[id] || this.medals.includes(id)) return;
    this.medals.push(id);
    const [icon, name, desc] = MEDALS[id];
    this.score += 40;
    this.toast(`${icon} COMMENDATION · ${name.toUpperCase()}`, 'good');
    this.feed(`Commendation awarded: ${name} — ${desc} (+40)`, 'good');
    this.after(0.8, () => this.audio.say(`Commendation. ${name}.`));
  }

  // ====================================================================== simulation
  _tickHour(h) {
    const w = this.world;
    // air units on station: campaign sorties, loiter expiry
    for (const u of this.units) {
      if (u.cls === 'air' && u.state === 'onstation') {
        const c = w.countries[u.task?.ci];
        if (u.task?.op === 'campaign' && c && this.time >= u.nextSortie) {
          u.nextSortie = this.time + (u.type === 'bomber' ? 6 : u.type === 'drone' ? 3 : 4);
          if (!campaignSortie(this, u, c)) {
            u.loiterUntil = this.time;
            if (!c.campaignDoneMsg || this.time - c.campaignDoneMsg > 24) {
              c.campaignDoneMsg = this.time;
              const hidden = this.world.sitesOf(c).filter(s => s.alive && !this.world.visible(s)).length;
              this.feed(`Air campaign over ${c.name}: all known targets destroyed.${hidden ? ` ${hidden} signature(s) still hidden — run Recon.` : ''}`, 'good');
            }
          }
        }
        if (this.time >= u.loiterUntil) { u.orbitCenter = null; u.returnHome(); this.ui.dirtyForces = true; }
      }
    }
    // blockades bleed the target
    for (const c of w.countries) {
      const blockers = this.units.filter(u => u.cls === 'naval' && u.state === 'onstation' && u.stationCi === c.i && u.task?.op === 'blockade');
      const was = c.blockaded;
      c.blockaded = blockers.length > 0;
      if (c.blockaded) { c.base.mil = Math.max(5, c.base.mil - 0.08 * blockers.length); c.stability -= 0.05; }
      if (was !== c.blockaded || c.adDownUntil > 0 || c.gridDownUntil > 0) w.recompute(c, this.time);
    }
    // invasions
    for (const c of w.countries) {
      const troops = this.units.filter(u => u.cls === 'ground' && u.state === 'onstation' && u.task?.ci === c.i && u.task.op === 'invade');
      if (!troops.length || c.stance === 'controlled') continue;
      const power = troops.reduce((a, u) => a + u.t.ground * (u.hp / 100), 0) + this.supportPower(c);
      const def = c.mil * 0.55 + (c.stance === 'rival' ? 30 : 0) + c.stability * 0.1;
      c.control = clamp(c.control + (power * 3.2 - def * 0.6) / 30, 0, 100);
      // attrition both ways
      for (const u of troops) {
        u.hp -= def / (power * 4 + 10) * 1.1 * this.difficulty * (0.5 + this.rng());
        if (u.hp <= 0) { this.unitLost(u, `destroyed in fighting in ${c.name}`); }
      }
      c.base.mil = Math.max(3, c.base.mil - power * 0.03);
      w.recompute(c, this.time);
      if (h % 2 === 0) this._groundBattleFx(c, troops);
      if (c.control >= 100) this._captureCountry(c, troops);
      this.ui.dirtyForces = true;
    }
    // crises
    for (const cr of [...this.crises]) this._crisisTick(cr);
    if (this.time >= this.nextCrisisAt) {
      this.spawnCrisis();
      // Threat surges: occasionally two crises hit at once, more often as the campaign wears on.
      if (this.rng() < 0.1 + this.day / 200) this.after(3, () => this.spawnCrisis());
      const ramp = (0.85 + this.day / 40) * (0.9 + this.tension / 160) * this.difficulty;
      this.nextCrisisAt = this.time + (18 + this.rng() * 22) / ramp;
    }
    // escalation watchdog
    if (this.tension >= 80) {
      if (this.defcon1Since < 0) { this.defcon1Since = this.time; this.ui.alert('DEFCON 1', 'Global war in 48 hours unless tension falls below 80'); this.audio.alarm(); }
      else if (this.time - this.defcon1Since >= 48 && !this.globalWarFired) this._globalWar();
      else if (this.time - this.defcon1Since >= 24 && !this.warned24) { this.warned24 = true; this.ui.alert('24 HOURS TO GLOBAL WAR', 'Send aid, recall forces, stand down'); this.audio.alarm(); }
    } else { this.defcon1Since = -1; this.warned24 = false; }
    // approval is bounded, and collapse ends the campaign immediately
    this.approval = clamp(this.approval, 0, 100);
    if (!this.sandbox && this.approval <= 10 && !this.over) return this._lose('RELIEVED OF COMMAND', 'Domestic approval collapsed. The President has accepted your resignation.');
    // rivals poke at you when tension is high
    if (this.tension > 60 && this.rng() < (this.tension - 55) / 4000) this.spawnCrisis('rivalfleet');
    // hostile retaliation against forces on their doorstep
    if (h % 3 === 0) this._enemyActivity();
    if (this.speed <= 3) this._ambient(h);
    this.peakTension = Math.max(this.peakTension, this.tension);
    if (this.peakTension >= 60 && this.tension <= 25) this.medal('peacemaker');
    if (this.log.ops >= 15 && this.log.unitsLost === 0) this.medal('untouchable');
    if (this.log.crisesWon >= 5) this.medal('crisis_master');
    this.ui.dirtyTop = true;
  }

  _tickDay() {
    const day = this.day;
    if (!this.sandbox) {
      const income = 4 + this.approval * 0.08 + this.world.countries.filter(c => c.stance === 'controlled').length * 2.5;
      this.budget += income;
      this.feed(`Day ${day}: budget +$${income.toFixed(1)}B.`, '');
    }
    // drift: the world cools off if you let it
    this.addTension(-(2.5 + (this.tension > 60 ? 3 : 0)));
    this.approval += (55 - this.approval) * 0.04;
    const occupations = this.world.countries.filter(c => c.stance === 'controlled').length;
    const invasions = new Set(this.units.filter(u => u.task?.op === 'invade').map(u => u.task.ci)).size;
    this.approval -= invasions * 0.8 + occupations * 0.3;
    // factions regrow, hostile aggression creeps up
    for (const f of this.world.factions) f.strength = clamp(f.strength + 1.5, 0, 100);
    for (const c of this.world.countries) {
      if (c.stance === 'hostile') c.aggression = clamp(c.aggression + 1.2 * this.difficulty, 0, 100);
      if (c.stance === 'controlled') {
        c.stability = clamp(c.stability + 1.5, 0, 100);
        if (c.stability < 40 && this.rng() < 0.25) { const s = this.world.addSite(c, 'cell', { faction: 'lotus' }); this._siteVisual(s); this.feed(`Insurgents organize in occupied ${c.name}.`, 'warn'); }
      }
      if (c.intel > 30 && c.stance !== 'ally' && c.stance !== 'home') c.intel = Math.max(20, c.intel - 1.5);
    }
    this.approval = clamp(this.approval, 0, 100);
    if (!this.sandbox) {
      if (this.approval <= 10) return this._lose('RELIEVED OF COMMAND', 'Domestic approval collapsed. The President has accepted your resignation.');
      if (day > CAMPAIGN_DAYS) return this._victory();
      if (day === CAMPAIGN_DAYS) this.ui.alert('FINAL DAY', 'Campaign review at 06:00Z tomorrow');
    }
    this.save();
  }

  get day() { return Math.floor(this.time / 24) + 1; }

  // ====================================================================== shared effects
  addTension(d) {
    const before = this.tension;
    this.tension = clamp(this.tension + d, 0, 100);
    const dc = (t) => 5 - Math.min(4, Math.floor(t / 20));
    if (dc(this.tension) < dc(before)) { this.ui.alert(`DEFCON ${dc(this.tension)}`, this.tension >= 60 ? 'Rival powers are mobilizing' : 'Readiness increased'); this.audio.alarm(); }
    this.ui.dirtyTop = true;
  }

  collateral(c, amount) {
    if (amount <= 0.05) return;
    this.log.collateral += amount;
    this.approval -= amount * 0.45;
    this.score -= amount * 4;
    this.addTension(amount * 0.4);
    c.stability -= amount;
    if (amount > 2.5) this.feed(`Civilian casualties reported in ${c.name}. International outcry.`, 'bad');
  }

  supportPower(c) {
    return this.units.filter(u => u.state === 'onstation' && (u.task?.ci === c.i || u.stationCi === c.i) && (u.cls === 'air' || u.cls === 'naval'))
      .reduce((a, u) => a + (u.t.air || 0) * 0.5 + (u.t.strike || 0) * 0.3, 0);
  }

  defensePower(c) {
    return this.units.filter(u => u.state === 'onstation' && (u.task?.ci === c.i || u.stationCi === c.i))
      .reduce((a, u) => a + (u.t.air || 0) + (u.t.ground || 0) + (u.t.naval || 0) * 0.5 + (u.t.defense || 0) * 0.5, 0);
  }

  siteDestroyed(s, u, how) {
    const c = this.world.countries[s.ci];
    const faction = !!s.faction;
    this.log.sitesDestroyed++;
    if (faction) this.log.cellsDestroyed++;
    const pts = s.type === 'hostage' ? 0 : faction ? 30 : 15;
    this.score += pts;
    if (s.type !== 'hostage') this.medal('first_blood');
    if (s.type === 'hostage' && how === 'raid') this.medal('hostages');
    if (u?.type === 'orbital') this.medal('rods');
    if (u) u.kills++;
    this.fx.popup(llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.01), `${s.name.toUpperCase()} DESTROYED`, 'controlled');
    if (s.type !== 'hostage') this.feed(`${s.name} in ${c.name} destroyed${u ? ` by ${u.name}` : ''}.`, 'good');
    if (faction) {
      const f = this.world.factions.find(x => x.id === s.faction);
      if (f) { f.strength = clamp(f.strength - 14, 0, 100); if (f.cells.every(x => !x.alive)) { this.ui.alert(`${f.name.toUpperCase()} DISMANTLED`, 'Network eliminated', 'good'); this.score += 120; this.approval += 5; this.audio.success(); this.medal('dismantled'); } }
    }
    // crisis resolution hooks
    this.resolveCrisisWhere(cr => cr.siteId === s.id && !(cr.type === 'hostage' && how !== 'raid'), how === 'raid' && s.type === 'hostage' ? 'Hostages rescued' : 'Threat neutralized');
    if (s.type === 'hostage' && how !== 'raid') this.failCrisisWhere(cr => cr.siteId === s.id, 'Hostages killed in the strike');
    if (s.obj) { s.obj.visible = false; }
    this.ui.refreshSites();
    this.ui.dirtyTop = true;
  }

  unitLost(u, why) {
    if (u.state === 'lost') return;
    u.destroy();
    this.log.unitsLost++;
    this.approval -= this.sandbox ? 0 : 3.5;
    this.score -= 25;
    this.feed(`${u.name} ${why}.`, 'bad');
    this.toast(`${u.t.short} ${u.name} LOST`, 'bad');
    this.audio.fail();
    this.ui.dirtyForces = true;
  }

  startInvasion(c, u) {
    if (!this.units.some(x => x !== u && x.task?.op === 'invade' && x.task.ci === c.i && x.state === 'onstation')) {
      this.ui.alert(`INVASION OF ${c.name.toUpperCase()}`, 'Ground forces engaged');
      this.audio.alarm();
    }
    this.feed(`${u.name} has landed in ${c.name}. Ground war underway.`, 'warn');
  }

  _captureCountry(c, troops) {
    this.world.setStance(c, 'controlled', true);
    c.control = 100;
    c.stability = 30;
    c.base.mil = Math.min(c.base.mil, 25);
    for (const s of this.world.sitesOf(c)) if (!s.faction && s.alive) { s.alive = false; if (s.obj) s.obj.visible = false; }
    this.world.recompute(c, this.time);
    for (const u of troops) u.task.op = 'patrol';
    this.log.controlled++;
    this.score += 80 + Math.round(c.base.mil);
    this.approval += 4;
    this.addTension(c.stance === 'rival' ? 15 : 4);
    this.ui.alert(`${c.name.toUpperCase()} SECURED`, 'US forces control the country', 'good');
    this.medal('kingmaker');
    this.audio.success();
    this.resolveCrisisWhere(cr => cr.data?.aggressor === c.i, 'Aggressor neutralized');
    this.ui.refreshLabels();
    this.ui.refreshSites();
  }

  _groundBattleFx(c, troops) {
    for (const u of troops.slice(0, 2)) {
      if (!u.ground) continue;
      const o = u.ground[Math.floor(this.rng() * u.ground.length)];
      const tgt = llToVec3(...this.world.pointIn(c, 0.4), GLOBE_R * 1.001);
      this.fx.tracers(o.position, tgt, 0xffd27a, 4, 0.6);
      if (this.rng() < 0.5) this.after(0.4, () => this.fx.explosion(tgt, 0.6));
    }
    this.audio.gunfire();
  }

  globeFlash(c) {
    const p = llToVec3(c.ll[0], c.ll[1], GLOBE_R * 1.01);
    this.fx.sprite(p, 0x3dffc5, 0.12, 1.2, { grow: 2 });
  }

  // ====================================================================== enemy behaviour
  _enemyActivity() {
    const w = this.world;
    for (const c of w.countries) {
      if (c.stance !== 'hostile' && c.stance !== 'rival') continue;
      // Retaliate against US forces parked in or near their territory.
      const near = this.units.filter(u => u.state === 'onstation' && (u.task?.ci === c.i || u.stationCi === c.i));
      if (near.length && c.missiles > 0 && this.time - c.lastRetaliation > 18 && this.rng() < 0.18 * (c.aggression / 60) * this.difficulty) {
        c.lastRetaliation = this.time;
        const tgt = near[Math.floor(this.rng() * near.length)];
        this.enemyMissile(c, { unit: tgt, ll: tgt.ll }, Math.min(3, 1 + Math.floor(c.missiles / 3)));
      }
      // Struck states lash out at the region.
      if (c.struck > 0 && c.missiles > 0 && this.time - c.lastRetaliation > 40 && this.rng() < 0.07 * this.difficulty) {
        c.lastRetaliation = this.time;
        c.struck = Math.max(0, c.struck - 1);
        const city = w.allyCityNear(c.ll);
        if (city) this.enemyMissile(c, { city, ll: city.ll }, 2);
      }
    }
  }

  /** Enemy launches `n` missiles; nearby US destroyers/carriers and space assets try to intercept. */
  enemyMissile(fromC, target, n = 1) {
    const from = llToVec3(...this.world.pointIn(fromC, 0.5), GLOBE_R * 1.002);
    const toLL = target.ll;
    const to = llToVec3(toLL[0], toLL[1], GLOBE_R * 1.002);
    const dist = distanceKm(vec3ToLL(from), toLL);
    this.ui.alert('MISSILE LAUNCH DETECTED', `${fromC.name} → ${target.city ? target.city.name : target.unit ? target.unit.name : 'target'}`);
    this.audio.alarm();
    this.feed(`${fromC.name} launched ${n} missile${n > 1 ? 's' : ''} at ${target.city ? target.city.name : target.unit?.name}.`, 'bad');
    const defenders = this.units.filter(u => (u.type === 'destroyer' || u.type === 'carrier') && u.state !== 'lost' && distanceKm(u.ll, toLL) < 3200);
    const spaceShield = this.units.some(u => u.type === 'satellite' && u.state !== 'lost');
    const flight = clamp(2 + dist / 2500, 2.5, 6);
    for (let i = 0; i < n; i++) {
      this.after(i * 0.5, () => {
        const m = this.models.create('missile', 'hostile', 0.013);
        let pInt = 1 - defenders.reduce((p, d) => p * (1 - (d.t.defense || 0) * 0.085), 1);
        if (spaceShield) pInt = 1 - (1 - pInt) * 0.85;
        const intercepted = this.rng() < pInt;
        const peak = clamp(dist / 9000, 0.06, 0.35);
        const proj = this.fx.projectile(from, to, { peak, duration: flight, color: 0xff6050, model: m, onHit: (p) => {
          if (proj.dead) return;
          this._missileImpact(fromC, target, p);
        } });
        if (intercepted && defenders.length) {
          const d = defenders[Math.floor(this.rng() * defenders.length)];
          // Interceptor launches so that it meets the warhead at ~70% of its flight.
          this.after(flight * 0.35, () => {
            const meetT = 0.72;
            const a = from.clone().normalize(), b = to.clone().normalize();
            const meet = slerpUnit(a, b, meetT, new THREE.Vector3()).normalize().multiplyScalar(GLOBE_R + peak * Math.sin(Math.PI * meetT) + 0.002);
            this.audio.intercept();
            this.fx.projectile(d.worldPos(), meet, { peak: 0.02, duration: flight * 0.37, color: 0x8fe8ff, width: 0.8, onHit: () => {
              proj.dead = true;
              proj.age = proj.life; // stop the warhead
              this.fx.explosion(meet, 1.4, 0x9fe8ff);
              this.fx.popup(meet, 'INTERCEPTED', 'ally');
              this.score += 20;
              this.medal('shield');
              d.kills++;
            } });
          });
        }
      });
    }
  }

  _missileImpact(fromC, target, p) {
    this.fx.explosion(p, 2.2, 0xff5030);
    this.audio.explosion(2.2);
    if (target.unit && target.unit.state !== 'lost') {
      const u = target.unit;
      u.hp -= 45 + this.rng() * 30;
      if (u.hp <= 0) this.unitLost(u, `destroyed by a ${fromC.name} missile strike`);
      else this.feed(`${u.name} hit by ${fromC.name} missile. Hull at ${Math.round(u.hp)}%.`, 'bad');
    } else if (target.city) {
      this.approval -= this.sandbox ? 0 : 4;
      this.score -= 30;
      this.addTension(3);
      this.feed(`Missile strike hits ${target.city.name}. Casualties reported.`, 'bad');
      this.toast(`${target.city.name.toUpperCase()} HIT`, 'bad');
    }
    this.ui.dirtyForces = true;
  }

  _globalWar() {
    this.globalWarFired = true;
    this.ui.alert('GLOBAL WAR', 'The rival powers have launched');
    for (const r of this.world.rivals) for (let i = 0; i < 3; i++) {
      const city = this.world.allyCityNear([this.rng() * 360 - 180, this.rng() * 120 - 60]);
      if (city) this.after(i * 0.7, () => this.enemyMissile(r, { city, ll: city.ll }, 3));
    }
    if (!this.sandbox) this.after(9, () => this._lose('GLOBAL WAR', 'Tension stayed at DEFCON 1 for 48 hours. The rival powers struck first.'));
    else this.after(10, () => { this.tension = 60; this.defcon1Since = -1; this.globalWarFired = false; this.feed('Ceasefire. The rival powers stand down — for now.', 'info'); });
  }

  // ====================================================================== crises
  spawnCrisis(type) {
    const w = this.world, rng = this.rng;
    if (this.crises.length >= (this.sandbox ? 6 : 5)) return;
    if (!type) {
      // Weighted by the state of the world: strong networks plot, aggressive regimes invade.
      const fac = (id) => (this.world.factions.find(f => f.id === id)?.strength || 0) / 50;
      const aggr = w.countries.filter(c => c.stance === 'hostile').reduce((a, c) => a + c.aggression, 0) / 300;
      const weights = { plot: 1.2 * (fac('lotus') + fac('veil')) / 2 + 0.3, hostage: 0.8, missile: 0.7 + aggr * 0.5, pirates: 0.6 * fac('tide') + 0.2,
        cyber: 0.6 * fac('null') + 0.2, invasion: 0.3 + aggr, disaster: 0.7, rivalfleet: 0.15 + this.tension / 140 };
      let r = rng() * Object.values(weights).reduce((a, b) => a + b, 0);
      for (const [k, wt] of Object.entries(weights)) { r -= wt; if (r <= 0) { type = k; break; } }
      type = type || 'plot';
    }
    const def = CRISES[type];
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const cr = { id: this.crisisSeq++, type, title: def.title, start: this.time, end: this.time + def.hours * (this.sandbox ? 1.4 : 1) / Math.sqrt(this.difficulty), data: {} };
    const hostiles = w.countries.filter(c => c.stance === 'hostile');
    const allies = w.countries.filter(c => c.stance === 'ally');
    const notFriendly = w.countries.filter(c => c.stance !== 'ally' && c.stance !== 'home' && c.stance !== 'controlled' && c.pop > 1e6);
    switch (type) {
      case 'plot': {
        const f = pick(this.world.factions.filter(f => f.id === 'lotus' || f.id === 'veil'));
        const host = pick(notFriendly);
        const s = w.addSite(host, 'cell', { faction: f.id });
        this._siteVisual(s);
        Object.assign(cr, { ci: host.i, siteId: s.id, faction: f.id, title: `${f.name} Plot` });
        break;
      }
      case 'hostage': {
        const host = pick(notFriendly);
        const s = w.addSite(host, 'hostage');
        this._siteVisual(s);
        Object.assign(cr, { ci: host.i, siteId: s.id });
        break;
      }
      case 'missile': {
        const cands = hostiles.filter(c => c.base.missiles > 0);
        if (!cands.length) return this.spawnCrisis('plot');
        const host = pick(cands);
        const s = w.addSite(host, 'launcher');
        this._siteVisual(s);
        const city = w.allyCityNear(host.ll);
        Object.assign(cr, { ci: host.i, siteId: s.id, data: { city } });
        break;
      }
      case 'pirates': {
        const f = this.world.factions.find(f => f.id === 'tide');
        const coastal = notFriendly.filter(c => c.coastal);
        const host = pick(coastal.length ? coastal : notFriendly);
        const s = w.addSite(host, 'pirate', { faction: 'tide' });
        this._siteVisual(s);
        Object.assign(cr, { ci: host.i, siteId: s.id, faction: f.id });
        break;
      }
      case 'cyber': {
        const host = pick(notFriendly);
        const s = w.addSite(host, 'server', { faction: 'null' });
        this._siteVisual(s);
        Object.assign(cr, { ci: host.i, siteId: s.id, faction: 'null' });
        break;
      }
      case 'invasion': {
        // a hostile state moves on its nearest ally
        let best = null;
        for (const h of hostiles) for (const a of allies) {
          const d = distanceKm(h.ll, a.ll);
          if (d < 3500 && (!best || d < best.d)) best = { h, a, d };
        }
        if (!best) return this.spawnCrisis('disaster');
        Object.assign(cr, { ci: best.a.i, data: { aggressor: best.h.i, power: best.h.mil * 0.6 } });
        cr.title = `${best.h.name} Invades ${best.a.name}`;
        this._spawnInvasionForce(cr, best.h, best.a);
        break;
      }
      case 'disaster': {
        const host = pick(w.countries.filter(c => (c.stance === 'neutral' || c.stance === 'ally') && c.pop > 5e6));
        const kind = pick(['Earthquake', 'Typhoon', 'Flooding', 'Famine', 'Wildfires']);
        Object.assign(cr, { ci: host.i, title: `${kind} in ${host.name}` });
        break;
      }
      case 'rivalfleet': {
        const r = pick(w.rivals.filter(c => c.coastal).length ? w.rivals.filter(c => c.coastal) : w.rivals);
        const nearAllies = allies.filter(a => a.coastal).sort((a, b) => distanceKm(a.ll, r.ll) - distanceKm(b.ll, r.ll));
        const a = nearAllies[0];
        if (!a) return;
        Object.assign(cr, { ci: a.i, data: { rival: r.i }, title: `${r.name} Fleet Near ${a.name}` });
        this._spawnRivalFleet(cr, r, a);
        break;
      }
    }
    if (cr.ci === undefined) return;
    const c = w.countries[cr.ci];
    cr.where = c.name;
    this.crises.push(cr);
    this.feed(`CRISIS: ${cr.title} — ${c.name}. ${def.hint}`, 'warn');
    this.toast(`NEW CRISIS · ${cr.title.toUpperCase()}`, 'warn');
    this.audio.alarm();
    this.ui.renderCrises();
    this.ui.refreshSites();
  }

  _crisisTick(cr) {
    const w = this.world;
    const c = w.countries[cr.ci];
    if (cr.type === 'pirates' || cr.type === 'rivalfleet') {
      const guard = this.units.some(u => u.cls === 'naval' && u.state === 'onstation' && u.stationCi === cr.ci);
      cr.progress = guard ? (cr.progress || 0) + 1 : Math.max(0, (cr.progress || 0) - 0.5);
      if (cr.progress >= 10) return this._crisisWon(cr, cr.type === 'pirates' ? 'Shipping lanes secured' : 'Rival fleet withdrew');
    }
    if (cr.type === 'invasion') {
      const agg = w.countries[cr.data.aggressor];
      const def = this.defensePower(c);
      cr.progress = def;
      if (agg.stance === 'controlled' || agg.mil < agg.base.mil * 0.35 || agg.mil < 12) return this._crisisWon(cr, 'Aggressor broken');
      if (def >= agg.mil * 0.6 && this.time - cr.start > 24) return this._crisisWon(cr, 'Invasion repelled');
      if (this.lastHour % 3 === 0 && cr.data.force) this._invasionFx(cr, agg, c, def);
    }
    if (cr.siteId) {
      const s = w.sites.find(x => x.id === cr.siteId);
      if (s && !s.alive && !cr.resolved) return this._crisisWon(cr, 'Threat neutralized');
    }
    if (this.time >= cr.end) this._crisisFailed(cr);
  }

  resolveCrisisWhere(pred, why) { for (const cr of [...this.crises]) if (pred(cr)) this._crisisWon(cr, why); }
  failCrisisWhere(pred, why) { for (const cr of [...this.crises]) if (pred(cr)) this._crisisFailed(cr, why); }

  _crisisWon(cr, why) {
    if (cr.resolved) return;
    cr.resolved = true;
    const def = CRISES[cr.type];
    const speedBonus = Math.round(def.reward * 0.3 * clamp((cr.end - this.time) / (cr.end - cr.start), 0, 1));
    const pts = def.reward + speedBonus;
    this.score += pts;
    this.approval += def.reward / 14;
    if (!this.sandbox) this.budget += def.reward / 12;
    this.addTension(cr.type === 'rivalfleet' ? -6 : -2);
    this.log.crisesWon++;
    this.ui.alert(`${cr.title.toUpperCase()}`, `${why} · +${pts}`, 'good');
    this.feed(`RESOLVED: ${cr.title} — ${why}. +${pts} pts.`, 'good');
    this.audio.success();
    this._endCrisis(cr);
  }

  _crisisFailed(cr, why) {
    if (cr.resolved) return;
    cr.resolved = true;
    const def = CRISES[cr.type];
    const w = this.world;
    const c = w.countries[cr.ci];
    const pen = def.penalty;
    let msg = why || 'Deadline passed';
    switch (cr.type) {
      case 'plot': {
        const city = w.allyCityNear(c.ll);
        if (city) { this.fx.explosion(city.ll, 2, 0xff4020); msg = `Attack in ${city.name}`; }
        break;
      }
      case 'missile': {
        const city = cr.data.city || w.allyCityNear(c.ll);
        if (city) this.enemyMissile(c, { city, ll: city.ll }, 2);
        msg = 'Missiles launched';
        break;
      }
      case 'cyber': { if (!this.sandbox) this.budget -= 8; msg = 'Blackouts across the East Coast'; break; }
      case 'invasion': {
        const agg = w.countries[cr.data.aggressor];
        w.setStance(c, 'hostile', true);
        c.relation = -50; c.aggression = 50;
        msg = `${c.name} has fallen to ${agg.name}`;
        this.ui.refreshLabels();
        break;
      }
      case 'rivalfleet': { msg = 'Rival power asserts control'; break; }
    }
    if (pen.approval && !this.sandbox) this.approval += pen.approval;
    if (pen.tension) this.addTension(pen.tension);
    this.score += pen.score || 0;
    this.log.crisesLost++;
    this.ui.alert(`FAILED: ${cr.title.toUpperCase()}`, msg);
    this.feed(`FAILED: ${cr.title} — ${msg}.`, 'bad');
    this.audio.fail();
    // remove the crisis' own site if still alive (it "acts" and disperses)
    if (cr.siteId) { const s = w.sites.find(x => x.id === cr.siteId); if (s && s.alive && s.type !== 'cell') { s.alive = false; if (s.obj) s.obj.visible = false; } }
    this._endCrisis(cr);
  }

  _endCrisis(cr) {
    this.crises = this.crises.filter(x => x !== cr);
    if (cr.data?.force) for (const o of cr.data.force) this.enemyLayer.remove(o);
    this.ui.renderCrises();
    this.ui.refreshSites();
    this.ui.dirtyTop = true;
  }

  _spawnInvasionForce(cr, agg, ally) {
    cr.data.force = [];
    for (let i = 0; i < 4; i++) {
      const ll = this.world.pointIn(ally, 0.6);
      const o = this.models.create('tank', 'hostile', 1);
      const p = llToVec3(ll[0], ll[1], GLOBE_R * 1.0005);
      o.position.copy(p); o.up.copy(p).normalize(); o.lookAt(llToVec3(ally.ll[0], ally.ll[1], GLOBE_R));
      o.userData.ground = true;
      this.enemyLayer.add(o);
      cr.data.force.push(o);
    }
  }

  _invasionFx(cr, agg, ally, def) {
    const a = llToVec3(agg.ll[0], agg.ll[1], GLOBE_R * 1.003), b = llToVec3(ally.ll[0], ally.ll[1], GLOBE_R * 1.003);
    this.fx.stream(a, b, 0xff4050, 2.5, 0.03);
    const o = cr.data.force[Math.floor(this.rng() * cr.data.force.length)];
    if (o) {
      const t = llToVec3(...this.world.pointIn(ally, 0.5), GLOBE_R * 1.001);
      this.fx.tracers(o.position, t, 0xff7060, 3, 0.5);
      if (def > 0) this.after(0.3, () => this.fx.explosion(o.position.clone(), 0.5, 0xffa040));
    }
  }

  _spawnRivalFleet(cr, rival, ally) {
    cr.data.force = [];
    const st = ally.station || this.nav.nearestSea(ally.ll[0], ally.ll[1]);
    if (!st) return;
    ['carrier', 'destroyer', 'destroyer'].forEach((m, i) => {
      const o = this.models.create(m, 'rival', 1);
      o.userData.ll = [st[0] + (i - 1) * 1.6, st[1] + (i % 2) * 1.2];
      o.userData.sea = true;
      o.userData.size = m === 'carrier' ? 0.045 : 0.03;
      this.enemyLayer.add(o);
      cr.data.force.push(o);
    });
  }

  // ====================================================================== enemy visuals
  _buildBaseMarkers() {
    this.baseObjs = this.bases.map(b => {
      const o = this.models.create('base', 'us', 1);
      const p = llToVec3(b.ll[0], b.ll[1], GLOBE_R * 1.0004);
      o.position.copy(p); o.up.copy(p).normalize(); o.lookAt(llToVec3(b.ll[0] + 1, b.ll[1], GLOBE_R * 1.0004));
      o.userData.baseSize = 0.011;
      this.unitLayer.add(o);
      return o;
    });
  }

  _buildSiteVisuals() { for (const s of this.world.sites) this._siteVisual(s); }

  _siteVisual(s) {
    const t = SITE_TYPES[s.type];
    if (!t.model || s.obj) return;
    const c = this.world.countries[s.ci];
    const o = this.models.create(t.model, c.stance === 'rival' ? 'rival' : 'hostile', 1);
    const p = llToVec3(s.ll[0], s.ll[1], GLOBE_R * 1.0004);
    o.position.copy(p); o.up.copy(p).normalize(); o.lookAt(llToVec3(s.ll[0], s.ll[1] + 1, GLOBE_R));
    o.userData.siteSize = t.model === 'base' ? 0.016 : 0.012;
    o.visible = false;
    this.enemyLayer.add(o);
    s.obj = o;
  }

  _onWorld(ev, d) {
    if (ev === 'site' && this.started) this._siteVisual(d);
    if (ev === 'stance' && this.started) {
      for (const s of this.world.sitesOf(d.c)) this._siteVisual(s);
      if (this.ui.dossier?.c === d.c) this.ui.renderDossier();
    }
  }

  _updateEnemyVisuals(dt) {
    const sc = this.viewScale;
    for (const s of this.world.sites) {
      if (!s.obj) continue;
      s.obj.visible = this.world.visible(s);
      if (s.obj.visible) s.obj.scale.setScalar(s.obj.userData.siteSize * sc);
    }
    for (const o of this.baseObjs) o.scale.setScalar(o.userData.baseSize * sc);
    for (const o of this.enemyLayer.children) {
      if (o.userData.sea) {
        const ll = o.userData.ll;
        ll[0] += dt * 0.15 * Math.max(0.2, this.speed) * (o.id % 2 ? 1 : -1) * 0.2;
        const p = llToVec3(ll[0], ll[1], GLOBE_R * 1.0015);
        o.position.copy(p); o.up.copy(p).normalize(); o.lookAt(llToVec3(ll[0] + (o.id % 2 ? 1 : -1), ll[1], GLOBE_R * 1.0015));
        o.scale.setScalar(o.userData.size * sc);
      } else if (o.userData.ground) o.scale.setScalar(0.016 * sc);
    }
  }

  // ====================================================================== orders (from UI)
  order(opKey, c, site, units) {
    if (this.over) return false;
    return execute(this, opKey, c, site, units);
  }

  /** Back-channel diplomacy with a hostile or rival state: buys down tension at a political price. */
  talks(c) {
    const cost = 6;
    if (this.time < (this.talksReadyAt || 0)) { this.toast(`Diplomats busy — ${Math.ceil(this.talksReadyAt - this.time)}h`, 'warn'); return false; }
    if (!this.sandbox && this.budget < cost) { this.toast('Insufficient budget', 'bad'); return false; }
    this.budget -= this.sandbox ? 0 : cost;
    this.talksReadyAt = this.time + 36;
    const rival = c.stance === 'rival';
    this.addTension(rival ? -14 : -8);
    this.approval -= this.sandbox ? 0 : 2;
    c.aggression = clamp(c.aggression - 25, 0, 100);
    c.relation += 15;
    c.struck = Math.max(0, (c.struck || 0) - 1);
    this.ui.alert('BACK-CHANNEL TALKS', `${c.name} agrees to de-escalate`, 'info');
    this.feed(`Back-channel talks with ${c.name}: tension eases. Hawks at home call it weakness (-2 approval).`, 'info');
    this.audio.success();
    if (this.tension <= 25 && this.peakTension >= 60) this.medal('peacemaker');
    return true;
  }

  /** Buy a new unit; it appears at a suitable base after its delivery time. */
  procure(type) {
    const p = PROCURE[type];
    if (!p || this.over) return false;
    if (!this.sandbox && this.budget < p.price) { this.toast('Insufficient budget', 'bad'); this.audio.fail(); return false; }
    const used = new Set(this.units.map(u => u.callsign));
    const cs = p.names.find(n => !used.has(n)) || `${UNIT_TYPES[type].short}-${this.units.length + 1}`;
    const bases = this.bases.filter(b => b.kind === p.at || (p.at === 'air' && b.kind === 'air'));
    const base = bases[Math.floor(this.rng() * bases.length)] || this.bases[0];
    this.budget -= this.sandbox ? 0 : p.price;
    const u = new Unit(this, type, base, cs);
    const hours = this.sandbox ? p.hours * 0.25 : p.hours;
    u.state = 'delivering';
    u.readyAt = this.time + hours;
    if (u.obj && u.cls === 'naval') u.obj.visible = false;
    this.units.push(u);
    this.procured.push([type, base.id, cs]);
    this.feed(`Procured ${UNIT_TYPES[type].name} ${cs} — delivery to ${base.name} in ${Math.round(hours)}h.`, 'info');
    this.audio.confirm();
    this.ui.dirtyForces = true;
    this.ui.dirtyTop = true;
    return true;
  }

  recall(u) {
    if (u.state === 'lost') return;
    if (u.cls === 'ground' && u.task?.op === 'invade') this.feed(`${u.name} withdrawing from ${this.world.countries[u.task.ci].name}.`, 'warn');
    if (u.cls === 'naval') {
      if (u.task?.op === 'blockade') { const c = this.world.countries[u.stationCi]; this.feed(`${u.name} lifts blockade of ${c?.name}.`, 'info'); }
      u.task = null; u.stationCi = -1; u.route = null; u.state = 'ready';
    } else if (u.cls === 'air' || u.cls === 'ground') {
      u.orbitCenter = null;
      if (u.state === 'onstation' || u.state === 'moving') {
        if (u.cls === 'ground' && u.state === 'onstation') { u.obj.visible = true; }
        u.returnHome();
      }
    }
    this.ui.dirtyForces = true;
  }

  /** "Declare war": throws everything sensible at a country at once. */
  declareWar(c) {
    const plan = [];
    const free = (types) => this.units.filter(u => types.includes(u.type) && u.available && !(u.cls === 'ground' && u.state === 'onstation'));
    const cy = free(['cyber']);
    if (cy.length) plan.push(['cyber_ad', null, cy.slice(0, 1)]);
    if (cy.length > 1) plan.push(['cyber_grid', null, cy.slice(1, 2)]);
    const sats = free(['satellite']);
    if (sats.length) plan.push(['recon', null, sats.slice(0, 1)]);
    const air = free(['bomber', 'fighter', 'drone']).filter(u => distanceKm(u.ll, c.ll) < 14000);
    if (air.length) plan.push(['campaign', null, air]);
    if (c.coastal) {
      const nav = free(['carrier', 'destroyer', 'submarine']).sort((a, b) => distanceKm(a.ll, c.ll) - distanceKm(b.ll, c.ll)).slice(0, 3);
      if (nav.length) plan.push(['blockade', null, nav]);
    }
    const ground = free(['airborne', 'armor']);
    if (ground.length) this.after(4, () => { if (!this.over) execute(this, 'invade', c, null, ground.filter(u => u.available)); });
    if (!plan.length && !ground.length) { this.toast('No forces available', 'bad'); return; }
    this.ui.alert(`WAR WITH ${c.name.toUpperCase()}`, 'All available forces committed');
    this.audio.alarm();
    plan.forEach(([op, site, us], i) => this.after(i * 0.6, () => execute(this, op, c, site, us)));
  }

  // ====================================================================== input & camera
  _bindInput() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; this.titleSpin = false; this.camAnim = null; });
    el.addEventListener('pointermove', e => {
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this._hoverPending = true;
    });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      if (!this.started) return;
      this.audio.init();
      const hit = this._pickUnit(e.clientX, e.clientY);
      if (hit) { this.ui.selectUnit(hit); return; }
      const i = this._pickCountry();
      if (i >= 0) {
        const c = this.world.countries[i];
        this.audio.select();
        this.ui.openDossier(c);
      } else {
        this.ui.closeDossier();
      }
    });
    el.addEventListener('dblclick', () => {
      if (!this.started) return;
      const ll = this._pickLL();
      if (ll) this.focusLL(ll, Math.max(1.45, this.camera.position.length() * 0.7));
    });
    addEventListener('keydown', e => this.ui.key(e));
  }

  /** Nearest visible friendly unit within 16px of the cursor (models are too small for mesh raycasts). */
  _pickUnit(x, y) {
    const camDir = this.camera.position.clone().normalize();
    let best = null, bd = 16;
    const v = new THREE.Vector3();
    for (const u of this.units) {
      if (!u.obj || !u.obj.visible || u.state === 'lost') continue;
      u.obj.getWorldPosition(v);
      if (v.clone().normalize().dot(camDir) < 0.1) continue;
      v.project(this.camera);
      const d = Math.hypot((v.x * 0.5 + 0.5) * innerWidth - x, (-v.y * 0.5 + 0.5) * innerHeight - y);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  _pickLL() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.globe.pick(this.raycaster);
  }

  _pickCountry() {
    const ll = this._pickLL();
    return ll ? this.globe.countryAt(ll[0], ll[1]) : -1;
  }

  _camera(dt, t) {
    if (this._hoverPending && this.started) {
      this._hoverPending = false;
      const i = this._pickCountry();
      if (i !== this.hoverIndex) {
        this.hoverIndex = i;
        this.globe.setHover(i);
        this.ui.hover(i >= 0 ? this.world.countries[i] : null);
      }
    }
    if (this.titleSpin) {
      const p = this.camera.position;
      const a = dt * 0.05;
      p.set(p.x * Math.cos(a) - p.z * Math.sin(a), p.y, p.x * Math.sin(a) + p.z * Math.cos(a));
    }
    if (this.camAnim) {
      const k = this.camAnim;
      k.t = Math.min(1, k.t + dt / k.dur);
      const e = k.t < 0.5 ? 2 * k.t * k.t : 1 - Math.pow(-2 * k.t + 2, 2) / 2;
      const dir = slerpUnit(k.fromDir, k.toDir, e, new THREE.Vector3()).normalize();
      this.camera.position.copy(dir.multiplyScalar(k.fromDist + (k.toDist - k.fromDist) * e));
      if (k.t >= 1) this.camAnim = null;
    }
    if (this.fx.shake > 0) {
      const s = this.fx.shake * 0.004;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    // adapt orbit speed to zoom so close-ups aren't twitchy
    this.controls.rotateSpeed = clamp((this.camera.position.length() - 1) * 0.25, 0.04, 0.5);
  }

  focusLL(ll, dist, dur = 0.9) {
    const toDir = llToVec3(ll[0], ll[1], 1).normalize();
    // bias the camera slightly south so the target sits above the bottom HUD
    toDir.y -= 0.12; toDir.normalize();
    this.camAnim = { t: 0, dur, fromDir: this.camera.position.clone().normalize(), toDir, fromDist: this.camera.position.length(), toDist: dist ?? this.camera.position.length() };
  }

  // ====================================================================== messaging
  feed(msg, cls = '') { this.ui.feed(msg, cls); }
  toast(msg, cls = '') { this.ui.toast(msg, cls); }

  // ====================================================================== end states
  _lose(title, text) {
    if (this.over) return;
    this.over = true;
    this.audio.fail();
    this.ui.endScreen(false, title, text);
    localStorage.removeItem('iron-meridian-save');
  }

  _victory() {
    if (this.over) return;
    this.over = true;
    this.audio.success();
    this.ui.endScreen(true, 'CAMPAIGN COMPLETE', `${CAMPAIGN_DAYS} days in command.`);
    localStorage.removeItem('iron-meridian-save');
  }

  finalScore() {
    return Math.round(this.score + this.approval * 6 - this.tension * 3 + this.log.crisesWon * 10);
  }

  rank() {
    const s = this.finalScore();
    return RANKS.find(r => s >= r[0]);
  }

  // ====================================================================== persistence
  save() {
    if (!this.started || this.over || this.sandbox) return;
    const w = this.world;
    const data = {
      v: 1, mode: this.mode, difficulty: this.difficulty, seed: this.seed,
      time: this.time, budget: this.budget, approval: this.approval, tension: this.tension, score: this.score, log: this.log,
      medals: this.medals, peakTension: this.peakTension, procured: this.procured,
      countries: w.countries.map(c => [c.stance, Math.round(c.intel), Math.round(c.base.mil * 10) / 10, Math.round(c.stability), Math.round(c.control), Math.round(c.aggression)]),
      sites: w.sites.map(s => ({ type: s.type, ci: s.ci, ll: s.ll, hp: s.hp, alive: s.alive, faction: s.faction, name: s.name })),
      units: this.units.map(u => ({ cs: u.callsign, state: u.state === 'lost' ? 'lost' : 'ready', readyAt: u.readyAt, hp: u.hp, kills: u.kills, ll: u.cls === 'naval' ? u.ll : null })),
    };
    try { localStorage.setItem('iron-meridian-save', JSON.stringify(data)); } catch (e) { /* storage full or blocked */ }
  }

  static loadSave() {
    try { return JSON.parse(localStorage.getItem('iron-meridian-save')); } catch { return null; }
  }

  _applySave(d) {
    const w = this.world;
    Object.assign(this, { time: d.time, budget: d.budget, approval: d.approval, tension: d.tension, score: d.score, log: d.log,
      medals: d.medals || [], peakTension: d.peakTension || 0 });
    this.lastHour = Math.floor(this.time);
    this.nextCrisisAt = this.time + 6;
    d.countries.forEach(([stance, intel, mil, stab, control, agg], i) => {
      const c = w.countries[i];
      c.intel = intel; c.base.mil = mil; c.stability = stab; c.control = control; c.aggression = agg;
      if (c.stance !== stance) w.setStance(c, stance);
    });
    // rebuild sites exactly as saved
    for (const s of w.sites) if (s.obj) this.enemyLayer.remove(s.obj);
    w.sites = [];
    for (const f of w.factions) f.cells = [];
    for (const s of d.sites) {
      const site = w.addSite(w.countries[s.ci], s.type, s.faction ? { faction: s.faction } : {});
      Object.assign(site, { ll: s.ll, hp: s.hp, alive: s.alive, name: s.name });
      this._siteVisual(site);
    }
    for (const c of w.countries) w.recompute(c, this.time);
    for (const [type, baseId, cs] of d.procured || []) {
      const base = this.bases.find(b => b.id === baseId) || this.bases[0];
      this.units.push(new Unit(this, type, base, cs));
      this.procured.push([type, baseId, cs]);
    }
    for (const su of d.units) {
      const u = this.units.find(x => x.callsign === su.cs);
      if (!u) continue;
      u.hp = su.hp; u.kills = su.kills;
      if (su.state === 'lost') { u.state = 'lost'; u.readyAt = su.readyAt; if (u.obj) u.obj.visible = false; }
      if (su.ll) { u.ll = su.ll; u._place(); }
    }
    this.globe.redrawAll();
    this.feed(`Command resumed. Day ${this.day}.`, 'info');
  }
}

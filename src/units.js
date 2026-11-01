// Friendly units: state machine + movement + visuals.
import * as THREE from 'three';
import { UNIT_TYPES } from './data.js';
import { GLOBE_R, arcPoint, distanceKm, llToVec3, slerpUnit, vec3ToLL, jitterLL } from './geo.js';

let UNIT_SEQ = 1;
const V = () => new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Unit {
  constructor(game, type, base, callsign) {
    this.game = game;
    this.id = UNIT_SEQ++;
    this.type = type;
    this.t = UNIT_TYPES[type];
    this.cls = this.t.cls;
    this.callsign = callsign;
    this.base = base;
    this.ll = [...base.ll];
    this.state = 'ready';
    this.hp = 100;
    this.kills = 0;
    this.sorties = 0;
    this.task = null;
    this.readyAt = 0;
    this.trailPts = null;
    this.ground = null;     // deployed ground force objects
    this.orbit = null;

    if (this.cls === 'naval') {
      // Fleets start at sea just off their home port.
      const s = game.nav.nearestSea(base.ll[0], base.ll[1]) || base.ll;
      this.ll = [...s];
      this.stationCi = -1;
    }
    this._buildVisual();
  }

  get name() { return `${this.callsign}`; }
  get busy() { return this.state !== 'ready' && !(this.cls === 'naval' && this.state === 'onstation') && !(this.cls === 'space' && this.state === 'ready'); }
  get available() {
    if (this.state === 'lost' || this.state === 'rearming') return false;
    if (this.cls === 'naval') return this.state === 'ready' || this.state === 'onstation';
    if (this.cls === 'space' || this.cls === 'cyber') return this.state === 'ready';
    if (this.cls === 'ground') return this.state === 'ready' || this.state === 'onstation';
    return this.state === 'ready';
  }

  // ------------------------------------------------------------------ visuals
  _buildVisual() {
    const g = this.game;
    if (!this.t.model) { this.obj = null; return; }
    this.obj = g.models.create(this.t.model, 'us', 1);
    this.obj.userData.unit = this;
    g.unitLayer.add(this.obj);
    if (this.cls === 'air' || this.cls === 'ground') {
      this.obj.visible = false; // parked aircraft are drawn as base icons, not models
      this.trailPts = new Float32Array(32 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.trailPts, 3));
      geo.setDrawRange(0, 0);
      this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.trail.frustumCulled = false;
      this.trailCount = 0;
      this.trailTimer = 0;
      g.unitLayer.add(this.trail);
    }
    if (this.cls === 'space') {
      const inc = (this.id * 37 % 70 + 15) * Math.PI / 180;
      this.orbit = { inc, raan: this.id * 1.7, phase: this.id * 2.1, alt: 0.32, speed: 0.35 };
      this.hover = null; // {v: Vector3, until}
    }
    this._place();
  }

  _place() {
    if (!this.obj) return;
    if (this.cls === 'naval') {
      const p = llToVec3(this.ll[0], this.ll[1], GLOBE_R * 1.0015);
      this.obj.position.copy(p);
      this.obj.up.copy(p).normalize();
      if (this.heading) this.obj.lookAt(this.heading);
    }
  }

  // ------------------------------------------------------------------ orders
  /** Fly (air/ground airlift) from current position to `ll`, then call onArrive(). */
  flyTo(ll, onArrive, opts = {}) {
    this.route = {
      kind: 'air',
      a: llToVec3(this.ll[0], this.ll[1]).normalize(),
      b: llToVec3(ll[0], ll[1]).normalize(),
      from: [...this.ll], to: [...ll],
      dist: Math.max(50, distanceKm(this.ll, ll)),
      p: 0, onArrive, loiter: opts.loiter || 0,
    };
    this.obj.visible = true;
    this.trailCount = 0;
    this.state = opts.returning ? 'returning' : 'moving';
  }

  sailTo(ll, onArrive) {
    const pts = this.game.nav.path(this.ll, ll);
    this.route = { kind: 'sea', pts, seg: 0, segP: 0, onArrive, segDist: distanceKm(pts[0], pts[1] || pts[0]) };
    this.state = 'moving';
  }

  returnHome() {
    if (this.cls === 'air' || this.cls === 'ground') {
      this.clearGround();
      this.flyTo(this.base.ll, () => this.land(), { returning: true });
    } else if (this.cls === 'naval') {
      this.state = 'ready';
      this.task = null;
      this.stationCi = -1;
    } else {
      this.state = 'ready';
    }
  }

  land() {
    this.route = null;
    this.ll = [...this.base.ll];
    this.obj.visible = false;
    if (this.trail) this.trail.geometry.setDrawRange(0, 0);
    this.state = 'rearming';
    this.readyAt = this.game.time + this.t.rearm * (this.game.sandbox ? 0.25 : 1);
    this.task = null;
  }

  /** Put tanks on the ground inside a country (visual for battalions). */
  deployGround(country) {
    this.clearGround();
    const g = this.game;
    this.ground = [];
    const n = this.type === 'armor' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const ll = g.world.pointIn(country, 0.5);
      const o = g.models.create('tank', 'us', 1);
      const p = llToVec3(ll[0], ll[1], GLOBE_R * 1.0005);
      o.position.copy(p);
      o.up.copy(p).normalize();
      o.lookAt(llToVec3(country.ll[0], country.ll[1], GLOBE_R));
      o.userData.ll = ll;
      g.unitLayer.add(o);
      this.ground.push(o);
    }
  }

  clearGround() {
    if (!this.ground) return;
    for (const o of this.ground) this.game.unitLayer.remove(o);
    this.ground = null;
  }

  destroy() {
    this.state = 'lost';
    this.route = null;
    this.clearGround();
    if (this.obj) this.obj.visible = this.cls === 'naval' ? false : false;
    if (this.trail) this.trail.geometry.setDrawRange(0, 0);
    this.readyAt = this.game.time + (this.game.sandbox ? 12 : 24 * 5);
    this.task = null;
  }

  revive() {
    this.state = 'ready';
    this.hp = 100;
    if (this.cls === 'naval') {
      const s = this.game.nav.nearestSea(this.base.ll[0], this.base.ll[1]) || this.base.ll;
      this.ll = [...s];
      this.obj.visible = true;
      this._place();
    }
  }

  // ------------------------------------------------------------------ per-frame
  /** gdt = game hours elapsed this frame; dt = real seconds. */
  update(gdt, dt, scale) {
    const g = this.game;
    if ((this.state === 'rearming' && g.time >= this.readyAt)) { this.state = 'ready'; g.ui.dirtyForces = true; }
    if (this.state === 'delivering' && g.time >= this.readyAt) {
      this.state = 'ready';
      if (this.obj && this.cls === 'naval') this.obj.visible = true;
      g.feed(`${this.t.name} ${this.callsign} delivered and ready at ${this.base.name}.`, 'good');
      g.toast(`${this.t.short} ${this.callsign} READY`, 'good');
      g.ui.dirtyForces = true;
    }
    if (this.state === 'lost' && g.time >= this.readyAt) { this.revive(); g.feed(`${this.name} reconstituted and back in service.`, 'info'); g.ui.dirtyForces = true; }

    if (this.obj) this.obj.scale.setScalar(this.t.size * scale);
    if (this.ground) for (const o of this.ground) o.scale.setScalar(0.016 * scale);

    const r = this.route;
    if (r && r.kind === 'air') {
      const step = (this.t.speed * gdt) / r.dist;
      r.p = Math.min(1, r.p + step);
      const p = r.p;
      const cruise = this.t.alt;
      const lift = Math.min(0.04, r.dist / 260000);
      const h = cruise * smooth(0, 0.06, p) * (1 - smooth(0.94, 1, p)) + lift * Math.sin(Math.PI * p);
      const pos = slerpUnit(r.a, r.b, p, V()).normalize().multiplyScalar(GLOBE_R + 0.001 + h);
      const ahead = slerpUnit(r.a, r.b, Math.min(1, p + 0.01), V()).normalize().multiplyScalar(GLOBE_R + 0.001 + h);
      this.obj.position.copy(pos);
      this.obj.up.copy(pos).normalize();
      if (p < 1) this.obj.lookAt(ahead);
      this.ll = vec3ToLL(pos);
      // contrail
      this.trailTimer += dt;
      if (this.trailTimer > 0.04) {
        this.trailTimer = 0;
        const n = Math.min(32, this.trailCount + 1);
        this.trailPts.copyWithin(3, 0, (n - 1) * 3);
        this.trailPts.set([pos.x, pos.y, pos.z], 0);
        this.trailCount = n;
        this.trail.geometry.setDrawRange(0, n);
        this.trail.geometry.attributes.position.needsUpdate = true;
      }
      if (p >= 1) {
        this.route = null;
        const cb = r.onArrive;
        if (cb) cb();
      }
    } else if (!r && this.cls === 'air' && this.state === 'onstation' && this.orbitCenter) {
      // racetrack orbit over the target
      this.orbitAng = (this.orbitAng || 0) + dt * 0.9 * Math.max(0.3, Math.min(2, g.speed));
      const c = this.orbitCenter, rad = 1.6;
      const cosLat = Math.max(0.3, Math.cos(c[1] * Math.PI / 180));
      const ll = [c[0] + Math.cos(this.orbitAng) * rad / cosLat, c[1] + Math.sin(this.orbitAng) * rad * 0.6];
      const ll2 = [c[0] + Math.cos(this.orbitAng + 0.1) * rad / cosLat, c[1] + Math.sin(this.orbitAng + 0.1) * rad * 0.6];
      const h = GLOBE_R + 0.001 + this.t.alt;
      const pos = llToVec3(ll[0], ll[1], h), ahead = llToVec3(ll2[0], ll2[1], h);
      this.obj.position.copy(pos);
      this.obj.up.copy(pos).normalize();
      this.obj.lookAt(ahead);
      this.ll = ll;
    } else if (r && r.kind === 'sea') {
      let move = this.t.speed * gdt;
      while (move > 0 && this.route === r) {
        const a = r.pts[r.seg], b = r.pts[r.seg + 1];
        if (!b) { this.route = null; this.ll = [...a]; if (r.onArrive) r.onArrive(); break; }
        const left = r.segDist * (1 - r.segP);
        if (move >= left) {
          move -= left; r.seg++; r.segP = 0;
          r.segDist = r.pts[r.seg + 1] ? Math.max(1, distanceKm(r.pts[r.seg], r.pts[r.seg + 1])) : 1;
        } else {
          r.segP += move / Math.max(1, r.segDist);
          move = 0;
        }
        const A = llToVec3(a[0], a[1]).normalize(), B = llToVec3((b || a)[0], (b || a)[1]).normalize();
        const pos = slerpUnit(A, B, r.segP, V()).normalize();
        this.ll = vec3ToLL(pos);
        this.heading = B.clone().multiplyScalar(GLOBE_R * 1.0015);
      }
      this._place();
    } else if (this.cls === 'space' && this.obj) {
      const o = this.orbit;
      o.phase += o.speed * dt * (0.4 + 0.6 * Math.min(1, g.speed));
      // orbital position: rotate a circle by inclination and RAAN
      const p = V().set(Math.cos(o.phase), 0, Math.sin(o.phase));
      p.applyAxisAngle(V().set(1, 0, 0), o.inc).applyAxisAngle(V().set(0, 1, 0), o.raan).multiplyScalar(GLOBE_R + o.alt);
      if (this.hover && g.time < this.hover.until) {
        this.hover.k = Math.min(1, (this.hover.k || 0) + dt * 0.8);
      } else if (this.hover) {
        this.hover.k = Math.max(0, (this.hover.k || 0) - dt * 0.6);
        if (this.hover.k <= 0) this.hover = null;
      }
      if (this.hover) p.lerp(this.hover.v, smooth(0, 1, this.hover.k));
      this.obj.position.copy(p);
      this.obj.up.set(0, 1, 0);
      this.obj.lookAt(0, 0, 0);
      this.obj.rotateX(Math.PI / 2);
    }
  }

  /** Task a satellite to hover over a point for `hours`. */
  hoverOver(ll, hours) {
    this.hover = { v: llToVec3(ll[0], ll[1], GLOBE_R + 0.26), until: this.game.time + hours, k: this.hover?.k || 0 };
  }

  /** Current world position (for effects). */
  worldPos(out = V()) {
    if (this.obj && this.obj.visible !== false) return out.copy(this.obj.position);
    return llToVec3(this.ll[0], this.ll[1], GLOBE_R * 1.002, out);
  }

  statusText() {
    const g = this.game;
    switch (this.state) {
      case 'ready': return this.cls === 'naval' ? 'AT SEA' : 'READY';
      case 'moving': return this.task ? (this.cls === 'naval' ? 'UNDERWAY' : 'EN ROUTE') : 'MOVING';
      case 'onstation': return this.task?.op === 'invade' ? 'FIGHTING' : 'ON STATION';
      case 'returning': return 'RTB';
      case 'rearming': return `REARM ${Math.ceil(this.readyAt - g.time)}h`;
      case 'lost': return `LOST · ${Math.ceil(this.readyAt - g.time)}h`;
      case 'delivering': return `DELIVERY ${Math.ceil(this.readyAt - g.time)}h`;
      default: return this.state.toUpperCase();
    }
  }

  /** Hours to reach a point from where the unit is now. */
  etaTo(ll) {
    if (this.cls === 'cyber' || this.cls === 'space') return this.cls === 'space' ? 1 : 0.5;
    const d = distanceKm(this.ll, ll);
    return d / this.t.speed;
  }
}

export function scatterAround(ll, n, deg) { return Array.from({ length: n }, () => jitterLL(ll, deg)); }

// Visual effects. Everything is time-based (real seconds, scaled by game speed where it matters),
// pooled where it's hot, and capped so integrated GPUs stay smooth.
import * as THREE from 'three';
import { GLOBE_R, arcPoint, llToVec3 } from './geo.js';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene, labelsEl) {
    this.scene = scene;
    this.labelsEl = labelsEl;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = [];
    this.glow = glowTexture();
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 48);
    this.tmp = new THREE.Vector3();
    this.popups = [];
    this.shake = 0;
    this._initSparks();
  }

  _initSparks() {
    // One shared Points buffer for all spark bursts (max 1200 live sparks).
    this.maxSparks = 1200;
    const g = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(this.maxSparks * 3);
    this.sparkCol = new Float32Array(this.maxSparks * 3);
    this.sparkVel = new Float32Array(this.maxSparks * 3);
    this.sparkLife = new Float32Array(this.maxSparks);
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({
      size: 3.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, map: this.glow,
    }));
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    this.sparkHead = 0;
  }

  _spawnSparks(pos, normal, n, color, speed) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.sparkHead; this.sparkHead = (this.sparkHead + 1) % this.maxSparks;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      v.addScaledVector(normal, speed * 0.6);
      this.sparkPos.set([pos.x, pos.y, pos.z], k * 3);
      this.sparkVel.set([v.x, v.y, v.z], k * 3);
      this.sparkCol.set([c.r, c.g * (0.6 + Math.random() * 0.4), c.b], k * 3);
      this.sparkLife[k] = 0.6 + Math.random() * 0.9;
    }
  }

  // ------------------------------------------------------------------ primitives
  sprite(pos, color, size, life, opts = {}) {
    const m = new THREE.SpriteMaterial({ map: this.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 });
    const s = new THREE.Sprite(m);
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.group.add(s);
    this.items.push({ obj: s, life, age: 0, kind: 'sprite', size, grow: opts.grow ?? 1.6, fade: opts.fade ?? 1 });
    return s;
  }

  ring(pos, color, size, life) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const r = new THREE.Mesh(this.ringGeo, m);
    r.position.copy(pos);
    r.lookAt(this.tmp.copy(pos).multiplyScalar(2));
    r.scale.setScalar(size * 0.1);
    this.group.add(r);
    this.items.push({ obj: r, life, age: 0, kind: 'ring', size });
  }

  /** Full explosion at a surface point. `power` ~ 1 (drone) .. 4 (orbital). */
  explosion(posOrLL, power = 1, color = 0xffa040) {
    const pos = Array.isArray(posOrLL) ? llToVec3(posOrLL[0], posOrLL[1], GLOBE_R * 1.002) : posOrLL.clone();
    const n = pos.clone().normalize();
    const s = 0.012 * power;
    this.sprite(pos, 0xffffff, s * 1.4, 0.25, { grow: 2.5 });
    this.sprite(pos, color, s * 2.2, 0.9 + power * 0.25, { grow: 1.8 });
    this.sprite(pos.clone().addScaledVector(n, s * 0.6), 0xff5520, s * 1.5, 1.6, { grow: 1.4 });
    this.ring(pos, color, s * 4, 0.9 + power * 0.2);
    if (power >= 2.5) this.ring(pos, 0xffffff, s * 7, 1.4);
    this._spawnSparks(pos, n, Math.min(140, 26 * power), color, 0.012 * power);
    this.shake = Math.max(this.shake, Math.min(1, power * 0.12));
  }

  /** A projectile flying along a great-circle arc; calls onHit when done. */
  projectile(fromV, toV, { peak = 0.08, duration = 2, color = 0xffd080, model = null, onHit, trail = true, width = 1 } = {}) {
    const a = fromV.clone().normalize(), b = toV.clone().normalize();
    const baseA = fromV.length() - GLOBE_R;
    const head = model || this.sprite(fromV, color, 0.008 * width, 1e9, { grow: 1, fade: 0 });
    if (model) this.group.add(model);
    let line = null, pts = null;
    if (trail) {
      pts = new Float32Array(40 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geo.setDrawRange(0, 0);
      line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      line.frustumCulled = false;
      this.group.add(line);
    }
    const item = { kind: 'proj', age: 0, life: duration, a, b, peak, baseA, head, line, pts, count: 0, onHit, model, prev: fromV.clone() };
    this.items.push(item);
    return item;
  }

  /** Animated dashed arc (cyber ops, data links). */
  stream(fromV, toV, color = 0x3dffc5, life = 3, peak = 0.12) {
    const a = fromV.clone().normalize(), b = toV.clone().normalize();
    const pts = [];
    for (let i = 0; i <= 48; i++) pts.push(arcPoint(a, b, i / 48, peak, 0.003));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineDashedMaterial({ color, dashSize: 0.02, gapSize: 0.015, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    this.group.add(line);
    this.items.push({ obj: line, kind: 'stream', age: 0, life });
    return line;
  }

  /** Vertical beam from orbit (satellite scan or orbital rod). */
  beam(topV, groundV, color, life, width = 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([topV, groundV]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, linewidth: width }));
    this.group.add(line);
    this.items.push({ obj: line, kind: 'beam', age: 0, life });
    return line;
  }

  scanCone(satV, groundV, color = 0x66e0ff, life = 2.5) {
    const h = satV.distanceTo(groundV);
    const geo = new THREE.ConeGeometry(h * 0.18, h, 24, 1, true);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const cone = new THREE.Mesh(geo, m);
    cone.position.copy(satV);
    cone.lookAt(groundV);
    cone.rotateX(-Math.PI / 2);
    this.group.add(cone);
    this.items.push({ obj: cone, kind: 'cone', age: 0, life });
  }

  /** Short flickering tracer bursts between two points (dogfights, ground combat). */
  tracers(aV, bV, color = 0xffe080, count = 6, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const p1 = aV.clone().lerp(bV, Math.random() * 0.4);
      const p2 = p1.clone().lerp(bV, 0.2 + Math.random() * 0.3);
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.group.add(line);
      this.items.push({ obj: line, kind: 'beam', age: -Math.random() * 0.4, life });
    }
  }

  /** Floating text anchored to a world point. */
  popup(pos, text, cls = '') {
    const el = document.createElement('div');
    el.className = 'lbl ' + cls;
    el.style.fontSize = '12px';
    el.style.fontWeight = '700';
    el.textContent = text;
    this.labelsEl.appendChild(el);
    this.popups.push({ el, pos: pos.clone(), age: 0, life: 2.4 });
  }

  // ------------------------------------------------------------------ update
  update(dt, camera, width, height) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const t = Math.max(0, it.age / it.life);
      if (it.kind === 'sprite') {
        it.obj.scale.setScalar(it.size * (1 + (it.grow - 1) * Math.min(1, t * 1.5)));
        it.obj.material.opacity = it.fade ? Math.max(0, 1 - t) : 1;
      } else if (it.kind === 'ring') {
        it.obj.scale.setScalar(it.size * (0.1 + t));
        it.obj.material.opacity = Math.max(0, 1 - t);
      } else if (it.kind === 'stream') {
        it.obj.material.opacity = Math.min(1, (1 - t) * 3);
        it.obj.material.dashOffset = -it.age * 0.08;
      } else if (it.kind === 'beam' || it.kind === 'cone') {
        it.obj.visible = it.age >= 0;
        it.obj.material.opacity = Math.max(0, 1 - t) * (it.kind === 'cone' ? 0.2 : 1);
      } else if (it.kind === 'proj') {
        const tt = Math.min(1, t);
        const p = arcPoint(it.a, it.b, tt, it.peak, it.baseA * (1 - tt));
        const head = it.model || it.head;
        head.position.copy(p);
        if (it.model) {
          const ahead = arcPoint(it.a, it.b, Math.min(1, tt + 0.01), it.peak, it.baseA * (1 - tt));
          it.model.up.copy(p).normalize();
          it.model.lookAt(ahead);
        }
        if (it.line) {
          const n = Math.min(40, it.count + 1);
          it.pts.copyWithin(3, 0, (n - 1) * 3);
          it.pts.set([p.x, p.y, p.z], 0);
          it.count = n;
          it.line.geometry.setDrawRange(0, n);
          it.line.geometry.attributes.position.needsUpdate = true;
        }
        if (tt >= 1) {
          if (it.onHit) it.onHit(p);
          this._dispose(head);
          if (it.line) { it.line.material.opacity = 0.4; this.items.push({ obj: it.line, kind: 'beam', age: 0, life: 0.8 }); }
          this.items.splice(i, 1);
          continue;
        }
        continue;
      }
      if (it.age >= it.life) { this._dispose(it.obj); this.items.splice(i, 1); }
    }
    // sparks
    const g = 0.004;
    for (let k = 0; k < this.maxSparks; k++) {
      if (this.sparkLife[k] <= 0) continue;
      this.sparkLife[k] -= dt;
      const j = k * 3;
      this.sparkPos[j] += this.sparkVel[j] * dt;
      this.sparkPos[j + 1] += this.sparkVel[j + 1] * dt;
      this.sparkPos[j + 2] += this.sparkVel[j + 2] * dt;
      // pull back toward the surface (radial gravity)
      const x = this.sparkPos[j], y = this.sparkPos[j + 1], z = this.sparkPos[j + 2];
      const len = Math.hypot(x, y, z) || 1;
      this.sparkVel[j] -= (x / len) * g; this.sparkVel[j + 1] -= (y / len) * g; this.sparkVel[j + 2] -= (z / len) * g;
      this.sparkVel[j] *= 0.97; this.sparkVel[j + 1] *= 0.97; this.sparkVel[j + 2] *= 0.97;
      if (this.sparkLife[k] <= 0) { this.sparkPos[j] = this.sparkPos[j + 1] = this.sparkPos[j + 2] = 0; }
      const f = Math.max(0, Math.min(1, this.sparkLife[k]));
      this.sparkCol[j] *= 0.985; this.sparkCol[j + 1] *= 0.97; this.sparkCol[j + 2] *= 0.95;
      if (f <= 0) this.sparkCol[j] = this.sparkCol[j + 1] = this.sparkCol[j + 2] = 0;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;

    // popups
    const camDir = this.tmp.copy(camera.position).normalize();
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      const v = p.pos.clone().project(camera);
      const facing = p.pos.clone().normalize().dot(camDir) > 0.05;
      p.el.style.left = `${(v.x * 0.5 + 0.5) * width}px`;
      p.el.style.top = `${(-v.y * 0.5 + 0.5) * height - p.age * 22}px`;
      p.el.style.opacity = facing ? String(Math.max(0, 1 - p.age / p.life)) : '0';
      if (p.age >= p.life) { p.el.remove(); this.popups.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  _dispose(obj) {
    if (!obj) return;
    this.group.remove(obj);
    if (obj.isSprite || obj.isLine || obj.isMesh) {
      if (obj.geometry && obj.geometry !== this.ringGeo) obj.geometry.dispose();
      if (obj.material && obj.material.dispose && !obj.userData.sharedMat) obj.material.dispose();
    }
  }
}

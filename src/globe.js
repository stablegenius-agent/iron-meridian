// The command globe: shader-rendered planet with per-country fills drawn into an equirectangular
// canvas, a nearest-filtered ID texture for pixel-exact picking/highlighting, night-side city lights,
// an atmosphere shell and a star field.
import * as THREE from 'three';
import { GLOBE_R, llToVec3, vec3ToLL } from './geo.js';

const COLOR_W = 4096, COLOR_H = 2048;   // visual texture
const ID_W = 2048, ID_H = 1024;         // picking texture (also used as land mask for naval pathing)

const lx = (lon, w) => ((lon + 180) / 360) * w;
const ly = (lat, h) => ((90 - lat) / 180) * h;

export class Globe {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;            // { countries:[{polys,...}], cities:[] }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.styles = world.countries.map(() => ({ fill: '#1a2838', border: 'rgba(120,200,255,0.45)' }));

    this._buildIdMap();
    this._buildColorMap();
    this._buildLights();
    this._buildMesh();
    this._buildAtmosphere();
    this._buildStars();
    this._buildBorders();
    this.outline = new THREE.Group();
    this.group.add(this.outline);
  }

  // ------------------------------------------------------------------ textures
  _path(ctx, poly, w, h) {
    for (const ring of poly) {
      ctx.moveTo(lx(ring[0][0], w), ly(ring[0][1], h));
      for (let i = 1; i < ring.length; i++) ctx.lineTo(lx(ring[i][0], w), ly(ring[i][1], h));
      ctx.closePath();
    }
  }

  _buildIdMap() {
    const c = document.createElement('canvas');
    c.width = ID_W; c.height = ID_H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ID_W, ID_H);
    this.world.countries.forEach((country, i) => {
      const id = i + 1;
      ctx.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},0)`;
      ctx.beginPath();
      for (const poly of country.polys) this._path(ctx, poly, ID_W, ID_H);
      ctx.fill('evenodd');
    });
    const img = ctx.getImageData(0, 0, ID_W, ID_H).data;
    // Canvas anti-aliasing blends colors at borders; only exact, valid IDs count.
    const n = this.world.countries.length;
    this.idArray = new Uint16Array(ID_W * ID_H);
    const rgba = new Uint8Array(ID_W * ID_H * 4);
    for (let p = 0, q = 0; p < this.idArray.length; p++, q += 4) {
      const id = img[q] + (img[q + 1] << 8);
      const valid = img[q + 2] === 0 && id > 0 && id <= n ? id : 0;
      this.idArray[p] = valid;
      rgba[q] = valid & 255; rgba[q + 1] = (valid >> 8) & 255; rgba[q + 3] = 255;
    }
    this.idTex = new THREE.DataTexture(rgba, ID_W, ID_H, THREE.RGBAFormat);
    this.idTex.magFilter = this.idTex.minFilter = THREE.NearestFilter;
    this.idTex.flipY = true;
    this.idTex.generateMipmaps = false;
    this.idTex.needsUpdate = true;
  }

  /** Country index at lon/lat, or -1 for ocean. */
  countryAt(lon, lat) {
    const x = Math.min(ID_W - 1, Math.max(0, Math.floor(lx(lon, ID_W))));
    const y = Math.min(ID_H - 1, Math.max(0, Math.floor(ly(lat, ID_H))));
    return this.idArray[y * ID_W + x] - 1;
  }

  /** Coarse land mask for pathfinding: true = land (or coast) at grid cell. */
  landGrid(cols, rows) {
    const g = new Uint8Array(cols * rows);
    const sx = ID_W / cols, sy = ID_H / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let land = 0, total = 0;
      for (let yy = 0; yy < sy; yy += 2) for (let xx = 0; xx < sx; xx += 2) {
        total++;
        if (this.idArray[Math.floor(r * sy + yy) * ID_W + Math.floor(c * sx + xx)]) land++;
      }
      g[r * cols + c] = land / total > 0.45 ? 1 : 0;
    }
    return g;
  }

  _buildColorMap() {
    this.colorCanvas = document.createElement('canvas');
    this.colorCanvas.width = COLOR_W; this.colorCanvas.height = COLOR_H;
    this.cctx = this.colorCanvas.getContext('2d');
    this.colorTex = new THREE.CanvasTexture(this.colorCanvas);
    this.colorTex.colorSpace = THREE.SRGBColorSpace;
    this.colorTex.anisotropy = 4;
    this.redrawAll();
  }

  setStyle(i, fill, border) {
    this.styles[i] = { fill, border: border || this.styles[i].border };
  }

  redrawAll() {
    const ctx = this.cctx;
    ctx.clearRect(0, 0, COLOR_W, COLOR_H);
    ctx.lineJoin = 'round';
    this.world.countries.forEach((c, i) => {
      ctx.beginPath();
      for (const poly of c.polys) this._path(ctx, poly, COLOR_W, COLOR_H);
      ctx.fillStyle = this.styles[i].fill;
      ctx.fill('evenodd');
    });
    // A soft glow under the vector borders (the crisp lines themselves are LineSegments).
    ctx.globalAlpha = 0.5;
    this.world.countries.forEach((c, i) => {
      ctx.beginPath();
      for (const poly of c.polys) this._path(ctx, poly, COLOR_W, COLOR_H);
      ctx.strokeStyle = this.styles[i].border;
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    this.colorTex.needsUpdate = true;
    this.updateBorderColors();
  }

  _buildLights() {
    const w = 2048, h = 1024;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // Glow around every city, plus faint speckle across populous countries.
    for (const city of this.world.cities) {
      const r = 2 + Math.min(10, Math.sqrt(city.pop) / 600);
      const x = lx(city.ll[0], w), y = ly(city.ll[1], h);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,210,140,0.9)');
      g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const country of this.world.countries) {
      const dots = Math.min(220, Math.floor(Math.sqrt(country.pop) / 90));
      const [cx, cy] = country.label;
      const spread = Math.min(14, 1.5 + Math.sqrt(country.area) * 0.6);
      for (let k = 0; k < dots; k++) {
        const lon = cx + (rnd() - 0.5) * spread * 2, lat = cy + (rnd() - 0.5) * spread;
        if (this.countryAt(lon, lat) < 0) continue;
        ctx.fillStyle = `rgba(255,${180 + rnd() * 50},${100 + rnd() * 60},${0.25 + rnd() * 0.4})`;
        ctx.fillRect(lx(lon, w), ly(lat, h), 1.2, 1.2);
      }
    }
    this.lightsTex = new THREE.CanvasTexture(c);
    this.lightsTex.colorSpace = THREE.SRGBColorSpace;
  }

  // ------------------------------------------------------------------ meshes
  _buildMesh() {
    this.uniforms = {
      colorTex: { value: this.colorTex },
      idTex: { value: this.idTex },
      lightsTex: { value: this.lightsTex },
      hoverId: { value: 0 },
      selectId: { value: 0 },
      sunDir: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
      time: { value: 0 },
      warTint: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main() {
          vUv = uv;
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D colorTex, idTex, lightsTex;
        uniform float hoverId, selectId, time, warTint;
        uniform vec3 sunDir;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        float gridLine(float v, float step, float w) {
          float d = abs(fract(v / step + 0.5) - 0.5) * step;
          return 1.0 - smoothstep(0.0, w, d);
        }
        void main() {
          vec3 n = normalize(vN);
          vec3 viewDir = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
          vec4 land = texture2D(colorTex, vUv);
          vec4 idc = texture2D(idTex, vUv);
          float id = floor(idc.r * 255.0 + 0.5) + floor(idc.g * 255.0 + 0.5) * 256.0;

          // ocean: deep navy with a tactical lat/lon grid and a slow sweeping scan band
          float lon = vUv.x * 360.0 - 180.0, lat = vUv.y * 180.0 - 90.0;
          vec3 ocean = mix(vec3(0.010, 0.030, 0.060), vec3(0.02, 0.07, 0.12), fres);
          float g = max(gridLine(lon, 15.0, 0.12), gridLine(lat, 15.0, 0.12));
          ocean += vec3(0.05, 0.22, 0.32) * g * 0.35;
          float sweep = smoothstep(0.0, 0.02, 0.02 - abs(fract(vUv.x - time * 0.01) - 0.5) * 0.04);
          ocean += vec3(0.0, 0.25, 0.35) * sweep * 0.15;

          vec3 col = mix(ocean, land.rgb, land.a);
          float ndl = dot(n, normalize(sunDir));
          float day = smoothstep(-0.25, 0.35, ndl);
          col *= 0.42 + 0.78 * day;
          vec3 lights = texture2D(lightsTex, vUv).rgb;
          col += lights * (1.0 - day) * 0.9 * land.a;
          // sun glint on open water and a warm band along the terminator
          vec3 sd = normalize(sunDir);
          float spec = pow(max(dot(reflect(-sd, n), viewDir), 0.0), 60.0);
          col += vec3(1.0, 0.85, 0.6) * spec * 0.55 * (1.0 - land.a) * day;
          col += vec3(1.0, 0.45, 0.15) * exp(-pow(ndl * 7.0, 2.0)) * 0.10;

          if (id > 0.5 && abs(id - hoverId) < 0.5) col += vec3(0.10, 0.16, 0.20);
          if (id > 0.5 && abs(id - selectId) < 0.5) col += vec3(0.12, 0.20, 0.26) * (0.75 + 0.25 * sin(time * 4.0));

          col = mix(col, col * vec3(1.25, 0.8, 0.75), warTint * 0.5);
          col += vec3(0.15, 0.55, 0.85) * fres * 0.28;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R, 160, 80), mat);
    this.group.add(this.mesh);
  }

  _buildAtmosphere() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { warTint: this.uniforms.warTint },
      vertexShader: `varying vec3 vN; varying vec3 vW;
        void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform float warTint; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 v = normalize(cameraPosition - vW);
          float i = pow(clamp(1.0 - abs(dot(normalize(vN), v)), 0.0, 1.0), 5.0);
          vec3 c = mix(vec3(0.25,0.65,1.0), vec3(1.0,0.35,0.25), warTint);
          gl_FragColor = vec4(c * i * 0.9, i); }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.08, 64, 32), mat);
    this.group.add(this.atmo);
  }

  _buildStars() {
    const n = 2200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 30);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      col.set([0.6 + t * 0.4, 0.7 + t * 0.3, 1.0], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8 }));
    this.scene.add(this.stars);
  }

  /** Every country outline as one LineSegments draw call: crisp at any zoom, recolored per stance. */
  _buildBorders() {
    const pos = [], owner = [];
    const v = new THREE.Vector3();
    this.world.countries.forEach((c, i) => {
      for (const poly of c.polys) for (const ring of poly) {
        for (let k = 0; k < ring.length - 1; k++) {
          llToVec3(ring[k][0], ring[k][1], GLOBE_R * 1.0007, v); pos.push(v.x, v.y, v.z);
          llToVec3(ring[k + 1][0], ring[k + 1][1], GLOBE_R * 1.0007, v); pos.push(v.x, v.y, v.z);
          owner.push(i, i);
        }
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.borderCol = new Float32Array(owner.length * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.borderCol, 3));
    this.borderOwner = owner;
    this.borders = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.group.add(this.borders);
    this.updateBorderColors();
  }

  updateBorderColors() {
    if (!this.borderCol) return;
    const col = new THREE.Color();
    const cache = this.styles.map(s => {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(s.border);
      if (!m) return [0.4, 0.7, 0.8];
      const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
      col.setRGB(m[1] / 255 * a, m[2] / 255 * a, m[3] / 255 * a, THREE.SRGBColorSpace);
      return [col.r, col.g, col.b];
    });
    const o = this.borderOwner;
    for (let k = 0; k < o.length; k++) this.borderCol.set(cache[o[k]], k * 3);
    this.borders.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------------ interaction
  setHover(i) { this.uniforms.hoverId.value = i >= 0 ? i + 1 : 0; }

  setSelected(i) {
    this.uniforms.selectId.value = i >= 0 ? i + 1 : 0;
    this.outline.clear();
    if (i < 0) return;
    const mat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.95 });
    for (const poly of this.world.countries[i].polys) {
      const ring = poly[0];
      if (ring.length < 4) continue;
      const pts = ring.map(([lon, lat]) => llToVec3(lon, lat, GLOBE_R * 1.002));
      this.outline.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }
  }

  /** Ray/sphere intersection -> [lon, lat] or null. */
  pick(raycaster) {
    const hit = new THREE.Vector3();
    const s = new THREE.Sphere(new THREE.Vector3(), GLOBE_R);
    if (!raycaster.ray.intersectSphere(s, hit)) return null;
    return vec3ToLL(hit);
  }

  update(dt, time, camera) {
    this.uniforms.time.value = time;
    // Sun follows real UTC-ish game time, set by the caller via setSunLon.
    this.stars.position.copy(camera.position).multiplyScalar(0.0);
  }

  setSunLon(lon) {
    llToVec3(lon, 8, 1, this.uniforms.sunDir.value);
  }
}

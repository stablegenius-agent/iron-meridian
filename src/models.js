// Loads the Blender-built GLBs once and hands out faction-tinted clones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_NAMES = ['fighter', 'bomber', 'drone', 'helicopter', 'transport', 'tank', 'sam', 'base',
  'carrier', 'destroyer', 'submarine', 'satellite', 'missile'];

const FACTION_HULL = {
  us: new THREE.Color(0x8fa6b8),
  hostile: new THREE.Color(0x8a3a40),
  rival: new THREE.Color(0x9a6a3a),
  faction: new THREE.Color(0x4a4a3a),
};

export class Models {
  constructor() {
    this.src = {};
    this.matCache = new Map();
  }

  async load() {
    const loader = new GLTFLoader();
    await Promise.all(MODEL_NAMES.map(async name => {
      const gltf = await loader.loadAsync(`assets/models/${name}.glb`);
      const root = gltf.scene;
      root.traverse(o => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = false;
          const m = o.material;
          if (m.name === 'Glow' || m.name === 'Glass' || m.name === 'Panel') {
            m.emissiveIntensity = m.name === 'Glow' ? 3.5 : 1.6;
          }
          m.envMapIntensity = 0;
        }
      });
      this.src[name] = root;
    }));
  }

  _mat(m, faction) {
    if (m.name !== 'Hull' || faction === 'us') return m;
    const key = m.uuid + faction;
    if (!this.matCache.has(key)) {
      const c = m.clone();
      c.color.copy(FACTION_HULL[faction] || FACTION_HULL.hostile);
      this.matCache.set(key, c);
    }
    return this.matCache.get(key);
  }

  /** Returns a new Object3D whose +Z is the model's nose; `size` = longest dimension in world units. */
  create(name, faction = 'us', size = 0.02) {
    const src = this.src[name];
    const o = src.clone(true);
    o.traverse(n => { if (n.isMesh) n.material = this._mat(n.material, faction); });
    const holder = new THREE.Group();
    holder.add(o);
    o.scale.setScalar(size);
    holder.userData.model = name;
    return holder;
  }
}

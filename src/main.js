// Bootstrap: renderer, camera, post-processing, globe, then hands control to the Game.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Globe } from './globe.js';
import { Models } from './models.js';
import { Game } from './game.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.005, 400);
camera.position.set(0.6, 1.2, 3.1);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 1.18;
controls.maxDistance = 5.5;
controls.rotateSpeed = 0.45;
controls.zoomSpeed = 0.8;

scene.add(new THREE.AmbientLight(0x8fb6d0, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 2, 3);
scene.add(sun);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- adaptive resolution: integrated GPUs at 4K can't afford native pixels.
const quality = { scale: 1, mode: 'auto', bloom: true };
function applySize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const base = quality.mode === 'high' ? 1.0 : quality.mode === 'low' ? 0.55 : 0.75;
  const pr = dpr * base * quality.scale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth * pr * 0.5, innerHeight * pr * 0.5);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', applySize);

async function boot() {
  const loading = document.getElementById('loading');
  const [world] = await Promise.all([
    fetch('data/world.json').then(r => r.json()),
  ]);
  loading.textContent = 'Rendering theater…';
  const globe = new Globe(scene, world);
  loading.textContent = 'Mustering forces…';
  const models = new Models();
  await models.load();
  applySize();

  const game = new Game({ THREE, renderer, scene, camera, controls, globe, models, world, quality, applySize, bloom, sun });
  window.__game = game; // handy for debugging from devtools
  loading.textContent = 'Ready.';

  const debugEl = location.search.includes('debug') ? Object.assign(document.body.appendChild(document.createElement('div')), {
    style: 'position:fixed;right:12px;bottom:4px;font:12px monospace;color:#6f8fa3;z-index:99;pointer-events:none' }) : null;
  // Frame loop with a light-weight FPS governor for the 'auto' quality mode.
  const clock = new THREE.Clock();
  let acc = 0, frames = 0, lastAdjust = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    controls.update();
    game.update(dt, t);
    if (quality.bloom) composer.render(); else renderer.render(scene, camera);
    acc += dt; frames++;
    if (acc > 2) {
      const fps = frames / acc;
      game.fps = fps;
      if (debugEl) debugEl.textContent = `${fps.toFixed(0)} fps · ${renderer.info.render.calls} draws · ${(renderer.getPixelRatio()).toFixed(2)}x px`;
      if (quality.mode === 'auto' && t - lastAdjust > 3) {
        if (fps < 40 && quality.scale > 0.6) { quality.scale -= 0.1; applySize(); lastAdjust = t; }
        else if (fps > 58 && quality.scale < 1) { quality.scale = Math.min(1, quality.scale + 0.05); applySize(); lastAdjust = t; }
      }
      acc = 0; frames = 0;
    }
  });
}

boot().catch(err => {
  console.error(err);
  document.getElementById('loading').textContent = 'UPLINK FAILED: ' + err.message;
});

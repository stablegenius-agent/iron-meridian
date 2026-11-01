// Geographic math on a unit globe. Convention: +Y = north pole, lon 0 on +X, lon +90 on -Z
// (matches three.js SphereGeometry UVs with an equirectangular texture whose left edge is lon -180).
import * as THREE from 'three';

export const GLOBE_R = 1;
const D2R = Math.PI / 180;

export function llToVec3(lon, lat, r = GLOBE_R, out = new THREE.Vector3()) {
  const cl = Math.cos(lat * D2R);
  return out.set(r * cl * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * cl * Math.sin(lon * D2R));
}

export function vec3ToLL(v) {
  const r = v.length();
  const lat = Math.asin(THREE.MathUtils.clamp(v.y / r, -1, 1)) / D2R;
  const lon = Math.atan2(-v.z, v.x) / D2R;
  return [lon, lat];
}

/** Great-circle distance in km between [lon,lat] pairs. */
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * D2R, dLon = (b[0] - a[0]) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Spherical interpolation between two unit vectors. */
export function slerpUnit(a, b, t, out = new THREE.Vector3()) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const om = Math.acos(dot);
  if (om < 1e-5) return out.copy(a);
  const so = Math.sin(om);
  const wa = Math.sin((1 - t) * om) / so, wb = Math.sin(t * om) / so;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
}

/** Point along a great-circle arc at a height profile (0 at ends, `peak` in the middle). */
export function arcPoint(aUnit, bUnit, t, peak, base = 0, out = new THREE.Vector3()) {
  slerpUnit(aUnit, bUnit, t, out).normalize();
  const h = base + peak * Math.sin(Math.PI * t);
  return out.multiplyScalar(GLOBE_R + h);
}

/** Random point within `radiusDeg` of [lon,lat] (used to scatter units/sites inside a country). */
export function jitterLL(ll, radiusDeg, rng = Math.random) {
  const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radiusDeg;
  return [ll[0] + Math.cos(a) * r / Math.max(0.3, Math.cos(ll[1] * D2R)), THREE.MathUtils.clamp(ll[1] + Math.sin(a) * r, -85, 85)];
}

export function formatKm(km) { return km >= 1000 ? `${(km / 1000).toFixed(1)}k km` : `${Math.round(km)} km`; }

/** Deterministic PRNG (mulberry32) so a campaign seed reproduces the same world. */
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

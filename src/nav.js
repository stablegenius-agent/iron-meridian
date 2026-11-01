// Ocean pathfinding for naval units: A* over a 1.5-degree lon/lat grid that wraps at the antimeridian.
import { distanceKm } from './geo.js';

const STEP = 1.5;
const COLS = Math.round(360 / STEP), ROWS = Math.round(180 / STEP);

class MinHeap {
  constructor() { this.a = []; }
  push(n, p) { const a = this.a; a.push([p, n]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top[1]; }
  get size() { return this.a.length; }
}

export class SeaNav {
  constructor(globe) {
    this.land = globe.landGrid(COLS, ROWS);
    // Open a few canals/straits that the coarse grid closes off.
    for (const [lon, lat] of [[32.5, 30.5], [32.5, 29.5], [33, 28], [-79.7, 9.2], [-79.5, 8.8], [103.8, 1.3], [100.5, 3], [43.4, 12.6],
      [56.3, 26.5], [-5.6, 36], [29, 41.1], [26.5, 40.2], [12, 37.5], [-60, -55], [142, 41.5], [129, 34.5]]) this._open(lon, lat);
    this.stationCache = new Map();
  }

  _open(lon, lat) { const [c, r] = this.cell(lon, lat); this.land[r * COLS + c] = 0; }
  cell(lon, lat) {
    const c = ((Math.floor((lon + 180) / STEP) % COLS) + COLS) % COLS;
    const r = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / STEP)));
    return [c, r];
  }
  center(c, r) { return [-180 + (c + 0.5) * STEP, 90 - (r + 0.5) * STEP]; }
  isSea(c, r) { return r > 2 && r < ROWS - 3 && !this.land[r * COLS + ((c + COLS) % COLS)]; }

  /** Nearest open-sea cell centre to a point (spiral search). Returns [lon,lat] or null. */
  nearestSea(lon, lat, maxRing = 30) {
    const [c0, r0] = this.cell(lon, lat);
    if (this.isSea(c0, r0)) return this.center(c0, r0);
    for (let ring = 1; ring <= maxRing; ring++) {
      let best = null, bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const c = (c0 + dc + COLS) % COLS, r = r0 + dr;
        if (r < 0 || r >= ROWS || !this.isSea(c, r)) continue;
        const p = this.center(c, r);
        const d = distanceKm([lon, lat], p);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) return best;
    }
    return null;
  }

  /** A sea station off a country's coast (or null if landlocked beyond ~1000 km). */
  stationFor(country) {
    if (this.stationCache.has(country.id)) return this.stationCache.get(country.id);
    let s = this.nearestSea(country.label[0], country.label[1], 10);
    if (s && distanceKm(s, country.label) > 1400) s = null;
    this.stationCache.set(country.id, s);
    return s;
  }

  /** Waypoints [[lon,lat],...] from a to b over water (falls back to a straight line). */
  path(a, b) {
    const sa = this.nearestSea(a[0], a[1]), sb = this.nearestSea(b[0], b[1]);
    if (!sa || !sb) return [a, b];
    const [c0, r0] = this.cell(sa[0], sa[1]), [c1, r1] = this.cell(sb[0], sb[1]);
    const start = r0 * COLS + c0, goal = r1 * COLS + c1;
    const g = new Float32Array(COLS * ROWS).fill(Infinity);
    const from = new Int32Array(COLS * ROWS).fill(-1);
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, 0);
    const goalLL = this.center(c1, r1);
    let iter = 0;
    while (heap.size && iter++ < 60000) {
      const cur = heap.pop();
      if (cur === goal) break;
      const cr = Math.floor(cur / COLS), cc = cur % COLS;
      const curLL = this.center(cc, cr);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = cr + dr, nc = (cc + dc + COLS) % COLS;
        if (!this.isSea(nc, nr)) continue;
        const n = nr * COLS + nc;
        const nLL = this.center(nc, nr);
        const cost = g[cur] + distanceKm(curLL, nLL);
        if (cost < g[n]) {
          g[n] = cost; from[n] = cur;
          heap.push(n, cost + distanceKm(nLL, goalLL));
        }
      }
    }
    if (from[goal] === -1 && start !== goal) return [a, b];
    const cells = [];
    for (let n = goal; n !== -1 && n !== start; n = from[n]) cells.push(n);
    cells.reverse();
    // Thin the cell chain: keep every 3rd waypoint for smooth sailing.
    const pts = [a];
    cells.forEach((n, i) => { if (i % 3 === 2 || i === cells.length - 1) pts.push(this.center(n % COLS, Math.floor(n / COLS))); });
    pts.push(b);
    return pts;
  }
}

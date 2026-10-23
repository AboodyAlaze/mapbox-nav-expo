import { angleDiff, bearing as geoBearing, toRad, type LngLat } from './geo';
import type { Route } from './route';

export interface MatchResult {
  /** Index of the matched segment (coordinates[index] → coordinates[index + 1]). */
  index: number;
  /** Distance along the route in meters. */
  along: number;
  snapped: LngLat;
  /** Perpendicular distance from the raw position to the route (meters). */
  distance: number;
  /** Bearing of the matched segment. */
  segmentBearing: number;
}

const M_PER_DEG = 111194.9266; // π/180 · R

/**
 * Snaps GPS fixes to a route polyline.
 * Searches a window around the last match (O(window) per fix), falls back to a full scan when far away.
 */
export class RouteMatcher {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly lng0: number;
  private readonly lat0: number;
  private readonly kx: number;
  private lastIdx = 0;
  private lastAlong = 0;

  constructor(private readonly route: Route) {
    const c = route.coordinates;
    this.lng0 = c[0]?.[0] ?? 0;
    this.lat0 = c[0]?.[1] ?? 0;
    this.kx = Math.cos(toRad(this.lat0)) * M_PER_DEG;
    this.xs = new Float64Array(c.length);
    this.ys = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) {
      this.xs[i] = (c[i][0] - this.lng0) * this.kx;
      this.ys[i] = (c[i][1] - this.lat0) * M_PER_DEG;
    }
  }

  reset() {
    this.lastIdx = 0;
    this.lastAlong = 0;
  }

  match(p: LngLat, heading?: number, speed?: number): MatchResult {
    const n = this.route.coordinates.length;
    if (n < 2) return { index: 0, along: 0, snapped: this.route.coordinates[0] ?? p, distance: 0, segmentBearing: 0 };

    const px = (p[0] - this.lng0) * this.kx;
    const py = (p[1] - this.lat0) * M_PER_DEG;
    const useHeading = heading !== undefined && heading >= 0 && (speed ?? 0) > 3;

    let best = this.scan(px, py, Math.max(0, this.lastIdx - 5), Math.min(n - 2, this.lastIdx + 400), useHeading ? heading : undefined, this.lastAlong - 40);
    if (!best || best.dist > 150) {
      const full = this.scan(px, py, 0, n - 2, useHeading ? heading : undefined, -Infinity);
      if (full && (!best || full.dist < best.dist)) best = full;
    }
    if (!best) return { index: 0, along: 0, snapped: p, distance: Infinity, segmentBearing: 0 };

    this.lastIdx = best.i;
    this.lastAlong = best.along;
    return {
      index: best.i,
      along: best.along,
      snapped: best.snapped,
      distance: best.dist,
      segmentBearing: best.bearing,
    };
  }

  private scan(
    px: number,
    py: number,
    from: number,
    to: number,
    heading: number | undefined,
    minAlong: number
  ) {
    const { coordinates: c, cum } = this.route;
    let bestScore = Infinity;
    let best: { i: number; dist: number; along: number; snapped: LngLat; bearing: number } | null = null;

    for (let i = from; i <= to; i++) {
      if (i > this.lastIdx && cum[i] - cum[this.lastIdx] > 3000 && from !== 0) break;
      const ax = this.xs[i];
      const ay = this.ys[i];
      const dx = this.xs[i + 1] - ax;
      const dy = this.ys[i + 1] - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t;
      const qy = ay + dy * t;
      const dist = Math.hypot(px - qx, py - qy);

      const segLen = cum[i + 1] - cum[i];
      const along = cum[i] + segLen * t;
      if (along < minAlong) continue;

      let score = dist;
      let segB: number | undefined;
      if (heading !== undefined) {
        segB = geoBearing(c[i], c[i + 1]);
        if (angleDiff(heading, segB) > 100) score += 40; // driving the opposite way: unlikely match
      }
      if (score < bestScore) {
        bestScore = score;
        const a = c[i];
        const b = c[i + 1];
        best = {
          i,
          dist,
          along,
          snapped: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
          bearing: segB ?? geoBearing(a, b),
        };
      }
    }
    return best;
  }
}

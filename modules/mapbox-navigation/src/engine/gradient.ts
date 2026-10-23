import type { Route } from './route';

export const ROUTE_COLORS = {
  base: '#4B97FF',
  moderate: '#FFB020',
  heavy: '#F04438',
  severe: '#B42318',
};

const colorFor = (congestion: string) =>
  congestion === 'moderate'
    ? ROUTE_COLORS.moderate
    : congestion === 'heavy'
      ? ROUTE_COLORS.heavy
      : congestion === 'severe'
        ? ROUTE_COLORS.severe
        : ROUTE_COLORS.base;

/** GeoJSON Feature<LineString> string for a native GeoJSON source. */
export function routeToGeoJSON(route: Route): string {
  return JSON.stringify({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route.coordinates },
  });
}

export function emptyGeoJSON(): string {
  return JSON.stringify({ type: 'FeatureCollection', features: [] });
}

export function alternativesToGeoJSON(routes: Route[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: routes.map((r) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: r.coordinates },
    })),
  });
}

/**
 * Mapbox-style expression for `line-gradient`: colours the route by traffic congestion.
 * Needs a GeoJSON source with `lineMetrics: true`. Returns a JSON string.
 */
export function buildGradientExpression(route: Route): string {
  const total = route.distance;
  const stops: [number, string][] = [];

  if (total <= 0 || route.congestion.length === 0) {
    return JSON.stringify(['interpolate', ['linear'], ['line-progress'], 0, ROUTE_COLORS.base, 1, ROUTE_COLORS.base]);
  }

  // merge consecutive segments with the same colour
  let runColor = colorFor(route.congestion[0]);
  let runStart = 0;
  const runs: { color: string; from: number; to: number }[] = [];
  for (let i = 1; i < route.congestion.length; i++) {
    const c = colorFor(route.congestion[i]);
    if (c !== runColor) {
      runs.push({ color: runColor, from: runStart, to: route.cum[i] });
      runColor = c;
      runStart = route.cum[i];
    }
  }
  runs.push({ color: runColor, from: runStart, to: total });

  // very small runs only add noise
  const EPS = 1e-6;
  let last = -1;
  const push = (t: number, color: string) => {
    const v = Math.min(1, Math.max(0, t));
    const safe = v <= last ? last + EPS : v;
    if (safe > 1) return;
    stops.push([safe, color]);
    last = safe;
  };
  runs.forEach((r, i) => {
    const a = r.from / total;
    const b = r.to / total;
    push(i === 0 ? 0 : a + EPS, r.color);
    if (i === runs.length - 1) push(1, r.color);
    else push(b, r.color);
  });
  if (stops.length === 1) push(1, stops[0][1]);

  const expr: unknown[] = ['interpolate', ['linear'], ['line-progress']];
  for (const [t, c] of stops) expr.push(t, c);
  return JSON.stringify(expr);
}

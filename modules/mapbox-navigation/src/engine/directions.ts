import type { LngLat } from './geo';
import { parseDirectionsRoute, type Route } from './route';

export type Profile = 'driving-traffic' | 'driving' | 'walking' | 'cycling';

export interface DirectionsOptions {
  accessToken: string;
  profile?: Profile;
  language?: string;
  units?: 'metric' | 'imperial';
  alternatives?: boolean;
  /** Heading of the vehicle at the first coordinate (helps to avoid U-turns when rerouting). */
  heading?: number;
  baseUrl?: string;
  signal?: AbortSignal;
}

/** Anything that can turn coordinates into routes (Mapbox Directions API, your own OSRM / Valhalla server…). */
export interface RouteProvider {
  getRoutes(coordinates: LngLat[], options: DirectionsOptions): Promise<Route[]>;
}

export function buildDirectionsUrl(coordinates: LngLat[], o: DirectionsOptions): string {
  const base = o.baseUrl ?? 'https://api.mapbox.com/directions/v5/mapbox';
  const coords = coordinates.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
  const q: string[] = [
    `access_token=${encodeURIComponent(o.accessToken)}`,
    'geometries=polyline6',
    'overview=full',
    'steps=true',
    'banner_instructions=true',
    'voice_instructions=true',
    'roundabout_exits=true',
    `voice_units=${o.units === 'imperial' ? 'imperial' : 'metric'}`,
    `alternatives=${o.alternatives === false ? 'false' : 'true'}`,
    'annotations=maxspeed,congestion',
  ];
  if (o.language) q.push(`language=${encodeURIComponent(o.language)}`);
  if (o.heading !== undefined && o.heading >= 0) {
    q.push(`bearings=${Math.round(o.heading)},45${';'.repeat(coordinates.length - 1)}`);
  }
  return `${base}/${o.profile ?? 'driving-traffic'}/${coords}?${q.join('&')}`;
}

export class MapboxDirectionsProvider implements RouteProvider {
  async getRoutes(coordinates: LngLat[], options: DirectionsOptions): Promise<Route[]> {
    if (!options.accessToken) throw new RouteError('NO_TOKEN', 'Mapbox access token is missing');
    if (coordinates.length < 2) throw new RouteError('BAD_REQUEST', 'At least two coordinates are required');

    let res: Response;
    try {
      res = await fetch(buildDirectionsUrl(coordinates, options), { signal: options.signal });
    } catch (e: any) {
      throw new RouteError('NETWORK', e?.message ?? 'Network request failed');
    }
    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new RouteError('BAD_RESPONSE', `Directions API answered with HTTP ${res.status}`);
    }
    if (json?.code && json.code !== 'Ok') {
      throw new RouteError(String(json.code), json.message ?? `Directions API error: ${json.code}`);
    }
    const routes = (json?.routes ?? []).map(parseDirectionsRoute) as Route[];
    if (routes.length === 0) throw new RouteError('NO_ROUTE', 'No route found');
    return routes;
  }
}

export class RouteError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

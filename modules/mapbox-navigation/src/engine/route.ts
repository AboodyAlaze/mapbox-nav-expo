import { bearing as geoBearing, decodePolyline, haversine, type LngLat } from './geo';

export interface BannerComponent {
  text: string;
  type?: string;
  modifier?: string;
}

export interface Banner {
  /** Shown while the remaining distance in the step is <= this value. */
  distanceAlongGeometry: number;
  primary: { text: string; type?: string; modifier?: string };
  secondary?: { text: string };
}

export interface VoiceInstruction {
  distanceAlongGeometry: number;
  announcement: string;
}

export interface RouteStep {
  index: number;
  legIndex: number;
  name: string;
  maneuverType: string;
  maneuverModifier?: string;
  instruction?: string;
  /** Index into Route.coordinates where the step starts / ends. */
  startIdx: number;
  endIdx: number;
  /** Distance along the route (meters) where the step starts / ends. */
  startAlong: number;
  endAlong: number;
  banners: Banner[];
  voice: VoiceInstruction[];
}

export interface RouteLeg {
  index: number;
  startIdx: number;
  endIdx: number;
  startAlong: number;
  endAlong: number;
  steps: RouteStep[];
}

export interface SpeedLimit {
  speed: number;
  unit: 'km/h' | 'mph';
}

export interface Route {
  coordinates: LngLat[];
  /** cum[i] = meters from the start of the route to coordinates[i]. */
  cum: number[];
  /** cumDur[i] = seconds from the start to coordinates[i]. */
  cumDur: number[];
  distance: number;
  duration: number;
  legs: RouteLeg[];
  steps: RouteStep[];
  /** One entry per segment (coordinates[i] → coordinates[i+1]). */
  congestion: string[];
  maxspeed: (SpeedLimit | null)[];
  /** Coordinate where each leg ends (intermediate stops + the destination). */
  waypoints: LngLat[];
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Converts one route of a Mapbox Directions API v5 response
 * (steps=true, geometries=polyline6, banner_instructions, voice_instructions, annotations) to the engine's model.
 */
export function parseDirectionsRoute(raw: any): Route {
  const coordinates: LngLat[] = [];
  const steps: RouteStep[] = [];
  const legs: RouteLeg[] = [];
  const congestion: string[] = [];
  const maxspeed: (SpeedLimit | null)[] = [];

  const rawLegs: any[] = Array.isArray(raw?.legs) ? raw.legs : [];

  rawLegs.forEach((leg, legIndex) => {
    const legStartIdx = coordinates.length > 0 ? coordinates.length - 1 : 0;
    const legSteps: RouteStep[] = [];
    const rawSteps: any[] = Array.isArray(leg?.steps) ? leg.steps : [];

    rawSteps.forEach((rs) => {
      const stepCoords: LngLat[] =
        typeof rs.geometry === 'string'
          ? decodePolyline(rs.geometry, 6)
          : Array.isArray(rs.geometry?.coordinates)
            ? (rs.geometry.coordinates as LngLat[])
            : [];

      const startIdx = coordinates.length > 0 ? coordinates.length - 1 : 0;
      if (coordinates.length === 0) {
        coordinates.push(...stepCoords);
      } else {
        // the first point of every step repeats the last point of the previous one;
        // the final "arrive" step even repeats its own point twice → never add duplicates
        for (let k = 1; k < stepCoords.length; k++) {
          const last = coordinates[coordinates.length - 1];
          if (stepCoords[k][0] !== last[0] || stepCoords[k][1] !== last[1]) coordinates.push(stepCoords[k]);
        }
      }
      const endIdx = Math.max(startIdx, coordinates.length - 1);

      const banners: Banner[] = (Array.isArray(rs.bannerInstructions) ? rs.bannerInstructions : [])
        .map((b: any) => ({
          distanceAlongGeometry: num(b.distanceAlongGeometry),
          primary: {
            text: String(b.primary?.text ?? ''),
            type: b.primary?.type,
            modifier: b.primary?.modifier,
          },
          secondary: b.secondary?.text ? { text: String(b.secondary.text) } : undefined,
        }))
        .sort((a: Banner, b: Banner) => b.distanceAlongGeometry - a.distanceAlongGeometry);

      const voice: VoiceInstruction[] = (Array.isArray(rs.voiceInstructions) ? rs.voiceInstructions : [])
        .map((v: any) => ({
          distanceAlongGeometry: num(v.distanceAlongGeometry),
          announcement: String(v.announcement ?? ''),
        }))
        .filter((v: VoiceInstruction) => v.announcement.length > 0)
        .sort((a: VoiceInstruction, b: VoiceInstruction) => b.distanceAlongGeometry - a.distanceAlongGeometry);

      const step: RouteStep = {
        index: steps.length,
        legIndex,
        name: String(rs.name ?? ''),
        maneuverType: String(rs.maneuver?.type ?? 'continue'),
        maneuverModifier: rs.maneuver?.modifier,
        instruction: rs.maneuver?.instruction,
        startIdx,
        endIdx,
        startAlong: 0,
        endAlong: 0,
        banners,
        voice,
      };
      steps.push(step);
      legSteps.push(step);
    });

    const legEndIdx = Math.max(legStartIdx, coordinates.length - 1);
    legs.push({ index: legIndex, startIdx: legStartIdx, endIdx: legEndIdx, startAlong: 0, endAlong: 0, steps: legSteps });

    // per-segment annotations of this leg
    const segCount = legEndIdx - legStartIdx;
    const ann = leg?.annotation ?? {};
    const cg: any[] | undefined = Array.isArray(ann.congestion) ? ann.congestion : undefined;
    const ms: any[] | undefined = Array.isArray(ann.maxspeed) ? ann.maxspeed : undefined;
    for (let k = 0; k < segCount; k++) {
      congestion.push(cg && cg.length === segCount ? String(cg[k] ?? 'unknown') : 'unknown');
      const m = ms && ms.length === segCount ? ms[k] : undefined;
      maxspeed.push(
        m && typeof m.speed === 'number' && !m.unknown && !m.none
          ? { speed: m.speed, unit: m.unit === 'mph' ? 'mph' : 'km/h' }
          : null
      );
    }
  });

  // cumulative distance (geometry based, consistent with the matcher)
  const cum: number[] = new Array(coordinates.length).fill(0);
  for (let i = 1; i < coordinates.length; i++) {
    cum[i] = cum[i - 1] + haversine(coordinates[i - 1], coordinates[i]);
  }
  const distance = cum.length ? cum[cum.length - 1] : 0;

  // cumulative duration: spread every step's duration over its segments (proportional to length)
  const cumDur: number[] = new Array(coordinates.length).fill(0);
  rawLegs.forEach((leg, legIndex) => {
    (leg.steps ?? []).forEach((rs: any, k: number) => {
      const step = legs[legIndex].steps[k];
      const len = cum[step.endIdx] - cum[step.startIdx];
      const dur = num(rs.duration);
      for (let i = step.startIdx + 1; i <= step.endIdx; i++) {
        const share = len > 0 ? (cum[i] - cum[i - 1]) / len : 0;
        cumDur[i] = cumDur[i - 1] + dur * share;
      }
    });
  });
  // make sure the array is non-decreasing across empty steps / junctions
  for (let i = 1; i < cumDur.length; i++) if (cumDur[i] < cumDur[i - 1]) cumDur[i] = cumDur[i - 1];
  const duration = cumDur.length && cumDur[cumDur.length - 1] > 0 ? cumDur[cumDur.length - 1] : num(raw?.duration);

  for (const step of steps) {
    step.startAlong = cum[step.startIdx] ?? 0;
    step.endAlong = cum[step.endIdx] ?? 0;
  }
  for (const leg of legs) {
    leg.startAlong = cum[leg.startIdx] ?? 0;
    leg.endAlong = cum[leg.endIdx] ?? 0;
  }

  return {
    coordinates,
    cum,
    cumDur,
    distance,
    duration,
    legs,
    steps,
    congestion,
    maxspeed,
    waypoints: legs.map((l) => coordinates[l.endIdx]),
  };
}

/** Point on the route after `along` meters + the bearing of the segment there. */
export function pointAt(route: Route, along: number): { point: LngLat; bearing: number; index: number } {
  const { coordinates: c, cum } = route;
  if (c.length === 0) return { point: [0, 0], bearing: 0, index: 0 };
  if (along <= 0) return { point: c[0], bearing: segBearing(c, 0), index: 0 };
  if (along >= route.distance) return { point: c[c.length - 1], bearing: segBearing(c, c.length - 2), index: Math.max(0, c.length - 2) };
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const segLen = cum[lo + 1] - cum[lo];
  const t = segLen > 0 ? (along - cum[lo]) / segLen : 0;
  const a = c[lo];
  const b = c[lo + 1];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], bearing: segBearing(c, lo), index: lo };
}

function segBearing(c: LngLat[], i: number): number {
  const a = c[Math.max(0, Math.min(c.length - 2, i))];
  const b = c[Math.max(1, Math.min(c.length - 1, i + 1))];
  return a && b ? geoBearing(a, b) : 0;
}

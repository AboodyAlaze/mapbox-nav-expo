import { RouteMatcher } from './matcher';
import type { LngLat } from './geo';
import type { Route, RouteStep } from './route';

export interface Fix {
  lat: number;
  lng: number;
  /** Course in degrees (0 = north). */
  heading?: number;
  /** Speed in m/s. */
  speed?: number;
  /** Horizontal accuracy in meters. */
  accuracy?: number;
  timestamp?: number;
}

export interface EngineOptions {
  /** Distance from the route (m) after which the driver counts as off-route. Default 35. */
  offRouteThreshold?: number;
  /** Consecutive off-route fixes required. Default 3. */
  offRouteFixes?: number;
  /** Remaining distance (m) that counts as arrival. Default 25. */
  arrivalThreshold?: number;
}

export interface ProgressData {
  distanceRemaining: number;
  durationRemaining: number;
  fractionTraveled: number;
  stepDistanceRemaining: number;
  instruction?: string;
  secondaryInstruction?: string;
  maneuverType?: string;
  maneuverModifier?: string;
  roadName?: string;
  speedLimit?: number;
  speedUnit: 'km/h' | 'mph';
  currentSpeed?: number;
}

export interface EngineUpdate {
  progress: ProgressData;
  /** Position snapped on the route, and the bearing of the road there. */
  snapped: LngLat;
  bearing: number;
  along: number;
  offRoute: boolean;
  /** Voice announcements to speak now (usually 0 or 1). */
  speak: string[];
  /** Arrival events produced by this update. */
  arrivals: ('waypoint' | 'final')[];
  stepIndex: number;
  legIndex: number;
}

/**
 * Turn-by-turn logic on top of a route: map matching, banner / voice selection (Mapbox semantics),
 * remaining distance and time, speed limit, off-route and arrival detection.
 * Pure TypeScript – no native code, no timers.
 */
export class NavigationEngine {
  private readonly matcher: RouteMatcher;
  private readonly spoken = new Set<string>();
  private readonly arrivedLegs = new Set<number>();
  private offRouteCount = 0;
  private finished = false;
  private lastStep = -1;

  constructor(
    public readonly route: Route,
    private readonly options: EngineOptions = {}
  ) {
    this.matcher = new RouteMatcher(route);
  }

  get isFinished() {
    return this.finished;
  }

  update(fix: Fix): EngineUpdate {
    const { route } = this;
    const opts = this.options;
    const match = this.matcher.match([fix.lng, fix.lat], fix.heading, fix.speed);

    // ---- off route
    const threshold = Math.min(120, Math.max(opts.offRouteThreshold ?? 35, (fix.accuracy ?? 0) * 1.5));
    if (match.distance > threshold) this.offRouteCount++;
    else this.offRouteCount = 0;
    const offRoute = this.offRouteCount >= (opts.offRouteFixes ?? 3);

    // ---- position on the route
    const along = Math.min(route.distance, Math.max(0, match.along));
    const step = this.stepAt(along);
    const stepRemaining = Math.max(0, step.endAlong - along);
    const distanceRemaining = Math.max(0, route.distance - along);

    const dur = this.durationAt(match.index, along);
    const durationRemaining = Math.max(0, route.duration - dur);

    // ---- banner: the last banner whose distanceAlongGeometry >= remaining distance in the step
    let banner = step.banners[0];
    for (const b of step.banners) if (b.distanceAlongGeometry >= stepRemaining - 0.5) banner = b;

    // ---- speed limit
    const limit = route.maxspeed[match.index] ?? null;
    const speedUnit = limit?.unit ?? 'km/h';
    const currentSpeed =
      fix.speed !== undefined && fix.speed >= 0
        ? Math.round(speedUnit === 'mph' ? fix.speed * 2.23694 : fix.speed * 3.6)
        : undefined;

    const progress: ProgressData = {
      distanceRemaining,
      durationRemaining,
      fractionTraveled: route.distance > 0 ? along / route.distance : 0,
      stepDistanceRemaining: stepRemaining,
      instruction: banner?.primary.text || step.instruction,
      secondaryInstruction: banner?.secondary?.text,
      maneuverType: banner?.primary.type ?? step.maneuverType,
      maneuverModifier: banner?.primary.modifier ?? step.maneuverModifier,
      roadName: step.name || undefined,
      speedLimit: limit?.speed,
      speedUnit,
      currentSpeed,
    };

    // ---- voice: only the latest eligible announcement of the step, once
    const speak: string[] = [];
    if (step.index !== this.lastStep) this.lastStep = step.index;
    let candidate: { key: string; text: string } | null = null;
    step.voice.forEach((v, i) => {
      if (v.distanceAlongGeometry >= stepRemaining - 0.5) candidate = { key: `${step.index}:${i}`, text: v.announcement };
    });
    if (candidate) {
      const c = candidate as { key: string; text: string };
      if (!this.spoken.has(c.key)) {
        // mark every earlier announcement of this step as spoken too (we may have skipped some)
        step.voice.forEach((v, i) => {
          if (v.distanceAlongGeometry >= stepRemaining - 0.5) this.spoken.add(`${step.index}:${i}`);
        });
        speak.push(c.text);
      }
    }

    // ---- arrival
    const arrivals: ('waypoint' | 'final')[] = [];
    const arrivalThreshold = opts.arrivalThreshold ?? 25;
    const leg = route.legs[step.legIndex];
    if (leg && step.legIndex < route.legs.length - 1) {
      if (!this.arrivedLegs.has(leg.index) && leg.endAlong - along <= arrivalThreshold) {
        this.arrivedLegs.add(leg.index);
        arrivals.push('waypoint');
      }
    }
    if (!this.finished && distanceRemaining <= arrivalThreshold) {
      this.finished = true;
      arrivals.push('final');
    }

    return {
      progress,
      snapped: match.snapped,
      bearing: match.segmentBearing,
      along,
      offRoute,
      speak,
      arrivals,
      stepIndex: step.index,
      legIndex: step.legIndex,
    };
  }

  private stepAt(along: number): RouteStep {
    const steps = this.route.steps;
    let lo = 0;
    let hi = steps.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (steps[mid].startAlong <= along + 0.001) lo = mid;
      else hi = mid - 1;
    }
    // skip zero-length steps (e.g. the final "arrive" step) while there is distance left
    let s = steps[lo];
    while (s.endAlong - s.startAlong <= 0.001 && lo > 0 && along < this.route.distance - 0.5) {
      lo--;
      s = steps[lo];
    }
    return s;
  }

  private durationAt(segIndex: number, along: number): number {
    const { cum, cumDur } = this.route;
    const i = Math.max(0, Math.min(cum.length - 2, segIndex));
    const segLen = cum[i + 1] - cum[i];
    const t = segLen > 0 ? Math.min(1, Math.max(0, (along - cum[i]) / segLen)) : 0;
    return cumDur[i] + (cumDur[i + 1] - cumDur[i]) * t;
  }
}

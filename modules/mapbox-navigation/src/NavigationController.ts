import { NavigationEngine, type Fix } from './engine/engine';
import type { LngLat } from './engine/geo';
import { alternativesToGeoJSON, buildGradientExpression, emptyGeoJSON, routeToGeoJSON } from './engine/gradient';
import {
  MapboxDirectionsProvider,
  RouteError,
  type Profile,
  type RouteProvider,
} from './engine/directions';
import { pointAt, type Route } from './engine/route';
import { RouteSimulator } from './engine/simulator';
import type {
  ArrivalEvent,
  CameraMode,
  CameraModeEvent,
  ErrorEvent,
  LocationEvent,
  NavigationStartedEvent,
  NavigationStoppedEvent,
  OffRouteEvent,
  ProgressEvent,
  RouteReadyEvent,
} from './MapboxNavigation.types';

/** The primitives the native map view offers (the same on iOS and Android). */
export interface NativeMap {
  updateLocation(lat: number, lng: number, bearing: number, accuracy: number, durationMs: number): void;
  followCamera(lat: number, lng: number, bearing: number, zoom: number, pitch: number, durationMs: number): void;
  fitCamera(coordinates: LngLat[], top: number, right: number, bottom: number, left: number, durationMs: number): void;
  setRoute(geojson: string, gradient: string): void;
  setAlternatives(geojson: string): void;
  setRouteProgress(fraction: number): void;
  clearRoute(): void;
}

export interface LocationSubscription {
  remove(): void;
}

export interface ControllerDeps {
  native: () => NativeMap | null;
  getToken: () => string;
  /** Subscribes to GPS fixes. `navigation` asks for the most precise / frequent updates. */
  watchLocation: (cb: (fix: Fix) => void, mode: 'browse' | 'navigation') => LocationSubscription;
  speak: (text: string, language?: string) => void;
  stopSpeaking: () => void;
  keepAwake?: (on: boolean) => void;
  provider?: RouteProvider;
  /** Simulation tick (ms). Default 1000. */
  simulatorIntervalMs?: number;
  /** Simulation base speed in m/s (default 14 ≈ 50 km/h); multiplied by `simulationSpeed`. */
  simulationBaseSpeed?: number;
  now?: () => number;
}

export interface ControllerProps {
  origin?: { latitude: number; longitude: number };
  destination?: { latitude: number; longitude: number };
  waypoints?: { latitude: number; longitude: number }[];
  profile?: Profile;
  language?: string;
  units?: 'metric' | 'imperial';
  simulate?: boolean;
  simulationSpeed?: number;
  muted?: boolean;
  alternatives?: boolean;
  pitchEnabled?: boolean;
  /** Half the length (m) of the vehicle drawn on the map. The route line starts this far ahead so it never covers the vehicle. */
  puckHalfLength?: number;
  /** Centre the map on the first GPS fix (disable when you drive the camera yourself). Default true. */
  autoCenter?: boolean;
}

export interface ControllerEvents {
  onLocation?: (e: LocationEvent) => void;
  onRouteReady?: (e: RouteReadyEvent) => void;
  onRouteError?: (e: ErrorEvent) => void;
  onNavigationStarted?: (e: NavigationStartedEvent) => void;
  onNavigationStopped?: (e: NavigationStoppedEvent) => void;
  onProgress?: (e: ProgressEvent) => void;
  onOffRoute?: (e: OffRouteEvent) => void;
  onArrival?: (e: ArrivalEvent) => void;
  onCameraModeChanged?: (e: CameraModeEvent) => void;
  onError?: (e: ErrorEvent) => void;
}

const REROUTE_COOLDOWN_MS = 4000;
const toLngLat = (c: { latitude: number; longitude: number }): LngLat => [c.longitude, c.latitude];

/**
 * Everything "navigation" lives here, in plain TypeScript: route requests, snapping, banners, voice,
 * rerouting, arrival, simulation and camera following. The native side only draws the map.
 */
export class NavigationController {
  private props: ControllerProps = {};
  private events: ControllerEvents = {};
  private watch: LocationSubscription | null = null;
  private watchMode: 'browse' | 'navigation' | null = null;
  private simulator: RouteSimulator | null = null;
  private engine: NavigationEngine | null = null;

  private lastRealFix: Fix | null = null;
  private previewRoute: Route | null = null;
  private previewKey = '';
  private navigating = false;
  private pendingStart = false;
  private requestId = 0;
  private rerouting = false;
  private lastRerouteAt = 0;
  private cameraMode: CameraMode = 'idle';
  private lastTrim = -1;
  private lastSnapped: { lat: number; lng: number; bearing: number } | null = null;
  private lastStepRemaining = Infinity;
  private lastAlong = 0;
  private legIndex = 0;
  private centered = false;
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {}

  // ------------------------------------------------------------------ configuration
  setProps(next: ControllerProps) {
    const destChanged =
      next.destination?.latitude !== this.props.destination?.latitude ||
      next.destination?.longitude !== this.props.destination?.longitude;
    const nowMuted = !!next.muted && !this.props.muted;
    this.props = next;
    if (destChanged && !this.navigating) {
      this.previewRoute = null;
      this.previewKey = '';
      this.native?.clearRoute();
    }
    if (nowMuted) this.deps.stopSpeaking();
  }

  setEvents(events: ControllerEvents) {
    this.events = events;
  }

  private get native() {
    return this.deps.native();
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    this.subscribe('browse');
  }

  dispose() {
    this.disposed = true;
    this.simulator?.stop();
    this.watch?.remove();
    this.watch = null;
    this.deps.stopSpeaking();
    this.deps.keepAwake?.(false);
  }

  private subscribe(mode: 'browse' | 'navigation') {
    if (this.watchMode === mode && this.watch) return;
    this.watch?.remove();
    this.watchMode = mode;
    this.watch = this.deps.watchLocation((fix) => this.onRealFix(fix), mode);
  }

  // ------------------------------------------------------------------ locations
  private onRealFix(fix: Fix) {
    if (this.disposed) return;
    this.lastRealFix = fix;
    if (this.navigating && this.props.simulate) return; // the simulator drives the puck
    this.handleFix(fix);
  }

  private handleFix(fix: Fix) {
    const native = this.native;
    this.events.onLocation?.({
      latitude: fix.lat,
      longitude: fix.lng,
      speed: Math.max(0, fix.speed ?? 0),
      ...(fix.heading !== undefined && fix.heading >= 0 ? { bearing: fix.heading } : {}),
    });

    if (!this.navigating || !this.engine) {
      native?.updateLocation(fix.lat, fix.lng, fix.heading ?? -1, fix.accuracy ?? 0, 1000);
      if (!this.centered && this.props.autoCenter !== false && native) {
        this.centered = true;
        native.followCamera(fix.lat, fix.lng, 0, 15, 0, 0);
      }
      return;
    }

    const u = this.engine.update(fix);

    // puck on the road, camera behind it
    native?.updateLocation(u.snapped[1], u.snapped[0], u.bearing, fix.accuracy ?? 0, 1000);
    this.lastSnapped = { lat: u.snapped[1], lng: u.snapped[0], bearing: u.bearing };
    this.lastStepRemaining = u.progress.stepDistanceRemaining;
    this.lastAlong = u.along;
    this.legIndex = u.legIndex;
    if (this.cameraMode === 'following') this.follow(fix.speed ?? 0, 1000);

    // route line: hide the part already driven AND the part under the vehicle
    const trim = this.trimFraction(u.along, this.engine.route.distance);
    if (Math.abs(trim - this.lastTrim) > 0.0004) {
      this.lastTrim = trim;
      native?.setRouteProgress(trim);
    }

    // events
    const p = u.progress;
    this.events.onProgress?.({
      distanceRemaining: p.distanceRemaining,
      durationRemaining: p.durationRemaining,
      fractionTraveled: p.fractionTraveled,
      stepDistanceRemaining: p.stepDistanceRemaining,
      ...(p.instruction ? { instruction: p.instruction } : {}),
      ...(p.secondaryInstruction ? { secondaryInstruction: p.secondaryInstruction } : {}),
      ...(p.maneuverType ? { maneuverType: p.maneuverType } : {}),
      ...(p.maneuverModifier ? { maneuverModifier: p.maneuverModifier } : {}),
      ...(p.roadName ? { roadName: p.roadName } : {}),
      ...(p.speedLimit !== undefined ? { speedLimit: p.speedLimit } : {}),
      speedUnit: p.speedUnit,
      ...(p.currentSpeed !== undefined ? { currentSpeed: p.currentSpeed } : {}),
    });

    if (!this.props.muted) for (const text of u.speak) this.deps.speak(text, this.props.language);

    for (const a of u.arrivals) this.events.onArrival?.({ final: a === 'final' });

    if (u.offRoute && !this.rerouting && !this.engine.isFinished) void this.reroute(fix);
  }

  private follow(speed: number, durationMs: number) {
    const s = this.lastSnapped;
    if (!s) return;
    let zoom = speed < 3 ? 17.3 : speed < 10 ? 17 : speed < 18 ? 16.5 : speed < 28 ? 16 : 15.4;
    if (this.lastStepRemaining < 150) zoom = Math.min(18, zoom + 0.8);
    this.native?.followCamera(s.lat, s.lng, s.bearing, zoom, this.props.pitchEnabled === false ? 0 : 45, durationMs);
  }

  // ------------------------------------------------------------------ routes
  async fetchRoute(): Promise<void> {
    await this.requestRoute(false);
  }

  private routeKey() {
    const p = this.props;
    return JSON.stringify([p.destination, p.waypoints, p.profile, p.origin]);
  }

  private async requestRoute(startAfter: boolean) {
    const dest = this.props.destination;
    if (!dest) return this.events.onRouteError?.({ code: 'NO_DESTINATION', message: 'destination prop is required' });

    const startPoint = this.props.origin
      ? toLngLat(this.props.origin)
      : this.lastRealFix
        ? ([this.lastRealFix.lng, this.lastRealFix.lat] as LngLat)
        : null;
    if (!startPoint) {
      return this.events.onRouteError?.({
        code: 'NO_ORIGIN',
        message: 'Waiting for a GPS fix – pass `origin` or try again in a moment',
      });
    }

    const id = ++this.requestId;
    this.pendingStart = startAfter;
    try {
      const routes = await this.provider().getRoutes(
        [startPoint, ...(this.props.waypoints ?? []).map(toLngLat), toLngLat(dest)],
        this.directionsOptions(this.lastRealFix?.heading)
      );
      if (id !== this.requestId || this.disposed) return;
      const main = routes[0];
      this.previewRoute = main;
      this.previewKey = this.routeKey();
      this.drawRoute(main, routes.slice(1));
      this.events.onRouteReady?.({ distance: main.distance, duration: main.duration, routeCount: routes.length });
      if (this.pendingStart) {
        this.pendingStart = false;
        this.begin(main);
      } else {
        this.fitRoute(main.coordinates);
        this.setCameraMode('overview');
      }
    } catch (e: any) {
      if (id !== this.requestId) return;
      this.pendingStart = false;
      this.events.onRouteError?.({
        code: e instanceof RouteError ? e.code : 'ROUTE_REQUEST_FAILED',
        message: e?.message ?? 'Route request failed',
      });
    }
  }

  private provider(): RouteProvider {
    return this.deps.provider ?? defaultProvider;
  }

  private directionsOptions(heading?: number) {
    return {
      accessToken: this.deps.getToken(),
      profile: this.props.profile ?? ('driving-traffic' as Profile),
      language: this.props.language,
      units: this.props.units,
      alternatives: this.props.alternatives,
      heading,
    };
  }

  private drawRoute(main: Route, alternatives: Route[]) {
    const n = this.native;
    if (!n) return;
    n.setRoute(routeToGeoJSON(main), buildGradientExpression(main));
    n.setAlternatives(alternatives.length ? alternativesToGeoJSON(alternatives) : emptyGeoJSON());
    this.lastTrim = this.trimFraction(0, main.distance);
    n.setRouteProgress(this.lastTrim);
  }

  /** Fraction of the route to hide from the start: what was driven + the length of the vehicle itself. */
  private trimFraction(along: number, total: number) {
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, (along + (this.props.puckHalfLength ?? 0)) / total));
  }

  private fitRoute(coordinates: LngLat[]) {
    this.native?.fitCamera(coordinates, 170, 40, 230, 40, 900);
  }

  // ------------------------------------------------------------------ navigation
  async startNavigation(): Promise<void> {
    if (this.navigating) return;
    if (this.previewRoute && this.previewKey === this.routeKey()) {
      this.begin(this.previewRoute);
      return;
    }
    await this.requestRoute(true);
  }

  private begin(route: Route) {
    this.engine = new NavigationEngine(route);
    this.navigating = true;
    this.lastRerouteAt = 0;
    this.rerouting = false;
    this.lastStepRemaining = Infinity;
    this.lastAlong = 0;
    this.legIndex = 0;
    this.deps.keepAwake?.(true);
    // alternatives are only useful in the preview; while driving they would stay painted over the vehicle
    this.native?.setAlternatives(emptyGeoJSON());
    this.setCameraMode('following');
    this.events.onNavigationStarted?.({ simulated: !!this.props.simulate });

    if (this.props.simulate) {
      this.simulator?.stop();
      const speed = (this.deps.simulationBaseSpeed ?? 14) * Math.max(0.5, Math.min(8, this.props.simulationSpeed ?? 1));
      this.simulator = new RouteSimulator(route, speed, this.deps.simulatorIntervalMs ?? 1000);
      this.simulator.start((fix) => this.handleFix(fix));
    } else {
      this.subscribe('navigation');
      if (this.lastRealFix) this.handleFix(this.lastRealFix);
    }
  }

  stopNavigation(): void {
    const was = this.navigating;
    this.requestId++; // cancel pending requests
    this.pendingStart = false;
    this.navigating = false;
    this.rerouting = false;
    this.simulator?.stop();
    this.simulator = null;
    this.engine = null;
    this.previewRoute = null;
    this.previewKey = '';
    this.native?.clearRoute();
    this.deps.stopSpeaking();
    this.deps.keepAwake?.(false);
    this.subscribe('browse');
    this.setCameraMode('idle');
    this.recenter();
    if (was) this.events.onNavigationStopped?.({ reason: 'stopped' });
  }

  private async reroute(fix: Fix) {
    const now = this.now();
    if (now - this.lastRerouteAt < REROUTE_COOLDOWN_MS || !this.engine) return;
    const dest = this.props.destination;
    if (!dest) return;
    this.lastRerouteAt = now;
    this.rerouting = true;
    this.events.onOffRoute?.({ offRoute: true });

    const current = this.engine.route;
    const id = ++this.requestId;
    const remainingStops = current.waypoints.slice(this.legIndex, -1);
    try {
      const routes = await this.provider().getRoutes(
        [[fix.lng, fix.lat], ...remainingStops, toLngLat(dest)],
        this.directionsOptions(fix.heading)
      );
      if (id !== this.requestId || !this.navigating) return;
      const main = routes[0];
      this.engine = new NavigationEngine(main);
      this.drawRoute(main, routes.slice(1));
      if (this.props.simulate) {
        // keep simulating on the new route
        this.simulator?.stop();
        this.simulator = new RouteSimulator(main, (this.deps.simulationBaseSpeed ?? 14) * (this.props.simulationSpeed ?? 1), this.deps.simulatorIntervalMs ?? 1000);
        this.simulator.start((f) => this.handleFix(f));
      }
      this.events.onOffRoute?.({ offRoute: false });
    } catch {
      // keep the old route; try again after the cooldown while the driver is still off route
    } finally {
      this.rerouting = false;
    }
  }

  // ------------------------------------------------------------------ camera
  recenter() {
    if (this.navigating) {
      this.setCameraMode('following');
      this.follow(this.lastRealFix?.speed ?? 0, 700);
      return;
    }
    const f = this.lastRealFix;
    if (!f) return;
    this.setCameraMode('idle');
    this.native?.followCamera(f.lat, f.lng, 0, 15, 0, 900);
  }

  showOverview() {
    const route = this.navigating ? this.engine?.route : this.previewRoute;
    if (!route) return;
    let coords = route.coordinates;
    if (this.navigating && this.lastSnapped) {
      const here = this.lastSnapped;
      const idx = pointAt(route, this.lastAlong).index;
      coords = [[here.lng, here.lat], ...route.coordinates.slice(idx + 1)];
    }
    this.fitRoute(coords);
    this.setCameraMode('overview');
  }

  /** Called by the native view when the user moves the map with a finger. */
  onNativeCameraMode(mode: CameraMode) {
    this.setCameraMode(mode, true);
  }

  private setCameraMode(mode: CameraMode, fromNative = false) {
    if (this.cameraMode === mode && !fromNative) return;
    this.cameraMode = mode;
    this.events.onCameraModeChanged?.({ mode });
  }

  get isNavigating() {
    return this.navigating;
  }
}

const defaultProvider: RouteProvider = new MapboxDirectionsProvider();

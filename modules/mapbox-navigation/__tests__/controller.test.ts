import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Fix, Route, RouteProvider } from '../src/engine';
import { parseDirectionsRoute, pointAt } from '../src/engine';
import { NavigationController, type NativeMap } from '../src/NavigationController';
import { makeDirectionsResponse } from './fixtures';

function setup(opts: { simulate?: boolean; failProvider?: boolean } = {}) {
  const calls: Record<string, any[][]> = {};
  const rec = (name: string) => (...args: any[]) => ((calls[name] ??= []).push(args), undefined);
  const native: NativeMap = {
    updateLocation: rec('updateLocation'),
    followCamera: rec('followCamera'),
    fitCamera: rec('fitCamera'),
    setRoute: rec('setRoute'),
    setAlternatives: rec('setAlternatives'),
    setRouteProgress: rec('setRouteProgress'),
    clearRoute: rec('clearRoute'),
  };
  const events: Record<string, any[]> = {};
  const ev = (name: string) => (e: any) => (events[name] ??= []).push(e);
  const spoken: string[] = [];
  let watcher: ((f: Fix) => void) | null = null;
  const modes: string[] = [];
  let providerCalls = 0;

  const provider: RouteProvider = {
    async getRoutes() {
      providerCalls++;
      if (opts.failProvider) throw new Error('offline');
      return [parseDirectionsRoute(makeDirectionsResponse().routes[0])];
    },
  };

  const c = new NavigationController({
    native: () => native,
    getToken: () => 'pk.test',
    watchLocation: (cb, mode) => {
      watcher = cb;
      modes.push(mode);
      return { remove() {} };
    },
    speak: (t) => spoken.push(t),
    stopSpeaking: () => {},
    provider,
    simulatorIntervalMs: 5,
    simulationBaseSpeed: 3000,
  });
  c.setEvents({
    onLocation: ev('onLocation'),
    onRouteReady: ev('onRouteReady'),
    onRouteError: ev('onRouteError'),
    onNavigationStarted: ev('onNavigationStarted'),
    onNavigationStopped: ev('onNavigationStopped'),
    onProgress: ev('onProgress'),
    onOffRoute: ev('onOffRoute'),
    onArrival: ev('onArrival'),
    onCameraModeChanged: ev('onCameraModeChanged'),
  });
  c.setProps({ destination: { latitude: 36.02, longitude: 44.03 }, simulate: opts.simulate, simulationSpeed: 1 });
  c.start();
  return { c, calls, events, spoken, emitFix: (f: Fix) => watcher!(f), modes, providerCalls: () => providerCalls };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gps = { lat: 36.0, lng: 44.0, heading: 90, speed: 0, accuracy: 5 };

describe('controller', () => {
  it('starts the route line in front of the vehicle (never under it)', async () => {
    const t = setup();
    t.c.setProps({ destination: { latitude: 36.02, longitude: 44.03 }, puckHalfLength: 24 });
    t.emitFix(gps);
    await t.c.startNavigation();
    const r = parseDirectionsRoute(makeDirectionsResponse().routes[0]);
    // preview already hides the vehicle length, nothing driven yet
    assert.ok(Math.abs(t.calls.setRouteProgress[0][0] - 24 / r.distance) < 1e-6);
    const pt = pointAt(r, 600).point;
    t.emitFix({ lng: pt[0], lat: pt[1], heading: 90, speed: 14, accuracy: 5 });
    const trim = t.calls.setRouteProgress.at(-1)[0];
    assert.ok(Math.abs(trim - (600 + 24) / r.distance) < 0.01, `trim ${trim}`);
  });

  it('shows a route preview without a route when GPS is not ready, then with a GPS fix', async () => {
    const t = setup();
    await t.c.fetchRoute();
    assert.equal(t.events.onRouteError?.[0].code, 'NO_ORIGIN');

    t.emitFix(gps);
    await t.c.fetchRoute();
    assert.equal(t.events.onRouteReady.length, 1);
    assert.equal(t.events.onRouteReady[0].routeCount, 1);
    assert.equal(t.calls.setRoute.length, 1);
    assert.ok(JSON.parse(t.calls.setRoute[0][1])[0] === 'interpolate');
    assert.equal(t.calls.fitCamera.length, 1);
    assert.equal(t.events.onCameraModeChanged.at(-1).mode, 'overview');
  });

  it('startNavigation fetches the route then navigates (live GPS)', async () => {
    const t = setup();
    t.emitFix(gps);
    await t.c.startNavigation();
    assert.equal(t.events.onNavigationStarted.length, 1);
    assert.equal(t.events.onNavigationStarted[0].simulated, false);
    assert.deepEqual(t.modes.slice(-1), ['navigation']);
    // alternatives are cleared when the trip starts (they must not be drawn over the vehicle)
    const lastAlt = JSON.parse(t.calls.setAlternatives.at(-1)[0]);
    assert.deepEqual(lastAlt.features, []);
    // the first fix is processed immediately: banner + voice + camera following
    const p = t.events.onProgress.at(-1);
    assert.equal(p.instruction, 'Oak Avenue');
    assert.equal(p.roadName, 'Main Street');
    assert.deepEqual(t.spoken, ['Head east on Main Street']);
    assert.ok(t.calls.followCamera.length >= 1);

    // drive 700 m along
    const r = parseDirectionsRoute(makeDirectionsResponse().routes[0]);
    const pt = pointAt(r, 700).point;
    t.emitFix({ lng: pt[0], lat: pt[1], heading: 90, speed: 14, accuracy: 5 });
    assert.ok(t.spoken.includes('In 400 meters, turn left onto Oak Avenue'), '300 m left → the 400 m announcement is due');
    const pt2 = pointAt(r, 650).point;
    t.emitFix({ lng: pt2[0], lat: pt2[1], heading: 90, speed: 14, accuracy: 5 });
    assert.ok(t.calls.setRouteProgress.at(-1)[0] > 0.2);
    assert.ok(t.calls.updateLocation.length >= 3);
  });

  it('simulates the whole trip and reports arrival', async () => {
    const t = setup({ simulate: true });
    t.emitFix(gps);
    await t.c.startNavigation();
    assert.equal(t.events.onNavigationStarted[0].simulated, true);
    for (let i = 0; i < 400 && !(t.events.onArrival ?? []).some((a) => a.final); i++) await sleep(10);
    assert.ok((t.events.onArrival ?? []).some((a) => a.final), 'final arrival');
    assert.ok(t.events.onProgress.at(-1).distanceRemaining <= 25);
    // every announcement spoken once
    assert.equal(new Set(t.spoken).size, t.spoken.length);
    t.c.stopNavigation();
    assert.equal(t.events.onNavigationStopped.length, 1);
    assert.deepEqual(t.modes.at(-1), 'browse');
    assert.ok(t.calls.clearRoute.length >= 1);
  });

  it('reroutes when the driver leaves the route', async () => {
    const t = setup();
    t.emitFix(gps);
    await t.c.startNavigation();
    const before = t.providerCalls();
    for (let i = 0; i < 4; i++) t.emitFix({ lat: 36.01, lng: 44.004, heading: 0, speed: 12, accuracy: 5 }); // ~1.1 km off
    await sleep(20);
    assert.ok(t.providerCalls() > before, 'asked for a new route');
    assert.equal(t.events.onOffRoute[0].offRoute, true);
    assert.equal(t.events.onOffRoute.at(-1).offRoute, false);
  });

  it('reports a clear error when the route request fails', async () => {
    const t = setup({ failProvider: true });
    t.emitFix(gps);
    await t.c.fetchRoute();
    assert.equal(t.events.onRouteError.at(-1).code, 'ROUTE_REQUEST_FAILED');
  });

  it('user gesture switches the camera to idle, recenter brings it back', async () => {
    const t = setup();
    t.emitFix(gps);
    await t.c.startNavigation();
    t.c.onNativeCameraMode('idle');
    assert.equal(t.events.onCameraModeChanged.at(-1).mode, 'idle');
    t.c.recenter();
    assert.equal(t.events.onCameraModeChanged.at(-1).mode, 'following');
  });
});

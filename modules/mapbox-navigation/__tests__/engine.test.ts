import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MapboxDirectionsProvider,
  NavigationEngine,
  RouteSimulator,
  buildDirectionsUrl,
  buildGradientExpression,
  decodePolyline,
  encodePolyline,
  haversine,
  parseDirectionsRoute,
  pointAt,
  type Fix,
  type Route,
} from '../src/engine';
import { makeDirectionsResponse } from './fixtures';

const route = (): Route => parseDirectionsRoute(makeDirectionsResponse().routes[0]);
const fixAt = (r: Route, along: number, extra: Partial<Fix> = {}): Fix => {
  const p = pointAt(r, along);
  return { lng: p.point[0], lat: p.point[1], heading: p.bearing, speed: 14, accuracy: 5, ...extra };
};

describe('polyline', () => {
  it('round-trips precision 6', () => {
    const pts: [number, number][] = [[44.123456, 36.654321], [44.124, 36.655], [43.99, 36.01]];
    const back = decodePolyline(encodePolyline(pts, 6), 6);
    back.forEach((p, i) => {
      assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-6 && Math.abs(p[1] - pts[i][1]) < 1e-6);
    });
  });
});

describe('route parsing', () => {
  it('builds a consistent geometry model', () => {
    const r = route();
    assert.equal(r.steps.length, 4);
    assert.ok(Math.abs(r.distance - 2400) < 15, `distance ${r.distance}`);
    assert.ok(Math.abs(r.steps[0].endAlong - 1000) < 8);
    assert.ok(Math.abs(r.steps[1].endAlong - 1800) < 10);
    assert.equal(r.legs.length, 1);
    assert.equal(r.congestion.length, r.coordinates.length - 1);
    assert.ok(Math.abs(r.duration - 177) < 1);
    // cumulative arrays are monotonic
    for (let i = 1; i < r.cum.length; i++) {
      assert.ok(r.cum[i] >= r.cum[i - 1]);
      assert.ok(r.cumDur[i] >= r.cumDur[i - 1]);
    }
  });
});

describe('engine', () => {
  it('reports progress, banners and distances like Mapbox', () => {
    const r = route();
    const e = new NavigationEngine(r);

    const a = e.update(fixAt(r, 5));
    assert.equal(a.stepIndex, 0);
    assert.equal(a.progress.instruction, 'Oak Avenue');
    assert.equal(a.progress.secondaryInstruction, 'Downtown');
    assert.equal(a.progress.maneuverType, 'turn');
    assert.equal(a.progress.maneuverModifier, 'left');
    assert.equal(a.progress.roadName, 'Main Street');
    assert.ok(Math.abs(a.progress.stepDistanceRemaining - 995) < 10);
    assert.ok(Math.abs(a.progress.distanceRemaining - 2395) < 20);

    // after the second banner threshold (<= 300 m left) the secondary text disappears
    const b = e.update(fixAt(r, 750));
    assert.equal(b.progress.secondaryInstruction, undefined);
    assert.ok(Math.abs(b.progress.stepDistanceRemaining - 250) < 10);

    const c = e.update(fixAt(r, 1100));
    assert.equal(c.stepIndex, 1);
    assert.equal(c.progress.roadName, 'Oak Avenue');
    assert.equal(c.progress.instruction, 'Pine Road');
    assert.equal(c.progress.maneuverModifier, 'right');
    assert.ok(c.progress.fractionTraveled > 0.4 && c.progress.fractionTraveled < 0.5);
  });

  it('speaks every announcement exactly once, in order, only the latest if some were skipped', () => {
    const r = route();
    const e = new NavigationEngine(r);
    const said: string[] = [];
    for (let along = 0; along < 1800; along += 14) said.push(...e.update(fixAt(r, along)).speak);
    assert.deepEqual(said.slice(0, 4), [
      'Head east on Main Street',
      'In 400 meters, turn left onto Oak Avenue',
      'Turn left onto Oak Avenue',
      'Continue on Oak Avenue for 800 meters',
    ]);
    assert.equal(new Set(said).size, said.length, 'no duplicates');

    // a big GPS gap: only the latest eligible announcement is spoken
    const e2 = new NavigationEngine(r);
    e2.update(fixAt(r, 0));
    const jump = e2.update(fixAt(r, 940)); // 60 m before the turn → skips the 400 m one
    assert.deepEqual(jump.speak, ['Turn left onto Oak Avenue']);
  });

  it('reads the speed limit from the maxspeed annotation', () => {
    const r = route();
    const e = new NavigationEngine(r);
    const slow = e.update(fixAt(r, 200, { speed: 10 }));
    assert.equal(slow.progress.speedLimit, 50);
    assert.equal(slow.progress.speedUnit, 'km/h');
    assert.equal(slow.progress.currentSpeed, 36);
    const unknown = e.update(fixAt(r, 1500));
    assert.equal(unknown.progress.speedLimit, undefined);
  });

  it('detects off-route after consecutive fixes and recovers', () => {
    const r = route();
    const e = new NavigationEngine(r);
    const p = pointAt(r, 400).point;
    const off = (): Fix => ({ lng: p[0], lat: p[1] + 0.001, heading: 90, speed: 12, accuracy: 5 }); // ~111 m north
    assert.equal(e.update(off()).offRoute, false);
    assert.equal(e.update(off()).offRoute, false);
    assert.equal(e.update(off()).offRoute, true);
    assert.equal(e.update(fixAt(r, 420)).offRoute, false);
  });

  it('tolerates GPS noise: monotonic progress, no skipped steps', () => {
    const r = route();
    const e = new NavigationEngine(r);
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
    let lastAlong = 0;
    let lastStep = 0;
    for (let along = 0; along < 2380; along += 14) {
      const base = pointAt(r, along).point;
      const jitter = 8 / 111000;
      const u = e.update({ lng: base[0] + rnd() * jitter, lat: base[1] + rnd() * jitter, speed: 14, accuracy: 8, heading: pointAt(r, along).bearing });
      assert.ok(u.along >= lastAlong - 40, `went back ${lastAlong} -> ${u.along}`);
      assert.ok(Math.abs(u.along - along) < 40, `drift at ${along}: ${u.along}`);
      assert.ok(u.stepIndex >= lastStep, 'step went backwards');
      assert.equal(u.offRoute, false);
      lastAlong = u.along;
      lastStep = u.stepIndex;
    }
  });

  it('fires the arrival once at the destination', () => {
    const r = route();
    const e = new NavigationEngine(r);
    let finals = 0;
    for (let along = 2300; along <= 2400; along += 10) {
      finals += e.update(fixAt(r, along)).arrivals.filter((a) => a === 'final').length;
    }
    assert.equal(finals, 1);
    assert.ok(e.isFinished);
  });

  it('computes the remaining duration', () => {
    const r = route();
    const e = new NavigationEngine(r);
    const half = e.update(fixAt(r, 1200));
    assert.ok(half.progress.durationRemaining < 177 && half.progress.durationRemaining > 70, String(half.progress.durationRemaining));
  });
});

describe('route line', () => {
  it('builds a valid line-gradient expression (increasing stops, traffic colours)', () => {
    const expr = JSON.parse(buildGradientExpression(route()));
    assert.deepEqual(expr.slice(0, 3), ['interpolate', ['linear'], ['line-progress']]);
    const stops = expr.slice(3);
    let last = -1;
    for (let i = 0; i < stops.length; i += 2) {
      assert.ok(stops[i] > last, `stop ${stops[i]} after ${last}`);
      assert.ok(stops[i] >= 0 && stops[i] <= 1);
      last = stops[i];
    }
    const colors = new Set(stops.filter((_: unknown, i: number) => i % 2 === 1));
    assert.ok(colors.has('#F04438') && colors.has('#FFB020') && colors.has('#4B97FF'));
  });
});

describe('directions provider', () => {
  it('builds the Mapbox URL with every needed parameter', () => {
    const url = buildDirectionsUrl([[44, 36], [44.1, 36.1]], { accessToken: 'pk.x', language: 'ar', units: 'metric', heading: 90 });
    for (const part of ['driving-traffic', 'banner_instructions=true', 'voice_instructions=true', 'geometries=polyline6', 'language=ar', 'annotations=maxspeed,congestion', 'bearings=90,45;']) {
      assert.ok(url.includes(part), `missing ${part} in ${url}`);
    }
  });

  it('parses a response and surfaces API errors', async () => {
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => ({ status: 200, json: async () => makeDirectionsResponse() })) as any;
      const routes = await new MapboxDirectionsProvider().getRoutes([[44, 36], [44.03, 36.01]], { accessToken: 'pk.x' });
      assert.equal(routes.length, 1);
      assert.equal(routes[0].steps.length, 4);

      globalThis.fetch = (async () => ({ status: 422, json: async () => ({ code: 'NoRoute', message: 'No route found' }) })) as any;
      await assert.rejects(() => new MapboxDirectionsProvider().getRoutes([[44, 36], [44.03, 36.01]], { accessToken: 'pk.x' }), /No route/);
      await assert.rejects(() => new MapboxDirectionsProvider().getRoutes([[44, 36], [44.03, 36.01]], { accessToken: '' }), /token/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('simulator', () => {
  it('drives the whole route and finishes', async () => {
    const r = route();
    const fixes: Fix[] = [];
    await new Promise<void>((resolve) => {
      new RouteSimulator(r, 40000, 5).start((f) => fixes.push(f), resolve);
    });
    const last = fixes[fixes.length - 1];
    const end = r.coordinates[r.coordinates.length - 1];
    assert.ok(haversine([last.lng, last.lat], end) < 1);
    assert.ok(fixes.length >= 2);
  });
});

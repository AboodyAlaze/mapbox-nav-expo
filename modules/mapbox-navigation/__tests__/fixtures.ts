import { destination, encodePolyline, type LngLat } from '../src/engine/geo';

/**
 * A synthetic Directions API v5 response (same JSON shape Mapbox returns with
 * steps, polyline6, banner_instructions, voice_instructions and annotations).
 *
 *   start ──1000 m east──▶ (turn left) ──800 m north──▶ (turn right) ──600 m east──▶ arrive
 */
export const START: LngLat = [44.0, 36.0];

function line(from: LngLat, bearingDeg: number, meters: number, pointsEvery = 50): LngLat[] {
  const pts: LngLat[] = [from];
  for (let d = pointsEvery; d < meters; d += pointsEvery) pts.push(destination(from, bearingDeg, d));
  pts.push(destination(from, bearingDeg, meters));
  return pts;
}

export function makeDirectionsResponse(opts: { withMaxspeed?: boolean } = {}) {
  const seg1 = line(START, 90, 1000);
  const seg2 = line(seg1[seg1.length - 1], 0, 800);
  const seg3 = line(seg2[seg2.length - 1], 90, 600);
  const all = [...seg1, ...seg2.slice(1), ...seg3.slice(1)];
  const n = all.length - 1; // segments

  const step = (
    name: string,
    coords: LngLat[],
    distance: number,
    duration: number,
    type: string,
    modifier: string | undefined,
    banners: any[],
    voice: any[]
  ) => ({
    name,
    distance,
    duration,
    geometry: encodePolyline(coords, 6),
    maneuver: { type, modifier, instruction: `${type} ${modifier ?? ''}`.trim(), location: coords[0] },
    bannerInstructions: banners,
    voiceInstructions: voice,
  });

  const steps = [
    step(
      'Main Street',
      seg1,
      1000,
      72,
      'depart',
      undefined,
      [
        { distanceAlongGeometry: 1000, primary: { text: 'Oak Avenue', type: 'turn', modifier: 'left' }, secondary: { text: 'Downtown' } },
        { distanceAlongGeometry: 300, primary: { text: 'Oak Avenue', type: 'turn', modifier: 'left' } },
      ],
      [
        { distanceAlongGeometry: 1000, announcement: 'Head east on Main Street' },
        { distanceAlongGeometry: 400, announcement: 'In 400 meters, turn left onto Oak Avenue' },
        { distanceAlongGeometry: 80, announcement: 'Turn left onto Oak Avenue' },
      ]
    ),
    step(
      'Oak Avenue',
      seg2,
      800,
      60,
      'turn',
      'left',
      [
        { distanceAlongGeometry: 800, primary: { text: 'Pine Road', type: 'turn', modifier: 'right' } },
        { distanceAlongGeometry: 250, primary: { text: 'Pine Road', type: 'turn', modifier: 'right' } },
      ],
      [
        { distanceAlongGeometry: 800, announcement: 'Continue on Oak Avenue for 800 meters' },
        { distanceAlongGeometry: 100, announcement: 'Turn right onto Pine Road' },
      ]
    ),
    step(
      'Pine Road',
      seg3,
      600,
      45,
      'turn',
      'right',
      [
        { distanceAlongGeometry: 600, primary: { text: 'Your destination', type: 'arrive' } },
        { distanceAlongGeometry: 120, primary: { text: 'Your destination', type: 'arrive' } },
      ],
      [{ distanceAlongGeometry: 120, announcement: 'You will arrive at your destination' }]
    ),
    step('Pine Road', [seg3[seg3.length - 1], seg3[seg3.length - 1]], 0, 0, 'arrive', undefined, [], [
      { distanceAlongGeometry: 30, announcement: 'You have arrived' },
    ]),
  ];

  const annotation = {
    congestion: Array.from({ length: n }, (_, i) => (i > 22 && i < 30 ? 'heavy' : i >= 30 && i < 34 ? 'moderate' : 'low')),
    maxspeed: Array.from({ length: n }, (_, i) =>
      opts.withMaxspeed === false ? { unknown: true } : i < 20 ? { speed: 50, unit: 'km/h' } : { unknown: true }
    ),
  };

  return {
    code: 'Ok',
    routes: [{ distance: 2400, duration: 177, legs: [{ steps, annotation }] }],
  };
}

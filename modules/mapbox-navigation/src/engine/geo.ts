export type LngLat = [number, number];

const EARTH_RADIUS = 6371008.8;
export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in meters. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a → b in degrees [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/** Point reached after travelling `distance` meters from `a` on `bearingDeg`. */
export function destination(a: LngLat, bearingDeg: number, distance: number): LngLat {
  const δ = distance / EARTH_RADIUS;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(a[1]);
  const λ1 = toRad(a[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((toDeg(λ2) + 540) % 360) - 180, toDeg(φ2)];
}

/** Decodes a Google/Mapbox encoded polyline (precision 5 or 6) into [lng, lat] pairs. */
export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = Math.pow(10, precision);
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lng / factor, lat / factor]);
  }
  return out;
}

/** Inverse of decodePolyline (used by tests / tools). */
export function encodePolyline(coords: LngLat[], precision = 6): string {
  const factor = Math.pow(10, precision);
  let lastLat = 0;
  let lastLng = 0;
  let out = '';
  const enc = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * factor);
    const ln = Math.round(lng * factor);
    out += enc(la - lastLat) + enc(ln - lastLng);
    lastLat = la;
    lastLng = ln;
  }
  return out;
}

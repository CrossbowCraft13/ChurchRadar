export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function boundsArea(bounds: Bounds): number {
  const height = Math.max(0, bounds.north - bounds.south);
  let width = bounds.east - bounds.west;
  if (width < 0) width += 360;
  return height * Math.max(0, width);
}

/** Stable cache key; ~100 m precision is plenty for a viewport. */
export function boundsKey(bounds: Bounds): string {
  const round = (value: number) => value.toFixed(2);
  return [bounds.south, bounds.west, bounds.north, bounds.east].map(round).join(",");
}

const EARTH_RADIUS_KM = 6371;

export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return "";
  if (km < 0.1) return "< 100 m";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

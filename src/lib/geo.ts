/** Pure geo helpers — safe to import from both server and browser code. */

/** Projected "grid" coords kept for legacy consumers (debug SVG). ~28 m per unit. */
export function toGrid(lon: number, lat: number): { x: number; y: number } {
  return { x: Math.round((lon - 120.9) * 4000 * 0.968), y: Math.round((14.79 - lat) * 4000) };
}

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Metro Manila extent (from public/geo/ncr-cities.geojson), [west, south, east, north]. */
export const NCR_BOUNDS: [number, number, number, number] = [120.9066, 14.3517, 121.135, 14.7853];

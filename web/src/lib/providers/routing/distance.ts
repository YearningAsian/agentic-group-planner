import type { RouteMode } from "@agp/shared";
import type { LatLng } from "./types";

/** The IUGG mean Earth radius. */
const EARTH_RADIUS_M = 6_371_008.8;

/** Design §2.3: a leg is walked when the straight-line distance is under 1.5 km, otherwise driven. */
export const WALKING_LIMIT_M = 1_500;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance in meters. */
export function straightLineMeters(a: LatLng, b: LatLng): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The mode a leg between two places is routed with. */
export function routeModeFor(a: LatLng, b: LatLng): RouteMode {
  return straightLineMeters(a, b) < WALKING_LIMIT_M ? "walking" : "driving";
}

/** A travel time in whole minutes, rounded up, so an arrival check never runs optimistic. */
export function minutesFor(durationS: number): number {
  return Math.ceil(durationS / 60);
}

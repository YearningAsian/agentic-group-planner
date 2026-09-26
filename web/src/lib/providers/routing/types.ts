import type { RouteMode } from "@agp/shared";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  /** GeoJSON order: [lng, lat]. */
  geometry: { type: "LineString"; coordinates: [number, number][] };
  /** Whole seconds and meters, as the `routes` cache stores them. */
  durationS: number;
  distanceM: number;
}

export interface RoutingProvider {
  /** What `routes.provider` records for a leg this provider fetched. */
  readonly name: "ors" | "mock";
  route(input: { from: LatLng; to: LatLng; mode: RouteMode }): Promise<RouteResult>;
  /** Travel time between every pair of points, in whole minutes rounded up. */
  matrix(input: { points: LatLng[]; mode: RouteMode }): Promise<number[][]>;
}

import type { RouteMode } from "@agp/shared";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteResult {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  durationS: number;
  distanceM: number;
}

export interface RoutingProvider {
  route(input: { from: LatLng; to: LatLng; mode: RouteMode }): Promise<RouteResult>;
  matrix(input: { points: LatLng[]; mode: RouteMode }): Promise<number[][]>;
}

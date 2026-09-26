import "server-only";
import type { RouteMode } from "@agp/shared";
import { minutesFor, straightLineMeters } from "./distance";
import type { LatLng, RouteResult, RoutingProvider } from "./types";

/** Design §2.3: the mock's speeds. */
const SPEED_KMH: Record<RouteMode, number> = { walking: 4.8, driving: 25 };

function straightLeg(from: LatLng, to: LatLng, mode: RouteMode): RouteResult {
  const distanceM = Math.round(straightLineMeters(from, to));
  return {
    geometry: {
      type: "LineString",
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
    distanceM,
    // meters ÷ (km/h ÷ 3.6) = seconds
    durationS: Math.round((distanceM * 3.6) / SPEED_KMH[mode]),
  };
}

/**
 * Straight-line routing: deterministic and offline, for development and tests. Walking runs at
 * 4.8 km/h and driving at 25 km/h (a city average with stops), so its times are rough but plausible.
 */
export function createMockRoutingProvider(): RoutingProvider {
  return {
    name: "mock",
    async route({ from, to, mode }) {
      return straightLeg(from, to, mode);
    },
    async matrix({ points, mode }) {
      return points.map((a) => points.map((b) => minutesFor(straightLeg(a, b, mode).durationS)));
    },
  };
}

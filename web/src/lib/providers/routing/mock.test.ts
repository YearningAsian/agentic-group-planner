import { describe, expect, it } from "vitest";
import { routeModeFor, straightLineMeters } from "./distance";
import { selectRoutingProvider } from "./index";
import { createMockRoutingProvider } from "./mock";

// Two points 0.009° apart on one meridian: 1000.76 m on a sphere of radius 6,371,008.8 m.
const from = { lat: 33.7634, lng: -84.3951 };
const north = { lat: 33.7724, lng: -84.3951 };

describe("mock routing provider", () => {
  it("mock walking uses 4.8 km/h and driving 25 km/h, with a straight line", async () => {
    const routing = createMockRoutingProvider();

    const walking = await routing.route({ from, to: north, mode: "walking" });
    const driving = await routing.route({ from, to: north, mode: "driving" });

    expect(walking.distanceM).toBe(1001);
    expect(driving.distanceM).toBe(1001);
    // 1001 m at 4.8 km/h (1.333 m/s) and at 25 km/h (6.944 m/s).
    expect(walking.durationS).toBe(751);
    expect(driving.durationS).toBe(144);
    const line = { type: "LineString", coordinates: [[-84.3951, 33.7634], [-84.3951, 33.7724]] };
    expect(walking.geometry).toEqual(line);
    expect(driving.geometry).toEqual(line);

    // The matrix gives the same legs in whole minutes, rounded up.
    expect(await routing.matrix({ points: [from, north], mode: "walking" })).toEqual([
      [0, 13],
      [13, 0],
    ]);
  });

  it("walks under 1.5 km and drives from 1.5 km", () => {
    expect(straightLineMeters(from, north)).toBeCloseTo(1000.76, 2);
    expect(routeModeFor(from, north)).toBe("walking");
    expect(routeModeFor(from, { lat: 33.7769, lng: -84.3951 })).toBe("driving");
  });

  it("ROUTING_PROVIDER picks the implementation", () => {
    expect(selectRoutingProvider({ ROUTING_PROVIDER: "mock", ORS_API_KEY: undefined }).name).toBe("mock");
    expect(selectRoutingProvider({ ROUTING_PROVIDER: "real", ORS_API_KEY: "test-key" }).name).toBe("ors");
  });
});

import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/reliability";
import directions from "./fixtures/ors-directions.json";
import { createOrsRoutingProvider } from "./real";

/**
 * The fixture follows OpenRouteService's v2 `/directions/{profile}/geojson` response: a
 * FeatureCollection whose one feature carries the LineString and a summary in meters and seconds.
 */

interface Seen {
  url: string;
  authorization: string | null;
  body: unknown;
}

/** A fetch that answers each call with the next canned response and keeps every request it saw. */
function scriptedFetch(responses: { status: number; body: unknown }[]) {
  const seen: Seen[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    const next = responses[seen.length - 1] ?? responses.at(-1)!;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

const aquarium = { lat: 33.7634, lng: -84.3951 };
const varsity = { lat: 33.7717, lng: -84.3894 };

describe("OpenRouteService routing provider", () => {
  it("real maps an ORS directions response to a GeoJSON LineString, a duration, and a distance", async () => {
    const { fetch, seen } = scriptedFetch([{ status: 200, body: directions }]);
    const routing = createOrsRoutingProvider({ apiKey: "ors-test-key", fetch });

    const leg = await routing.route({ from: aquarium, to: varsity, mode: "walking" });

    expect(seen).toEqual([
      {
        url: "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
        authorization: "ors-test-key",
        body: { coordinates: [[-84.3951, 33.7634], [-84.3894, 33.7717]] },
      },
    ]);
    expect(leg.geometry).toEqual({ type: "LineString", coordinates: directions.features[0]!.geometry.coordinates });
    expect(leg.durationS).toBe(967);
    expect(leg.distanceM).toBe(1343);
  });

  it("drives with driving-car, and a 5xx is retried once before provider_unavailable", async () => {
    const { fetch, seen } = scriptedFetch([{ status: 503, body: { error: "busy" } }]);
    const routing = createOrsRoutingProvider({ apiKey: "ors-test-key", fetch, backoffMs: 1 });

    const failure = routing.route({ from: aquarium, to: varsity, mode: "driving" });

    await expect(failure).rejects.toBeInstanceOf(AppError);
    await expect(failure).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.url).toBe("https://api.openrouteservice.org/v2/directions/driving-car/geojson");
  });

  it("the matrix asks for durations and answers whole minutes, rounded up", async () => {
    const { fetch, seen } = scriptedFetch([{ status: 200, body: { durations: [[0, 966.7], [1010.2, 0]] } }]);
    const routing = createOrsRoutingProvider({ apiKey: "ors-test-key", fetch });

    expect(await routing.matrix({ points: [aquarium, varsity], mode: "walking" })).toEqual([
      [0, 17],
      [17, 0],
    ]);
    expect(seen[0]).toMatchObject({
      url: "https://api.openrouteservice.org/v2/matrix/foot-walking",
      body: { locations: [[-84.3951, 33.7634], [-84.3894, 33.7717]], metrics: ["duration"] },
    });
  });
});

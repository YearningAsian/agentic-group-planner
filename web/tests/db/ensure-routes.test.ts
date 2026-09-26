import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureRoutes, travelMinutes } from "@/features/map/server";
import { createMockRoutingProvider } from "@/lib/providers/routing/mock";
import type { RoutingProvider } from "@/lib/providers/routing/types";
import { adminClient, cleanup, createPlace, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let aquarium: string;
let nearby: string;
let farAway: string;

/** The mock provider, counting the legs it's asked for. */
function countingProvider() {
  const mock = createMockRoutingProvider();
  const calls: { mode: string }[] = [];
  const provider: RoutingProvider = {
    name: mock.name,
    route: async (input) => {
      calls.push({ mode: input.mode });
      return mock.route(input);
    },
    matrix: (input) => mock.matrix(input),
  };
  return { provider, calls };
}

async function routeRows(from: string) {
  const { data, error } = await admin
    .from("routes")
    .select("from_place_id, to_place_id, mode, duration_s, provider, updated_at")
    .eq("from_place_id", from)
    .order("to_place_id");
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  // About 1.0 km and 3.0 km due north of the first place.
  aquarium = (await createPlace(batch, { name: "Aquarium", lat: 33.7634, lng: -84.3951 })).placeId;
  nearby = (await createPlace(batch, { name: "Nearby", lat: 33.7724, lng: -84.3951 })).placeId;
  farAway = (await createPlace(batch, { name: "Far away", lat: 33.7904, lng: -84.3951 })).placeId;
});

// Deleting the batch's places cascades to their routes.
afterAll(() => cleanup(batch));

describe("ensureRoutes", () => {
  it("pairs under 1.5 km use walking", async () => {
    const { provider } = countingProvider();

    const legs = await ensureRoutes(
      [
        { from: aquarium, to: nearby },
        { from: aquarium, to: farAway },
      ],
      { provider },
    );

    expect(legs.get(`${aquarium}:${nearby}`)).toMatchObject({ mode: "walking", distanceM: 1001, durationS: 751 });
    expect(legs.get(`${aquarium}:${farAway}`)).toMatchObject({ mode: "driving", distanceM: 3002 });
    expect(legs.get(`${aquarium}:${nearby}`)!.geometry).toEqual({
      type: "LineString",
      coordinates: [[-84.3951, 33.7634], [-84.3951, 33.7724]],
    });
    const rows = await routeRows(aquarium);
    expect(rows.map((r) => [r.to_place_id, r.mode, r.provider]).sort()).toEqual(
      [
        [nearby, "walking", "mock"],
        [farAway, "driving", "mock"],
      ].sort(),
    );
  });

  it("only missing pairs are fetched and upserted", async () => {
    // A cached leg (2 km, so driving) with a duration no provider would produce, so a refetch would show.
    const { error } = await admin.from("routes").insert({
      from_place_id: nearby,
      to_place_id: farAway,
      mode: "driving",
      geometry: { type: "LineString", coordinates: [[-84.3951, 33.7724], [-84.3951, 33.7904]] },
      duration_s: 1234,
      distance_m: 2001,
      provider: "ors",
      fetched_at: new Date().toISOString(),
    });
    if (error) throw error;
    const [cached] = await routeRows(nearby);
    const { provider, calls } = countingProvider();

    const legs = await ensureRoutes(
      [
        { from: nearby, to: farAway },
        { from: farAway, to: nearby },
        { from: farAway, to: nearby },
        { from: nearby, to: nearby },
      ],
      { provider },
    );

    // One fetch: the reverse leg. The duplicate and the same-place pair cost nothing.
    expect(calls).toEqual([{ mode: "driving" }]);
    expect(legs.get(`${nearby}:${farAway}`)).toMatchObject({ mode: "driving", durationS: 1234, distanceM: 2001 });
    expect(legs.get(`${farAway}:${nearby}`)).toMatchObject({ mode: "driving", distanceM: 2002 });
    expect(legs.has(`${nearby}:${nearby}`)).toBe(false);
    expect(await routeRows(nearby)).toEqual([cached]);
    expect(await routeRows(farAway)).toEqual([expect.objectContaining({ to_place_id: nearby, provider: "mock" })]);

    // Everything is cached now.
    await ensureRoutes([{ from: farAway, to: nearby }], { provider });
    expect(calls).toHaveLength(1);
  });

  it("travel minutes come from the cache, or a straight-line estimate, and write nothing", async () => {
    const lonely = (await createPlace(batch, { name: "Lonely", lat: 33.7634, lng: -84.3861 })).placeId;
    const before = await routeRows(lonely);

    const minutes = await travelMinutes([
      { from: nearby, to: farAway },
      { from: lonely, to: aquarium },
      { from: aquarium, to: aquarium },
    ]);

    // Cached: 1234 s is 21 minutes, rounded up. Estimated: 832 m walked at 4.8 km/h is 624 s, 11 minutes.
    expect(minutes.get(`${nearby}:${farAway}`)).toBe(21);
    expect(minutes.get(`${lonely}:${aquarium}`)).toBe(11);
    expect(minutes.get(`${aquarium}:${aquarium}`)).toBe(0);
    expect(await routeRows(lonely)).toEqual(before);
  });
});

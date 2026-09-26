import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let member: TestUser;
let outsider: TestUser;
let tripId: string;
let placeIds: string[];

function item(overrides: Record<string, unknown> = {}) {
  return {
    trip_id: tripId,
    slot_key: "morning",
    label: "Morning",
    category: "activity",
    starts_at: "2026-09-26T14:00:00Z",
    ends_at: "2026-09-26T16:30:00Z",
    position: 1,
    seed_batch: batch,
    ...overrides,
  };
}

async function insertItem(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from("itinerary_items").insert(item(overrides)).select("id").single();
  if (error) throw error;
  return data.id as string;
}

function option(itemId: string, placeId: string, rank: number) {
  return {
    trip_id: tripId,
    item_id: itemId,
    place_id: placeId,
    rank,
    price_cents: 4200,
    score: 0.8,
    score_breakdown: { preference: 0.9, cost: 0.7, travel: 0.8, fairness: 0.7, per_member: {} },
    source: "mock",
    seed_batch: batch,
  };
}

async function insertOption(itemId: string, placeId: string, rank: number): Promise<string> {
  const { data, error } = await admin.from("item_options").insert(option(itemId, placeId, rank)).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  member = await createUser({ batch, displayName: "Person 1" });
  outsider = await createUser({ batch, displayName: "Outsider" });
  ({ tripId } = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: member.userId }] }));
  placeIds = [(await createPlace(batch)).placeId, (await createPlace(batch)).placeId];
});

afterAll(() => cleanup(batch));

describe("places and itinerary migration", () => {
  it("an item can't go from tbd to voting without passing through proposing", async () => {
    const id = await insertItem();
    const skip = await admin.from("itinerary_items").update({ status: "voting" }).eq("id", id);
    expect(skip.error?.message).toContain("invalid_transition");

    for (const status of ["proposing", "voting", "decided"]) {
      const step = await admin.from("itinerary_items").update({ status }).eq("id", id);
      expect(step.error, status).toBeNull();
    }
    const back = await admin.from("itinerary_items").update({ status: "voting" }).eq("id", id);
    expect(back.error?.message).toContain("invalid_transition");
  });

  it("area_label, area_lat, and area_lng are all set or all null", async () => {
    const partial = await admin.from("itinerary_items").insert(item({ slot_key: "dinner", area_label: "Midtown" }));
    expect(partial.error?.code).toBe("23514");
    const full = await admin
      .from("itinerary_items")
      .insert(item({ slot_key: "dinner", area_label: "Midtown", area_lat: 33.7835, area_lng: -84.3834 }));
    expect(full.error).toBeNull();
  });

  it("an item has at most one option per rank and per place", async () => {
    const lunch = await insertItem({ slot_key: "lunch" });
    await insertOption(lunch, placeIds[0]!, 1);
    const sameRank = await admin.from("item_options").insert(option(lunch, placeIds[1]!, 1));
    expect(sameRank.error?.code).toBe("23505");
    const samePlace = await admin.from("item_options").insert(option(lunch, placeIds[0]!, 2));
    expect(samePlace.error?.code).toBe("23505");
  });

  it("members select items; non-members select none", async () => {
    await insertItem({ slot_key: "visible" });
    const own = await member.client.from("itinerary_items").select("id").eq("trip_id", tripId);
    expect(own.error).toBeNull();
    expect(own.data?.length).toBeGreaterThan(0);
    const other = await outsider.client.from("itinerary_items").select("id").eq("trip_id", tripId);
    expect(other.data).toEqual([]);
    const places = await outsider.client.from("places").select("id").in("id", placeIds);
    expect(places.data).toHaveLength(2);
  });

  it("ends_at must be after starts_at", async () => {
    const { error } = await admin
      .from("itinerary_items")
      .insert(item({ slot_key: "backwards", starts_at: "2026-09-26T16:00:00Z", ends_at: "2026-09-26T16:00:00Z" }));
    expect(error?.code).toBe("23514");
  });
});

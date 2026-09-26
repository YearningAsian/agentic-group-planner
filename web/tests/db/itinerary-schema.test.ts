import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let member: TestUser;
let outsider: TestUser;
let tripId: string;
let memberIds: string[];
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

async function insertOption(itemId: string, placeId: string, rank: number): Promise<string> {
  const { data, error } = await admin
    .from("item_options")
    .insert({
      trip_id: tripId,
      item_id: itemId,
      place_id: placeId,
      rank,
      price_cents: 4200,
      score: 0.8,
      score_breakdown: { preference: 0.9, cost: 0.7, travel: 0.8, fairness: 0.7, per_member: {} },
      source: "mock",
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  member = await createUser({ batch, displayName: "Person 1" });
  outsider = await createUser({ batch, displayName: "Outsider" });
  ({ tripId, memberIds } = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: member.userId }] }));
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

  it("a vote can't point at another item's option (composite foreign key)", async () => {
    const first = await insertItem({ slot_key: "lunch" });
    const second = await insertItem({ slot_key: "afternoon" });
    const firstOption = await insertOption(first, placeIds[0]!, 1);
    await insertOption(second, placeIds[1]!, 1);

    const vote = { trip_id: tripId, member_id: memberIds[0], seed_batch: batch };
    const wrong = await admin.from("votes").insert({ ...vote, item_id: second, option_id: firstOption });
    expect(wrong.error?.code).toBe("23503");
    const right = await admin.from("votes").insert({ ...vote, item_id: first, option_id: firstOption });
    expect(right.error).toBeNull();
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

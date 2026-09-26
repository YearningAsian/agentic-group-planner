import { randomUUID } from "node:crypto";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildItineraryExport, toIcs } from "@/features/itinerary/server";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let person1: TestUser;
let person2: TestUser;
let outsider: TestUser;
let tripId: string;
let memberIds: string[];

const as = (user: TestUser) => user.client as SupabaseClient<Database>;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert({ ...row, seed_batch: batch }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  [person1, person2, outsider] = await Promise.all(
    ["Person 1", "Person 2", "Person 9"].map((displayName) => createUser({ batch, displayName })),
  );
  ({ tripId, memberIds } = await createTrip(batch, {
    title: "Saturday in Atlanta",
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
    ],
  }));
  const { placeId } = await createPlace(batch, { name: "Georgia Aquarium", address: "225 Baker St NW" });
  const morning = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: "morning",
    label: "Morning",
    category: "activity",
    starts_at: "2026-10-03T14:00:00Z",
    ends_at: "2026-10-03T16:30:00Z",
    position: 1,
    status: "proposing",
  });
  const option = await insert("item_options", {
    trip_id: tripId,
    item_id: morning,
    place_id: placeId,
    rank: 1,
    price_cents: 4200,
    score: 0.9,
    score_breakdown: {},
    source: "mock",
  });
  // Forward only: proposing → voting → decided, with the option chosen.
  await admin.from("itinerary_items").update({ status: "voting" }).eq("id", morning);
  await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: option }).eq("id", morning);
  for (const member_id of memberIds) await admin.from("item_attendees").insert({ item_id: morning, member_id, trip_id: tripId, seed_batch: batch });
  // Person 1 attends lunch alone.
  const lunch = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: "lunch",
    label: "Lunch",
    category: "food",
    starts_at: "2026-10-03T16:45:00Z",
    ends_at: "2026-10-03T17:45:00Z",
    position: 1,
  });
  await admin.from("item_attendees").insert({ item_id: lunch, member_id: memberIds[0], trip_id: tripId, seed_batch: batch });

  // An open mandate on the morning, with Person 2's own share still to approve.
  const mandate = await insert("mandates", {
    trip_id: tripId,
    item_id: morning,
    option_id: option,
    merchant: "Demo Tickets (mock merchant)",
    title: "Georgia Aquarium · 2 tickets",
    quote_id: "q-1",
    quote_cents: 8400,
    cap_cents: 9600,
    currency: "usd",
    expires_at: "2026-10-03T00:00:00Z",
    idempotency_key: `mandate:${randomUUID()}`,
  });
  await insert("payment_holds", {
    trip_id: tripId,
    mandate_id: mandate,
    payer_member_id: memberIds[1],
    share_member_id: memberIds[1],
    kind: "own",
    share_cents: 4200,
    cap_cents: 4800,
    status: "pending",
    idempotency_key: `share:${mandate}:${memberIds[1]}:own`,
  });
});

afterAll(() => cleanup(batch));

describe("buildItineraryExport through row-level security", () => {
  it("a member gets their attended stops with place, attendees, and payment status", async () => {
    const itinerary = await buildItineraryExport(as(person2), { tripId, memberId: "me" });

    expect(itinerary.member.display_name).toBe("Person 2");
    expect(itinerary.stops.map((s) => s.label)).toEqual(["Morning"]);
    expect(itinerary.stops[0]).toMatchObject({
      status: "decided",
      place: { name: "Georgia Aquarium", address: "225 Baker St NW" },
      attendees: [{ member_id: memberIds[0], display_name: "Person 1" }],
      payment: { status: "pending", label: "Approve up to $48", share_cents: 4200 },
    });
    expect(itinerary.totals).toEqual({ committed_cents: 0, paid_cents: 0, to_approve: 1, status: "in_progress" });
    expect(toIcs(itinerary).match(/BEGIN:VEVENT/g)).toHaveLength(1);

    // Another member's schedule on the same trip, by ID.
    const theirs = await buildItineraryExport(as(person2), { tripId, memberId: memberIds[0]! });
    expect(theirs.stops.map((s) => s.label)).toEqual(["Morning", "Lunch"]);
  });

  it("a non-member gets not_permitted", async () => {
    await expect(buildItineraryExport(as(outsider), { tripId, memberId: "me" })).rejects.toMatchObject({ code: "not_permitted" });
  });
});

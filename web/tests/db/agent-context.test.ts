import { randomUUID } from "node:crypto";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext, loadTripSnapshot } from "@/lib/agent/context";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let tripId: string;
let memberIds: string[];
let morning: string;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert({ ...row, seed_batch: batch }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  const person1 = await createUser({ batch, displayName: "Person 1" });
  const person2 = await createUser({ batch, displayName: "Person 2" });
  ({ tripId, memberIds } = await createTrip(batch, {
    title: "Saturday in Atlanta",
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
      { displayName: "Person 4" },
    ],
  }));
  await insert("member_constraints", { trip_id: tripId, member_id: memberIds[1], budget_cents: 8000, dietary: ["vegetarian"] });

  const item = (slot_key: string, hour: number, status = "tbd") => ({
    trip_id: tripId,
    slot_key,
    label: slot_key[0]!.toUpperCase() + slot_key.slice(1),
    category: "activity",
    starts_at: `2026-09-26T${hour}:00:00Z`,
    ends_at: `2026-09-26T${hour + 1}:30:00Z`,
    position: 1,
    status,
  });
  morning = await insert("itinerary_items", item("morning", 14));
  const old = await insert("itinerary_items", item("lunch", 16));
  await admin.from("itinerary_items").update({ status: "cancelled" }).eq("id", old);
  const { placeId } = await createPlace(batch, { name: "Georgia Aquarium" });
  await insert("item_options", {
    trip_id: tripId,
    item_id: morning,
    place_id: placeId,
    rank: 1,
    price_cents: 4200,
    score: 0.9,
    score_breakdown: {},
    source: "mock",
  });

  for (let i = 0; i < 32; i++) {
    await insert("messages", {
      trip_id: tripId,
      sender_type: "member",
      sender_member_id: memberIds[i % 2],
      kind: "text",
      body: `message ${i}`,
      client_id: randomUUID(),
    });
  }
});

afterAll(() => cleanup(batch));

describe("agent context from the database", () => {
  it("reads members with constraints, open items with options, and the last 30 messages oldest first", async () => {
    const snapshot = await loadTripSnapshot(admin, tripId);

    expect(snapshot.trip.title).toBe("Saturday in Atlanta");
    expect(snapshot.members.find((m) => m.id === memberIds[1])).toMatchObject({ budget_cents: 8000, dietary: ["vegetarian"] });
    expect(snapshot.members.find((m) => m.id === memberIds[2])).toMatchObject({ status: "placeholder", budget_cents: null });
    // The cancelled lunch is history, not plan.
    expect(snapshot.items.map((i) => i.id)).toEqual([morning]);
    expect(snapshot.options).toEqual([expect.objectContaining({ item_id: morning, place_name: "Georgia Aquarium", price_cents: 4200 })]);
    expect(snapshot.messages).toHaveLength(30);
    expect(snapshot.messages[0]!.body).toBe("message 2");
    expect(snapshot.messages.at(-1)!.body).toBe("message 31");
  });

  it("buildContext renders it with handles for the requester", async () => {
    const context = await buildContext(tripId, memberIds[1]!, admin);

    expect(context.system).toContain("M2 Person 2 (vegetarian) · budget $80");
    expect(context.system).toContain("M3 Person 4 (placeholder) · no budget set");
    expect(context.system).toContain("I1 Morning 10:00–11:30 · tbd");
    expect(context.system).toContain("O1 Georgia Aquarium (P1) · $42 per person");
    expect(context.system).toContain("This request is from M2 (Person 2).");
    expect(context.handles.I1).toBe(morning);
    expect(context.messages.at(-1)).toEqual({ role: "user", content: "Person 2 (M2): message 31" });
  });
});

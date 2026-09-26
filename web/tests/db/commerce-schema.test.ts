import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let person1: TestUser;
let tripId: string;
let memberIds: string[];
let placeId: string;

async function insert<T = { id: string }>(table: string, row: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.from(table).insert({ seed_batch: batch, ...row }).select("id").single();
  if (error) throw error;
  return data as T;
}

async function itemWithOption(slotKey: string): Promise<{ itemId: string; optionId: string }> {
  const { id: itemId } = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: slotKey,
    label: slotKey,
    category: "activity",
    starts_at: "2026-09-26T14:00:00Z",
    ends_at: "2026-09-26T16:00:00Z",
    position: 1,
  });
  const { id: optionId } = await insert("item_options", {
    trip_id: tripId,
    item_id: itemId,
    place_id: placeId,
    rank: 1,
    price_cents: 4200,
    score: 0.8,
    score_breakdown: {},
    source: "mock",
  });
  return { itemId, optionId };
}

function mandate(itemId: string, optionId: string) {
  return {
    trip_id: tripId,
    item_id: itemId,
    option_id: optionId,
    merchant: "Demo Tickets (mock merchant)",
    title: "Georgia Aquarium · 2 tickets",
    quote_id: randomUUID(),
    quote_cents: 8400,
    cap_cents: 9400,
    currency: "usd",
    expires_at: "2026-09-27T14:00:00Z",
    idempotency_key: `mandate:${randomUUID()}`,
  };
}

function share(mandateId: string, shareMember: string, kind: "own" | "fronted", status = "pending") {
  return {
    trip_id: tripId,
    mandate_id: mandateId,
    // A placeholder's own row has no payer until they claim the lane.
    payer_member_id: status === "awaiting_member" ? null : kind === "fronted" ? memberIds[0] : shareMember,
    share_member_id: shareMember,
    kind,
    share_cents: 4200,
    cap_cents: 4700,
    status,
    idempotency_key: `share:${mandateId}:${shareMember}:${kind}:${randomUUID()}`,
  };
}

beforeAll(async () => {
  person1 = await createUser({ batch, displayName: "Person 1" });
  ({ tripId, memberIds } = await createTrip(batch, {
    members: [{ displayName: "Person 1", profileId: person1.userId }, { displayName: "Person 4" }],
  }));
  placeId = (await createPlace(batch)).placeId;
});

afterAll(() => cleanup(batch));

describe("commerce and webhooks migration", () => {
  it("a share row can't go from captured back to authorized", async () => {
    const { itemId, optionId } = await itemWithOption("morning");
    const { id: mandateId } = await insert("mandates", mandate(itemId, optionId));
    const { id: holdId } = await insert("payment_holds", share(mandateId, memberIds[0]!, "own"));
    for (const status of ["authorized", "captured"]) {
      expect((await admin.from("payment_holds").update({ status }).eq("id", holdId)).error, status).toBeNull();
    }
    const back = await admin.from("payment_holds").update({ status: "authorized" }).eq("id", holdId);
    expect(back.error?.message).toContain("invalid_transition");
  });

  it("an item has at most one live mandate", async () => {
    const { itemId, optionId } = await itemWithOption("lunch");
    const { id: first } = await insert("mandates", mandate(itemId, optionId));
    const second = await admin.from("mandates").insert({ ...mandate(itemId, optionId), seed_batch: batch });
    expect(second.error?.code).toBe("23505");

    // Once the first is cancelled, a new one (a re-approval) is allowed.
    expect((await admin.from("mandates").update({ status: "cancelled" }).eq("id", first)).error).toBeNull();
    const retry = await admin.from("mandates").insert({ ...mandate(itemId, optionId), supersedes_mandate_id: first, seed_batch: batch });
    expect(retry.error).toBeNull();
  });

  it("an authenticated user can't read webhook_events", async () => {
    const eventId = `evt_${randomUUID()}`;
    await admin
      .from("webhook_events")
      .insert({ provider: "stripe", event_id: eventId, type: "payment_intent.succeeded", received_at: new Date().toISOString(), seed_batch: batch });
    const asUser = await person1.client.from("webhook_events").select("event_id").eq("event_id", eventId);
    expect(asUser.data ?? []).toEqual([]);
    const asAdmin = await admin.from("webhook_events").select("event_id").eq("event_id", eventId);
    expect(asAdmin.data).toHaveLength(1);
    await admin.from("webhook_events").delete().eq("event_id", eventId);
  });

  it("a share has at most one own row and one fronted row", async () => {
    const { itemId, optionId } = await itemWithOption("afternoon");
    const { id: mandateId } = await insert("mandates", mandate(itemId, optionId));
    const person4 = memberIds[1]!;
    await insert("payment_holds", share(mandateId, person4, "own", "awaiting_member"));
    await insert("payment_holds", share(mandateId, person4, "fronted"));
    const duplicate = await admin.from("payment_holds").insert({ ...share(mandateId, person4, "fronted"), seed_batch: batch });
    expect(duplicate.error?.code).toBe("23505");
  });
});

import { randomUUID } from "node:crypto";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sendMessage } from "@/features/chat/server";
import { adminClient, cleanup, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let person1: TestUser;
let outsider: TestUser;
let tripId: string;
let memberIds: string[];
let otherTripItem: string;

const as = (user: TestUser) => user.client as SupabaseClient<Database>;

beforeAll(async () => {
  person1 = await createUser({ batch, displayName: "Person 1" });
  outsider = await createUser({ batch, displayName: "Person 9" });
  ({ tripId, memberIds } = await createTrip(batch, {
    members: [{ displayName: "Person 1", profileId: person1.userId }, { displayName: "Person 4" }],
  }));
  const other = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: outsider.userId }] });
  const { data, error } = await admin
    .from("itinerary_items")
    .insert({
      trip_id: other.tripId,
      slot_key: "lunch",
      label: "Lunch",
      category: "food",
      starts_at: "2026-10-03T16:45:00Z",
      ends_at: "2026-10-03T17:45:00Z",
      position: 1,
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (error) throw error;
  otherTripItem = data.id;
});

afterAll(() => cleanup(batch));

async function messagesWith(clientId: string) {
  const { data, error } = await admin.from("messages").select("*").eq("client_id", clientId);
  if (error) throw error;
  return data;
}

async function runsFor(messageId: string) {
  const { data, error } = await admin.from("agent_runs").select("*").eq("trigger_message_id", messageId);
  if (error) throw error;
  return data;
}

describe("sendMessage", () => {
  it("the same client_id twice returns the same message_id and one row", async () => {
    const clientId = randomUUID();
    const first = await sendMessage(as(person1), { tripId, clientId, body: "hi everyone" });
    const second = await sendMessage(as(person1), { tripId, clientId, body: "hi everyone" });

    expect(second).toEqual(first);
    expect(first.agentRunId).toBeNull();
    const messages = await messagesWith(clientId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ sender_type: "member", sender_member_id: memberIds[0], kind: "text", mentions_agent: false });
  });

  it("a body with @agent creates exactly one queued agent_run linked by trigger_message_id", async () => {
    const clientId = randomUUID();
    const first = await sendMessage(as(person1), { tripId, clientId, body: "@Agent plan Saturday" });
    // A double tap resends the same client_id.
    const second = await sendMessage(as(person1), { tripId, clientId, body: "@Agent plan Saturday" });

    expect(second).toEqual(first);
    const runs = await runsFor(first.messageId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: first.agentRunId,
      trip_id: tripId,
      trigger: "mention",
      status: "queued",
      requester_member_id: memberIds[0],
      provider: expect.any(String),
      model: expect.any(String),
    });
    expect((await messagesWith(clientId))[0]!.mentions_agent).toBe(true);
  });

  it("a non-member gets not_permitted", async () => {
    const clientId = randomUUID();
    await expect(sendMessage(as(outsider), { tripId, clientId, body: "@agent let me in" })).rejects.toMatchObject({
      code: "not_permitted",
    });
    expect(await messagesWith(clientId)).toEqual([]);
  });

  it("a comment names an item on the same trip", async () => {
    const { data: item } = await admin
      .from("itinerary_items")
      .insert({
        trip_id: tripId,
        slot_key: "lunch",
        label: "Lunch",
        category: "food",
        starts_at: "2026-10-03T16:45:00Z",
        ends_at: "2026-10-03T17:45:00Z",
        position: 1,
        seed_batch: batch,
      })
      .select("id")
      .single();
    const comment = await sendMessage(as(person1), { tripId, clientId: randomUUID(), body: "somewhere cheaper?", itemId: item!.id });
    expect((await admin.from("messages").select("item_id").eq("id", comment.messageId).single()).data?.item_id).toBe(item!.id);

    const clientId = randomUUID();
    await expect(
      sendMessage(as(person1), { tripId, clientId, body: "wrong trip", itemId: otherTripItem }),
    ).rejects.toMatchObject({ code: "not_permitted" });
    expect(await messagesWith(clientId)).toEqual([]);
  });

  it("a client_id another member already used is a conflict, not their message", async () => {
    const clientId = randomUUID();
    const { data: theirs } = await admin.from("trip_members").select("trip_id").eq("profile_id", outsider.userId).single();
    await sendMessage(as(outsider), { tripId: theirs!.trip_id, clientId, body: "mine" });

    await expect(sendMessage(as(person1), { tripId, clientId, body: "also mine" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("the messages insert policy", () => {
  it("refuses a comment on another trip's item, even straight through the API", async () => {
    const { error } = await as(person1).from("messages").insert({
      trip_id: tripId,
      sender_type: "member",
      sender_member_id: memberIds[0],
      kind: "text",
      body: "sneaky",
      item_id: otherTripItem,
      client_id: randomUUID(),
    });
    expect(error?.code).toBe("42501");
  });
});

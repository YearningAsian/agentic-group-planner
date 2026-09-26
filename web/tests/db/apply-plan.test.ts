import { randomUUID } from "node:crypto";
import type { components } from "@agp/shared/optimizer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPlan } from "@/features/itinerary/server";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

type PlanRequest = components["schemas"]["PlanRequest"];
type PlanResponse = components["schemas"]["PlanResponse"];

const batch = testBatch();
const admin = adminClient();
let person1: TestUser;
let person2: TestUser;
let placeIds: string[];

interface Trip {
  tripId: string;
  memberIds: string[];
  itemIds: string[];
  runId: string;
}

/** A trip with two joined members, two planned items (morning, lunch), and a running run. */
async function tripWithItems(): Promise<Trip> {
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
    ],
  });
  const itemIds: string[] = [];
  for (const [i, slot] of ["morning", "lunch"].entries()) {
    const { data, error } = await admin
      .from("itinerary_items")
      .insert({
        trip_id: tripId,
        slot_key: slot,
        label: slot === "morning" ? "Morning" : "Lunch",
        category: slot === "morning" ? "activity" : "food",
        starts_at: `2026-09-26T${14 + i * 3}:00:00Z`,
        ends_at: `2026-09-26T${16 + i * 3}:00:00Z`,
        position: 1,
        status: "proposing",
        seed_batch: batch,
      })
      .select("id")
      .single();
    if (error) throw error;
    itemIds.push(data.id);
  }
  const { data: run, error } = await admin
    .from("agent_runs")
    .insert({ trip_id: tripId, trigger: "mention", status: "running", provider: "mock", model: "muse-spark-1.3", seed_batch: batch })
    .select("id")
    .single();
  if (error) throw error;
  return { tripId, memberIds, itemIds, runId: run.id };
}

async function startToolCall(trip: Trip, toolCallId: string): Promise<void> {
  const { error } = await admin.from("tool_calls").insert({
    trip_id: trip.tripId,
    run_id: trip.runId,
    tool_call_id: toolCallId,
    tool_name: "plan_day",
    input: { mode: "initial" },
    status: "started",
    seed_batch: batch,
  });
  if (error) throw error;
}

/** What plan_day sent: the candidates carry the prices. */
function request(trip: Trip, toolCallId: string): PlanRequest {
  const candidate = (placeId: string) => ({ place_id: placeId, price_cents: 4200, tags: [], dietary_tags: [], duration_min: 90 });
  return {
    request_id: toolCallId,
    mode: "initial",
    members: trip.memberIds.map((id) => ({ id, dietary: [], interests: [] })),
    slots: [
      { key: "morning", starts_at: "2026-09-26T14:00:00Z", ends_at: "2026-09-26T16:00:00Z", together: true, pinned: null, candidates: placeIds.slice(0, 3).map(candidate) },
      { key: "lunch", starts_at: "2026-09-26T17:00:00Z", ends_at: "2026-09-26T19:00:00Z", together: true, pinned: null, candidates: placeIds.slice(3).map(candidate) },
    ],
    travel: [],
  };
}

/** The optimizer's answer: everyone together, three options in the morning and two at lunch. */
function response(trip: Trip, toolCallId: string): PlanResponse {
  const option = (placeId: string, rank: number) => ({ place_id: placeId, rank, score: 0.9 - rank / 10, preference: 0.8, cost: 0.4, travel: 0.2, fairness: 0.7 });
  return {
    request_id: toolCallId,
    engine: "enumeration",
    status: "feasible",
    solve_ms: 12,
    plans: [
      {
        rank: 1,
        total_score: 0.8,
        fairness: 0.7,
        split: false,
        member_scores: trip.memberIds.map((id) => ({ member_id: id, score: 0.8, preference: 0.8, cost: 0.4, travel: 0.2 })),
        assignments: [
          { slot_key: "morning", groups: [{ place_id: placeIds[0]!, member_ids: trip.memberIds }] },
          { slot_key: "lunch", groups: [{ place_id: placeIds[3]!, member_ids: trip.memberIds }] },
        ],
      },
    ],
    slot_options: [
      { slot_key: "morning", groups: [{ member_ids: trip.memberIds, options: [0, 1, 2].map((i) => option(placeIds[i]!, i + 1)) }] },
      { slot_key: "lunch", groups: [{ member_ids: trip.memberIds, options: [3, 4].map((i, r) => option(placeIds[i]!, r + 1)) }] },
    ],
    infeasible_reasons: [],
  };
}

function applyInput(trip: Trip, toolCallId: string) {
  return {
    tripId: trip.tripId,
    actorMemberId: trip.memberIds[0]!,
    runId: trip.runId,
    toolCallId,
    mode: "initial" as const,
    request: request(trip, toolCallId),
    response: response(trip, toolCallId),
    itemsBySlot: { morning: trip.itemIds[0]!, lunch: trip.itemIds[1]! },
    reasoning: {},
  };
}

/** A raw apply_plan payload for the SQL-level checks. */
function planPayload(trip: Trip, overrides: { actorMemberId?: string; itemId?: string } = {}) {
  return {
    trip_id: trip.tripId,
    actor_member_id: overrides.actorMemberId ?? trip.memberIds[0],
    run_id: trip.runId,
    tool_call_id: `call_${randomUUID()}`,
    mode: "initial",
    slots: [
      {
        item_id: overrides.itemId ?? trip.itemIds[0],
        member_ids: trip.memberIds,
        options: [
          { id: randomUUID(), place_id: placeIds[0], rank: 1, price_cents: 4200, score: 0.8, score_breakdown: {}, reasoning: null, source: "enumeration" },
        ],
      },
    ],
    card: { card_type: "plan" },
    result_summary: "test",
  };
}

async function count(table: string, tripId: string): Promise<number> {
  const { count: n, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("trip_id", tripId);
  if (error) throw error;
  return n ?? 0;
}

beforeAll(async () => {
  person1 = await createUser({ batch, displayName: "Person 1" });
  person2 = await createUser({ batch, displayName: "Person 2" });
  placeIds = [];
  for (let i = 0; i < 5; i++) placeIds.push((await createPlace(batch, { name: `Place ${i + 1}` })).placeId);
});

afterAll(() => cleanup(batch));

describe("apply_plan", () => {
  it("writes options and attendees, moves items proposing → voting, inserts one plan card, and marks the tool call succeeded", async () => {
    const trip = await tripWithItems();
    const toolCallId = `call_${randomUUID()}`;
    await startToolCall(trip, toolCallId);

    const { cardMessageId, changes } = await applyPlan(applyInput(trip, toolCallId));

    expect(changes).toEqual([]);
    expect(await count("item_options", trip.tripId)).toBe(5);
    expect(await count("item_attendees", trip.tripId)).toBe(4);
    const { data: items } = await admin.from("itinerary_items").select("status").eq("trip_id", trip.tripId);
    expect(items?.map((i) => i.status)).toEqual(["voting", "voting"]);

    const { data: card } = await admin.from("messages").select("*").eq("id", cardMessageId).single();
    expect(card).toMatchObject({ kind: "card", card_type: "plan", sender_type: "agent", agent_run_id: trip.runId });
    expect(card?.card_payload).toMatchObject({ card_type: "plan", applied_plan_rank: 1, engine: "enumeration" });
    expect((card?.card_payload as { slots: unknown[] }).slots).toHaveLength(2);

    const { data: call } = await admin.from("tool_calls").select("status, message_id, output").eq("tool_call_id", toolCallId).single();
    expect(call).toMatchObject({ status: "succeeded", message_id: cardMessageId, output: { ok: true, card_message_id: cardMessageId } });
  });

  it("calling it twice with the same tool_call_id writes nothing new", async () => {
    const trip = await tripWithItems();
    const toolCallId = `call_${randomUUID()}`;
    await startToolCall(trip, toolCallId);
    const first = await applyPlan(applyInput(trip, toolCallId));
    const second = await applyPlan(applyInput(trip, toolCallId));
    expect(second.cardMessageId).toBe(first.cardMessageId);
    expect(await count("item_options", trip.tripId)).toBe(5);
    expect(await count("messages", trip.tripId)).toBe(1);
  });

  it("rejects a non-member actor with not_permitted and writes nothing", async () => {
    const trip = await tripWithItems();
    const other = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: person2.userId }] });
    const payload = planPayload(trip, { actorMemberId: other.memberIds[0] });
    const { error } = await admin.rpc("apply_plan", { payload });
    expect(error?.message).toMatch(/not_permitted/);
    expect(await count("item_options", trip.tripId)).toBe(0);
  });

  it("rejects a payload naming an item from another trip", async () => {
    const trip = await tripWithItems();
    const other = await tripWithItems();
    const payload = planPayload(trip, { itemId: other.itemIds[0] });
    const { error } = await admin.rpc("apply_plan", { payload });
    expect(error?.message).toMatch(/not_permitted/);
    expect(await count("item_options", other.tripId)).toBe(0);
    expect(await count("item_options", trip.tripId)).toBe(0);
  });

  it("the authenticated role can't execute apply_plan", async () => {
    const trip = await tripWithItems();
    const { error } = await person1.client.rpc("apply_plan", { payload: planPayload(trip) });
    expect(error?.code).toBe("42501");
    expect(await count("item_options", trip.tripId)).toBe(0);
  });
});

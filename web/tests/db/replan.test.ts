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
  runId: string;
}

async function newTrip(): Promise<Trip> {
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
    ],
  });
  const { data: run, error } = await admin
    .from("agent_runs")
    .insert({ trip_id: tripId, trigger: "mention", status: "running", provider: "mock", model: "muse-spark-1.3", seed_batch: batch })
    .select("id")
    .single();
  if (error) throw error;
  return { tripId, memberIds, runId: run.id };
}

async function addItem(trip: Trip, slot: string, status: string, hour: number): Promise<string> {
  const { data, error } = await admin
    .from("itinerary_items")
    .insert({
      trip_id: trip.tripId,
      slot_key: slot,
      label: slot,
      category: "activity",
      starts_at: `2026-09-26T${hour}:00:00Z`,
      ends_at: `2026-09-26T${hour + 2}:00:00Z`,
      position: 1,
      status: status === "decided" ? "voting" : status,
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (error) throw error;
  if (status === "decided") {
    const option = await admin
      .from("item_options")
      .insert({ trip_id: trip.tripId, item_id: data.id, place_id: placeIds[0], rank: 1, price_cents: 4200, score: 0.5, score_breakdown: {}, source: "mock", seed_batch: batch })
      .select("id")
      .single();
    if (option.error) throw option.error;
    const decided = await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: option.data.id }).eq("id", data.id);
    if (decided.error) throw decided.error;
  }
  return data.id;
}

async function startToolCall(trip: Trip): Promise<string> {
  const toolCallId = `call_${randomUUID()}`;
  const { error } = await admin.from("tool_calls").insert({
    trip_id: trip.tripId,
    run_id: trip.runId,
    tool_call_id: toolCallId,
    tool_name: "plan_day",
    input: { mode: "replan" },
    status: "started",
    seed_batch: batch,
  });
  if (error) throw error;
  return toolCallId;
}

/** A replan of one slot, everyone together, with two new options (places 2 and 3). */
function replanOf(trip: Trip, toolCallId: string, slot: string, hour: number) {
  const candidate = (placeId: string) => ({ place_id: placeId, price_cents: 3000, tags: [], dietary_tags: [], duration_min: 90 });
  const option = (placeId: string, rank: number) => ({ place_id: placeId, rank, score: 0.9 - rank / 10, preference: 0.8, cost: 0.4, travel: 0.2, fairness: 0.7 });
  const request: PlanRequest = {
    request_id: toolCallId,
    mode: "replan",
    members: trip.memberIds.map((id) => ({ id, dietary: [], interests: [] })),
    slots: [{ key: slot, starts_at: `2026-09-26T${hour}:00:00Z`, ends_at: `2026-09-26T${hour + 2}:00:00Z`, together: true, pinned: null, candidates: placeIds.slice(1, 3).map(candidate) }],
    travel: [],
  };
  const response: PlanResponse = {
    request_id: toolCallId,
    engine: "enumeration",
    status: "feasible",
    solve_ms: 9,
    plans: [
      {
        rank: 1,
        total_score: 0.8,
        fairness: 0.7,
        split: false,
        member_scores: trip.memberIds.map((id) => ({ member_id: id, score: 0.8, preference: 0.8, cost: 0.4, travel: 0.2 })),
        assignments: [{ slot_key: slot, groups: [{ place_id: placeIds[1]!, member_ids: trip.memberIds }] }],
      },
    ],
    slot_options: [{ slot_key: slot, groups: [{ member_ids: trip.memberIds, options: [option(placeIds[1]!, 1), option(placeIds[2]!, 2)] }] }],
    infeasible_reasons: [],
  };
  return { request, response };
}

async function item(id: string) {
  const { data, error } = await admin.from("itinerary_items").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  person1 = await createUser({ batch, displayName: "Person 1" });
  person2 = await createUser({ batch, displayName: "Person 2" });
  placeIds = [];
  for (let i = 0; i < 3; i++) placeIds.push((await createPlace(batch, { name: `Place ${i + 1}` })).placeId);
});

afterAll(() => cleanup(batch));

describe("apply_plan replan", () => {
  it("a replan applies the builder's shifted times to the afternoon items, records time_shift changes, and keeps their status", async () => {
    const trip = await newTrip();
    const afternoon = await addItem(trip, "afternoon", "voting", 18);
    const dessert = await addItem(trip, "dessert", "tbd", 21);
    const toolCallId = await startToolCall(trip);
    const { request, response } = replanOf(trip, toolCallId, "dessert", 21);

    const result = await applyPlan({
      tripId: trip.tripId,
      actorMemberId: trip.memberIds[0]!,
      runId: trip.runId,
      toolCallId,
      mode: "replan",
      request,
      response,
      itemsBySlot: { dessert },
      reasoning: {},
      timeShifts: { [afternoon]: { starts_at: "2026-09-26T18:45:00Z", ends_at: "2026-09-26T20:45:00Z" } },
    });

    expect(await item(afternoon)).toMatchObject({ status: "voting" });
    expect(Date.parse((await item(afternoon)).starts_at)).toBe(Date.parse("2026-09-26T18:45:00Z"));
    expect(result.changes).toEqual([{ item_id: afternoon, kind: "time_shift", before: "18:00–20:00", after: "18:45–20:45" }]);
    expect(await item(dessert)).toMatchObject({ status: "voting" });
    const { data: card } = await admin.from("messages").select("card_payload").eq("id", result.cardMessageId).single();
    expect(card?.card_payload).toMatchObject({ mode: "replan", changes: result.changes });
  });

  it("an option change on a decided item supersedes it, and the replacement goes tbd → proposing → voting and points back through supersedes_item_id", async () => {
    const trip = await newTrip();
    const afternoon = await addItem(trip, "afternoon", "decided", 18);
    const toolCallId = await startToolCall(trip);
    const { request, response } = replanOf(trip, toolCallId, "afternoon", 18);

    const result = await applyPlan({
      tripId: trip.tripId,
      actorMemberId: trip.memberIds[0]!,
      runId: trip.runId,
      toolCallId,
      mode: "replan",
      request,
      response,
      itemsBySlot: { afternoon },
      reasoning: {},
    });

    expect(await item(afternoon)).toMatchObject({ status: "superseded" });
    const { data: replacements, error } = await admin.from("itinerary_items").select("*").eq("supersedes_item_id", afternoon);
    if (error) throw error;
    expect(replacements).toHaveLength(1);
    expect(replacements[0]).toMatchObject({ status: "voting", slot_key: "afternoon", trip_id: trip.tripId });
    const { count } = await admin.from("item_options").select("*", { count: "exact", head: true }).eq("item_id", replacements[0]!.id);
    expect(count).toBe(2);
    expect(result.changes).toContainEqual({ item_id: afternoon, kind: "superseded", before: "decided", after: "voting" });
  });

  it("booked items never change", async () => {
    const trip = await newTrip();
    const dinner = await addItem(trip, "dinner", "booked", 23);
    const before = await item(dinner);

    const shiftCall = await startToolCall(trip);
    const shift = replanOf(trip, shiftCall, "dessert", 20);
    const dessert = await addItem(trip, "dessert", "tbd", 20);
    await expect(
      applyPlan({
        tripId: trip.tripId,
        actorMemberId: trip.memberIds[0]!,
        runId: trip.runId,
        toolCallId: shiftCall,
        mode: "replan",
        ...shift,
        itemsBySlot: { dessert },
        reasoning: {},
        timeShifts: { [dinner]: { starts_at: "2026-09-27T00:00:00Z", ends_at: "2026-09-27T02:00:00Z" } },
      }),
    ).rejects.toMatchObject({ code: "not_permitted" });

    const planCall = await startToolCall(trip);
    const plan = replanOf(trip, planCall, "dinner", 23);
    await expect(
      applyPlan({ tripId: trip.tripId, actorMemberId: trip.memberIds[0]!, runId: trip.runId, toolCallId: planCall, mode: "replan", ...plan, itemsBySlot: { dinner }, reasoning: {} }),
    ).rejects.toThrow();

    const { data: raw } = await admin.rpc("apply_plan", {
      payload: {
        trip_id: trip.tripId,
        actor_member_id: trip.memberIds[0],
        run_id: trip.runId,
        tool_call_id: planCall,
        mode: "replan",
        slots: [],
        supersede_item_ids: [dinner],
        card: { card_type: "plan" },
        result_summary: "x",
      },
    });
    expect(raw).toBeNull();
    expect(await item(dinner)).toMatchObject({ status: "booked", starts_at: before.starts_at, ends_at: before.ends_at });
  });
});

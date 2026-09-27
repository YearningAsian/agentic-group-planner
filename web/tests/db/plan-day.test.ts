import { randomUUID } from "node:crypto";
import { PlanCard, type PlanDayInput, type ToolResult } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { uuidFor } from "../../scripts/demo/lib/ids";
import { seed } from "../../scripts/demo/seed";
import { applyPlan } from "@/features/itinerary/server";
import { startAgentRun } from "@/lib/agent/runner";
import type { OptimizerClient, PlannerResponse, PlanRequest } from "@/lib/optimizer/client";
import { mockPlan } from "@/lib/optimizer/mock";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { createPlanDayTool } from "@/lib/tools/plan-day/tool";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
// A Saturday afternoon in New York, so the seeded trip is on 2026-10-03.
const now = new Date("2026-09-26T15:00:00Z");
const batches: string[] = [batch];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

afterAll(async () => {
  for (const b of batches) await cleanup(b);
});

interface SeededTrip {
  batch: string;
  tripId: string;
  member: (key: "person1" | "person2" | "person3" | "person4") => string;
  item: (slot: "morning" | "lunch" | "afternoon" | "dinner") => string;
}

/** A fresh copy of the seeded Saturday trip (design §10.2), in its own batch. */
async function seededTrip(): Promise<SeededTrip> {
  const b = `${batch}:${batches.length}`;
  batches.push(b);
  const { tripId } = await seed({ batch: b, now });
  return { batch: b, tripId, member: (key) => uuidFor(b, `member:${key}`), item: (slot) => uuidFor(b, `item:${slot}`) };
}

/** A model that calls plan_day once with the given input and keeps what the tool returned. */
function scriptedLlm(input: unknown, seen: { result?: ToolResult }): LlmProvider {
  return {
    name: "mock",
    async runAgent({ tools }) {
      const output = (await tools.plan_day!.execute!(input, { toolCallId: "call-plan", messages: [], context: undefined })) as ToolResult;
      seen.result = output;
      return { text: "Here's a plan.", steps: [{ toolName: "plan_day", input, output }], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

/** Runs plan_day through the real runner for Person 1, with the optimizer double answering. */
async function runPlanDay(trip: SeededTrip, input: Partial<PlanDayInput>, answer: (r: PlanRequest) => PlannerResponse = mockPlan) {
  const { data: message, error } = await admin
    .from("messages")
    .insert({ trip_id: trip.tripId, sender_type: "member", sender_member_id: trip.member("person1"), kind: "text", body: "@agent plan Saturday", seed_batch: trip.batch })
    .select("id")
    .single();
  if (error) throw error;
  const { data: run, error: runError } = await admin
    .from("agent_runs")
    .insert({ trip_id: trip.tripId, trigger: "mention", trigger_message_id: message.id, requester_member_id: trip.member("person1"), provider: "mock", model: "m", seed_batch: trip.batch })
    .select("id")
    .single();
  if (runError) throw runError;
  const requests: PlanRequest[] = [];
  const optimizer: OptimizerClient = {
    plan: async (request) => {
      requests.push(request);
      return answer(request);
    },
  };
  const seen: { result?: ToolResult } = {};
  const outcome = await startAgentRun(run.id, {
    llm: scriptedLlm(input, seen),
    tools: { plan_day: createPlanDayTool({ optimizer: () => optimizer }) },
    broadcast: async () => {},
  });
  return { outcome, result: seen.result, requests, runId: run.id };
}

async function planCard(runId: string): Promise<PlanCard | null> {
  const { data } = await admin.from("messages").select("card_payload").eq("agent_run_id", runId).eq("card_type", "plan");
  return data && data.length > 0 ? PlanCard.parse(data[0]!.card_payload) : null;
}

async function itemRows(tripId: string) {
  const { data, error } = await admin
    .from("itinerary_items")
    .select("id, slot_key, label, category, starts_at, ends_at, status, position, together, created_by_run_id")
    .eq("trip_id", tripId)
    .order("starts_at")
    .order("position");
  if (error) throw error;
  return data;
}

async function optionsOf(itemId: string) {
  const { data, error } = await admin
    .from("item_options")
    .select("rank, price_cents, reasoning, place_id, places(name)")
    .eq("item_id", itemId)
    .order("rank");
  if (error) throw error;
  return data.map((o) => ({ ...o, name: (o.places as unknown as { name: string }).name }));
}

async function attendeesOf(itemId: string) {
  const { data, error } = await admin.from("item_attendees").select("member_id").eq("item_id", itemId);
  if (error) throw error;
  return data.map((a) => a.member_id).sort();
}

async function count(table: "item_options" | "item_attendees" | "messages", tripId: string) {
  const { count: n, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq("trip_id", tripId);
  if (error) throw error;
  return n ?? 0;
}

describe("plan_day", () => {
  it('constraint_updates for "all" with budget_cents 8000 sets every member\'s budget', async () => {
    const trip = await seededTrip();
    await admin.from("member_constraints").update({ budget_cents: 5000 }).eq("trip_id", trip.tripId);

    const { outcome, result, requests } = await runPlanDay(trip, {
      mode: "initial",
      constraint_updates: [{ member_handle: "all", budget_cents: 8000 }],
    });

    expect(outcome).toBe("succeeded");
    expect(result).toMatchObject({ ok: true });
    const { data: rows } = await admin.from("member_constraints").select("member_id, budget_cents, dietary, set_by_member_id").eq("trip_id", trip.tripId);
    expect(rows).toHaveLength(4);
    expect(rows!.every((r) => r.budget_cents === 8000 && r.set_by_member_id === trip.member("person1"))).toBe(true);
    // Only the budget changed: Person 2 is still vegetarian.
    expect(rows!.find((r) => r.member_id === trip.member("person2"))!.dietary).toEqual(["vegetarian"]);
    // The optimizer planned with the saved budgets.
    expect(requests[0]!.members.map((m) => m.budget_cents)).toEqual([8000, 8000, 8000, 8000]);
  });

  it("a split slot gets a sibling item with the same slot_key and each group's attendees", async () => {
    const trip = await seededTrip();

    const { outcome, result, runId } = await runPlanDay(trip, { mode: "initial" });

    expect(outcome).toBe("succeeded");
    const items = await itemRows(trip.tripId);
    const afternoon = items.filter((i) => i.slot_key === "afternoon");
    expect(afternoon).toHaveLength(2);
    const [original, sibling] = afternoon;
    expect(original!.id).toBe(trip.item("afternoon"));
    // Same slot, label, category, and times; the next position; made by this run.
    const { slot_key, label, category, starts_at, ends_at, together } = original!;
    expect(sibling).toMatchObject({ slot_key, label, category, starts_at, ends_at, together, position: 2, created_by_run_id: runId });
    expect(original!.position).toBe(1);
    expect(items.map((i) => [i.slot_key, i.status])).toEqual([
      ["morning", "voting"],
      ["lunch", "voting"],
      ["afternoon", "voting"],
      ["afternoon", "voting"],
      ["dinner", "tbd"],
    ]);

    // Design §10.2: Person 1 and Person 4 at the High Museum; Person 2 and Person 3 at Piedmont Park.
    expect(await attendeesOf(original!.id)).toEqual([trip.member("person1"), trip.member("person4")].sort());
    expect(await attendeesOf(sibling!.id)).toEqual([trip.member("person2"), trip.member("person3")].sort());
    const museumSide = await optionsOf(original!.id);
    const parkSide = await optionsOf(sibling!.id);
    expect(museumSide[0]).toMatchObject({ name: "High Museum of Art", price_cents: 1850 });
    expect(parkSide[0]).toMatchObject({ name: "Piedmont Park", price_cents: 0 });
    // Server-written reasoning from the facts: the group's best interest match, the price, the travel.
    expect(museumSide[0]!.reasoning).toMatch(/^Best fit for Person (1|4)'s interests \(.*\) · \$18\.50 · \d+ min (walk|drive)$/);
    expect(parkSide[0]!.reasoning).toMatch(/^Best fit for Person (2|3)'s interests \(.*outdoors.*\) · Free · \d+ min (walk|drive)$/);

    // The card's afternoon has both groups, each with its own item.
    const card = await planCard(runId);
    const slot = card!.slots.find((s) => s.slot_key === "afternoon")!;
    expect(slot.groups.map((g) => g.item_id)).toEqual([original!.id, sibling!.id]);
    expect(card!.plans[0]!.split).toBe(true);

    // The sibling and every new option got a handle the model can use next.
    expect(result!.handles).toMatchObject({ I5: "Afternoon (Person 2, Person 3)" });
    expect(Object.values(result!.handles!)).toEqual(expect.arrayContaining(["High Museum of Art", "Piedmont Park"]));

    // The chosen plan's legs are in the route cache, for the map: the aquarium to lunch, lunch to each side.
    const [aquarium] = await optionsOf(trip.item("morning"));
    const [lunch] = await optionsOf(trip.item("lunch"));
    for (const [from, to] of [
      [aquarium!.place_id, lunch!.place_id],
      [lunch!.place_id, museumSide[0]!.place_id],
      [lunch!.place_id, parkSide[0]!.place_id],
    ]) {
      const { data: legs } = await admin.from("routes").select("mode").eq("from_place_id", from!).eq("to_place_id", to!);
      expect(legs, `${from} → ${to}`).toHaveLength(1);
    }
  });

  it("an unknown item handle returns unknown_handle and changes nothing", async () => {
    const trip = await seededTrip();
    let called = false;

    const { outcome, result } = await runPlanDay(
      trip,
      { mode: "initial", item_handles: ["I9"], constraint_updates: [{ member_handle: "all", budget_cents: 5000 }] },
      (request) => {
        called = true;
        return mockPlan(request);
      },
    );

    expect(outcome).toBe("succeeded");
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_handle" } });
    expect(called).toBe(false);
    const { data: budgets } = await admin.from("member_constraints").select("budget_cents").eq("trip_id", trip.tripId);
    expect(budgets!.map((b) => b.budget_cents)).toEqual([8000, 8000, 8000, 8000]);
    expect((await itemRows(trip.tripId)).map((i) => i.status)).toEqual(["tbd", "tbd", "tbd", "tbd"]);
    expect(await count("item_options", trip.tripId)).toBe(0);
  });

  it("infeasible reasons show display names, not IDs", async () => {
    const trip = await seededTrip();
    const reasons = [
      `{member:${trip.member("person2")}}'s budget can't cover any lunch option`,
      `No lunch option meets ${trip.member("person3")}'s dietary needs`,
    ];

    const planned = await runPlanDay(trip, { mode: "initial" }, (request) => ({ ...mockPlan(request), infeasible_reasons: reasons }));

    const card = await planCard(planned.runId);
    expect(card!.infeasible).toEqual(["Person 2's budget can't cover any lunch option", "No lunch option meets Person 3's dietary needs"]);
    expect(planned.result!.summary).toContain("Person 2's budget can't cover any lunch option");
    expect(planned.result!.summary).not.toMatch(UUID);

    // With no plan at all, the model hears the same names.
    const other = await seededTrip();
    const none = await runPlanDay(other, { mode: "initial" }, (request) => ({
      ...mockPlan(request),
      status: "infeasible",
      plans: [],
      slot_options: [],
      infeasible_reasons: [`{member:${other.member("person2")}}'s budget can't cover the cheapest plan`, `${other.member("person4")} can't join`],
    }));
    expect(none.result).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(none.result!.error!.message).toContain("Person 2's budget can't cover the cheapest plan");
    expect(none.result!.error!.message).toContain("Person 4 can't join");
    expect(none.result!.error!.message).not.toMatch(UUID);
  });

  it("the ToolResult summary is at most 600 characters and mentions the split", async () => {
    const trip = await seededTrip();

    const { result } = await runPlanDay(trip, { mode: "initial" });

    expect(result!.ok).toBe(true);
    expect(result!.summary.length).toBeLessThanOrEqual(600);
    expect(result!.summary).toMatch(/split/i);
    expect(result!.summary).toContain("Person 2 and Person 3");
    // Prices read exactly as the card shows them, never rounded.
    expect(result!.summary).toContain("$18.50");
    expect(result!.summary).not.toContain("$19");
  });

  it("a response naming a place that isn't one of the slot's candidates is rejected, and nothing is written", async () => {
    const trip = await seededTrip();
    const { data: dessert } = await admin.from("places").select("id").eq("provider", "seed").eq("provider_place_id", "jenis-ice-cream").single();
    // A drifted optimizer offers the dessert place for lunch, where it was never a candidate.
    const drifted = (request: PlanRequest): PlannerResponse => {
      const response = mockPlan(request);
      const lunch = response.slot_options.find((s) => s.slot_key === "lunch")!;
      lunch.groups[0]!.options[1]!.place_id = dessert!.id;
      return response;
    };

    const { outcome, runId, requests } = await runPlanDay(trip, { mode: "initial" }, drifted);

    expect(outcome).toBe("failed");
    const { data: call } = await admin.from("tool_calls").select("status, error").eq("run_id", runId).single();
    expect(call).toMatchObject({ status: "failed", error: { code: "internal", retryable: false } });
    expect(await count("item_options", trip.tripId)).toBe(0);
    expect((await itemRows(trip.tripId)).map((i) => i.status)).toEqual(["tbd", "tbd", "tbd", "tbd"]);
    expect(await planCard(runId)).toBeNull();

    // applyPlan itself never prices an option it has no price for.
    const { data: run } = await admin
      .from("agent_runs")
      .insert({ trip_id: trip.tripId, trigger: "mention", status: "running", provider: "mock", model: "m", seed_batch: trip.batch })
      .select("id")
      .single();
    const request = requests[0]!;
    await expect(
      applyPlan({
        tripId: trip.tripId,
        actorMemberId: trip.member("person1"),
        runId: run!.id,
        toolCallId: "call-direct",
        mode: "initial",
        request,
        response: drifted(request),
        itemsBySlot: { morning: trip.item("morning"), lunch: trip.item("lunch"), afternoon: trip.item("afternoon") },
        reasoning: {},
      }),
    ).rejects.toMatchObject({ code: "internal", retryable: false });
  });

  it("apply_plan still rejects a non-member actor after the split changes", async () => {
    const trip = await seededTrip();
    const stranger = await createUser({ batch, displayName: "Person 9" });
    const elsewhere = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: stranger.userId }] });
    const { data: run } = await admin
      .from("agent_runs")
      .insert({ trip_id: trip.tripId, trigger: "mention", status: "running", provider: "mock", model: "m", seed_batch: trip.batch })
      .select("id")
      .single();
    const { data: park } = await admin.from("places").select("id").eq("provider", "seed").eq("provider_place_id", "piedmont-park").single();
    const toolCallId = `call_${randomUUID()}`;
    const siblingId = randomUUID();
    const payload = (overrides: { actor?: string; siblingOf?: string } = {}) => ({
      trip_id: trip.tripId,
      actor_member_id: overrides.actor ?? trip.member("person1"),
      run_id: run!.id,
      tool_call_id: toolCallId,
      mode: "initial",
      slots: [
        {
          item_id: siblingId,
          sibling_of: overrides.siblingOf ?? trip.item("afternoon"),
          member_ids: [trip.member("person2"), trip.member("person3")],
          options: [
            { id: randomUUID(), place_id: park!.id, rank: 1, price_cents: 0, score: 0.8, score_breakdown: {}, reasoning: "Free", source: "mock" },
          ],
        },
      ],
      card: { card_type: "plan" },
      result_summary: "test",
    });
    const sibling = async () => (await admin.from("itinerary_items").select("id").eq("id", siblingId)).data ?? [];

    const notMember = await admin.rpc("apply_plan", { payload: payload({ actor: elsewhere.memberIds[0] }) });
    expect(notMember.error?.message).toMatch(/not_permitted/);
    expect(await sibling()).toEqual([]);

    // A sibling of another trip's item is refused the same way.
    const { data: foreignItem } = await admin
      .from("itinerary_items")
      .insert({ trip_id: elsewhere.tripId, slot_key: "afternoon", label: "Afternoon", category: "activity", starts_at: "2026-10-03T18:15:00Z", ends_at: "2026-10-03T21:15:00Z", position: 1, seed_batch: batch })
      .select("id")
      .single();
    const foreign = await admin.rpc("apply_plan", { payload: payload({ siblingOf: foreignItem!.id }) });
    expect(foreign.error?.message).toMatch(/not_permitted/);
    expect(await sibling()).toEqual([]);
    expect(await count("item_options", trip.tripId)).toBe(0);

    // The same payload from a member, for this trip's item, creates the sibling.
    await admin.from("tool_calls").insert({ trip_id: trip.tripId, run_id: run!.id, tool_call_id: toolCallId, tool_name: "plan_day", input: {}, status: "started", seed_batch: trip.batch });
    const ok = await admin.rpc("apply_plan", { payload: payload() });
    expect(ok.error).toBeNull();
    expect(await sibling()).toHaveLength(1);
  });
});

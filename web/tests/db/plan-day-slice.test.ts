import { PlanCard } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAgentRun } from "@/lib/agent/runner";
import type { OptimizerClient, PlanRequest, PlanResponse } from "@/lib/optimizer/client";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { createPlanDayTool } from "@/lib/tools/plan-day/tool";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let tripId: string;
let memberIds: string[];
const items: Record<string, string> = {};
const places: Record<string, string> = {};

const slots = [
  { slot_key: "morning", label: "Morning", category: "activity", starts: "14:00", ends: "16:30", together: true },
  { slot_key: "lunch", label: "Lunch", category: "food", starts: "16:45", ends: "17:45", together: true },
  { slot_key: "afternoon", label: "Afternoon", category: "activity", starts: "18:15", ends: "21:15", together: false },
  { slot_key: "dinner", label: "Dinner", category: "food", starts: "23:00", ends: "23:59", together: true },
] as const;

beforeAll(async () => {
  const users = await Promise.all(["Person 1", "Person 2", "Person 3"].map((displayName) => createUser({ batch, displayName })));
  ({ tripId, memberIds } = await createTrip(batch, {
    title: "Saturday in Atlanta",
    members: [...users.map((u, i) => ({ displayName: `Person ${i + 1}`, profileId: u.userId })), { displayName: "Person 4" }],
  }));
  for (const [i, s] of slots.entries()) {
    const { data, error } = await admin
      .from("itinerary_items")
      .insert({
        trip_id: tripId,
        slot_key: s.slot_key,
        label: s.label,
        category: s.category,
        starts_at: `2026-10-03T${s.starts}:00Z`,
        ends_at: `2026-10-03T${s.ends}:00Z`,
        position: 1,
        together: s.together,
        seed_batch: batch,
        ...(i === 3 ? { area_label: "Midtown", area_lat: 33.7835, area_lng: -84.3834 } : {}),
      })
      .select("id")
      .single();
    if (error) throw error;
    items[s.slot_key] = data.id;
  }
  // Rated 5.0, so they lead the category in the shared cache; the price lives in the payload.
  const cache = [
    ["aquarium", "activity", 4200, ["animals"]],
    ["museum", "activity", 1850, ["art", "museums"]],
    ["cafe", "food", 1600, []],
    ["diner", "food", 2200, []],
  ] as const;
  for (const [name, category, price, tags] of cache) {
    places[name] = (
      await createPlace(batch, { name, category, rating: 5.0, tags, raw: { price_cents: price, duration_min: 90 } })
    ).placeId;
  }
  // A place with no known price is never a candidate.
  await createPlace(batch, { name: "unpriced", category: "activity", rating: 5.0 });
});

afterAll(() => cleanup(batch));

/** The optimizer stub's answer: everyone together, each slot's first two candidates as options. */
function everyoneTogether(request: PlanRequest): PlanResponse {
  const everyone = request.members.map((m) => m.id);
  return {
    request_id: request.request_id,
    engine: "enumeration",
    status: "feasible",
    solve_ms: 3,
    plans: [
      {
        rank: 1,
        total_score: 0.7,
        fairness: 0.6,
        split: false,
        member_scores: everyone.map((member_id) => ({ member_id, score: 0.7, preference: 0.5, cost: 0.3, travel: 0 })),
        assignments: request.slots.map((s) => ({ slot_key: s.key, groups: [{ place_id: s.candidates[0]!.place_id, member_ids: everyone }] })),
      },
    ],
    slot_options: request.slots.map((s) => ({
      slot_key: s.key,
      groups: [
        {
          member_ids: everyone,
          options: s.candidates.slice(0, 2).map((c, i) => ({
            place_id: c.place_id,
            rank: i + 1,
            score: 0.7 - i / 10,
            preference: 0.5,
            cost: 0.3,
            travel: 0,
            fairness: 0.6,
          })),
        },
      ],
    })),
    infeasible_reasons: [],
  };
}

function scriptedLlm(input: unknown): LlmProvider {
  return {
    name: "mock",
    async runAgent({ tools }) {
      const output = await tools.plan_day!.execute!(input, { toolCallId: "replay-1", messages: [], context: undefined });
      return { text: "Here's a plan for Saturday.", steps: [{ toolName: "plan_day", input, output }], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

describe("the plan_day slice", () => {
  it("plan_day moves the seeded items tbd → proposing → voting and writes one plan card", async () => {
    const { data: message } = await admin
      .from("messages")
      .insert({ trip_id: tripId, sender_type: "member", sender_member_id: memberIds[0], kind: "text", body: "@agent plan Saturday", seed_batch: batch })
      .select("id")
      .single();
    const { data: run } = await admin
      .from("agent_runs")
      .insert({ trip_id: tripId, trigger: "mention", trigger_message_id: message!.id, requester_member_id: memberIds[0], provider: "mock", model: "m", seed_batch: batch })
      .select("id")
      .single();
    const requests: PlanRequest[] = [];
    const optimizer: OptimizerClient = {
      plan: async (request) => {
        requests.push(request);
        return everyoneTogether(request);
      },
    };

    const outcome = await startAgentRun(run!.id, {
      llm: scriptedLlm({
        mode: "initial",
        constraint_updates: [
          { member_handle: "all", budget_cents: 8000 },
          { member_handle: "M2", dietary: ["vegetarian"] },
        ],
      }),
      tools: { plan_day: createPlanDayTool({ optimizer: () => optimizer }) },
      broadcast: async () => {},
    });

    expect(outcome).toBe("succeeded");

    // The earliest 3 open slots were planned; dinner stays a TBD block.
    const { data: rows } = await admin.from("itinerary_items").select("id, slot_key, status").eq("trip_id", tripId);
    expect(Object.fromEntries(rows!.map((r) => [r.slot_key, r.status]))).toEqual({
      morning: "voting",
      lunch: "voting",
      afternoon: "voting",
      dinner: "tbd",
    });

    // The request: every member with their saved constraints, candidates by category with their prices.
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.request_id).toBe("replay-1");
    expect(request!.slots.map((s) => s.key)).toEqual(["morning", "lunch", "afternoon"]);
    expect(request!.slots.map((s) => s.together)).toEqual([true, true, false]);
    expect(request!.slots.map((s) => s.category)).toEqual(["activity", "food", "activity"]);
    expect(request!.members).toHaveLength(4);
    expect(request!.members.every((m) => m.budget_cents === 8000)).toBe(true);
    expect(request!.members.find((m) => m.id === memberIds[1])!.dietary).toEqual(["vegetarian"]);
    const morning = request!.slots[0]!.candidates;
    expect(morning.map((c) => c.place_id)).toEqual(expect.arrayContaining([places.aquarium, places.museum]));
    expect(morning.find((c) => c.place_id === places.aquarium)).toMatchObject({ price_cents: 4200, tags: ["animals"], duration_min: 90 });
    expect(request!.slots.flatMap((s) => s.candidates).every((c) => Number.isInteger(c.price_cents))).toBe(true);
    expect(request!.slots[1]!.candidates.map((c) => c.place_id)).toEqual(expect.arrayContaining([places.cafe, places.diner]));

    // Constraints were saved before planning.
    const { data: constraints } = await admin.from("member_constraints").select("member_id, budget_cents, dietary").eq("trip_id", tripId);
    expect(constraints).toHaveLength(4);
    expect(constraints!.find((c) => c.member_id === memberIds[1])).toMatchObject({ budget_cents: 8000, dietary: ["vegetarian"] });

    // One plan card, valid against its schema, with the three planned slots.
    const { data: cards } = await admin.from("messages").select("card_payload").eq("agent_run_id", run!.id).eq("kind", "card");
    expect(cards).toHaveLength(1);
    const card = PlanCard.parse(cards![0]!.card_payload);
    expect(card.slots.map((s) => s.slot_key)).toEqual(["morning", "lunch", "afternoon"]);
    expect(card.slots[0]!.groups[0]!.options.find((o) => o.place_id === places.aquarium)?.price_cents).toBe(4200);

    const { data: calls } = await admin.from("tool_calls").select("status, message_id").eq("run_id", run!.id);
    expect(calls).toEqual([{ status: "succeeded", message_id: expect.any(String) }]);
  });
});

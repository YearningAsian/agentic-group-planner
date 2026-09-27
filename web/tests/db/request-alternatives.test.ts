import { PlanCard, type ToolResult } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { uuidFor } from "../../scripts/demo/lib/ids";
import { seed } from "../../scripts/demo/seed";
import { loadTripSnapshot } from "@/lib/agent/context";
import { assignHandles } from "@/lib/agent/handles";
import { startAgentRun } from "@/lib/agent/runner";
import type { OptimizerClient, PlanRequest } from "@/lib/optimizer/client";
import { mockPlan } from "@/lib/optimizer/mock";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { createPlanDayTool } from "@/lib/tools/plan-day/tool";
import { createUpdateItemTool } from "@/lib/tools/update-item/tool";
import { cleanup, adminClient, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
// A Saturday afternoon in New York, so the seeded trip is on 2026-10-03.
const now = new Date("2026-09-26T15:00:00Z");
const batches: string[] = [batch];

afterAll(async () => {
  for (const b of batches) await cleanup(b);
});

async function seededTrip() {
  const b = `${batch}:${batches.length}`;
  batches.push(b);
  const { tripId } = await seed({ batch: b, now });
  return { batch: b, tripId, member: (key: string) => uuidFor(b, `member:${key}`), item: (slot: string) => uuidFor(b, `item:${slot}`) };
}

type Trip = Awaited<ReturnType<typeof seededTrip>>;

/** Runs one tool call through the real runner for Person 1, with the optimizer double answering. */
async function run(trip: Trip, tool: "plan_day" | "update_item", input: unknown) {
  const { data: message, error } = await admin
    .from("messages")
    .insert({ trip_id: trip.tripId, sender_type: "member", sender_member_id: trip.member("person1"), kind: "text", body: "@agent", seed_batch: trip.batch })
    .select("id")
    .single();
  if (error) throw error;
  const { data: agentRun, error: runError } = await admin
    .from("agent_runs")
    .insert({ trip_id: trip.tripId, trigger: "mention", trigger_message_id: message.id, requester_member_id: trip.member("person1"), provider: "mock", model: "m", seed_batch: trip.batch })
    .select("id")
    .single();
  if (runError) throw runError;
  const requests: PlanRequest[] = [];
  const optimizer: OptimizerClient = {
    plan: async (request) => {
      requests.push(request);
      return mockPlan(request);
    },
  };
  const seen: { result?: ToolResult } = {};
  const llm: LlmProvider = {
    name: "mock",
    async runAgent({ tools }) {
      const output = (await tools[tool]!.execute!(input, { toolCallId: `call-${tool}`, messages: [], context: undefined })) as ToolResult;
      seen.result = output;
      return { text: "Done.", steps: [{ toolName: tool, input, output }], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
  const outcome = await startAgentRun(agentRun.id, {
    llm,
    tools: {
      plan_day: createPlanDayTool({ optimizer: () => optimizer }),
      update_item: createUpdateItemTool({ optimizer: () => optimizer }),
    },
    broadcast: async () => {},
  });
  return { outcome, result: seen.result, requests, runId: agentRun.id };
}

/** The handle the next run's context gives an item. */
async function handleFor(tripId: string, itemId: string): Promise<string> {
  return assignHandles(await loadTripSnapshot(admin, tripId)).byId[itemId]!;
}

async function offeredPlaces(itemId: string): Promise<string[]> {
  const { data, error } = await admin.from("item_options").select("place_id").eq("item_id", itemId);
  if (error) throw error;
  return data.map((o) => o.place_id);
}

describe("update_item request_alternatives", () => {
  it("re-plans one voting item with places it hasn't offered, and supersedes it", async () => {
    const trip = await seededTrip();
    expect((await run(trip, "plan_day", { mode: "initial" })).outcome).toBe("succeeded");
    const lunch = trip.item("lunch");
    const before = await offeredPlaces(lunch);
    expect(before.length).toBeGreaterThan(0);

    const { outcome, result, requests, runId } = await run(trip, "update_item", {
      action: "request_alternatives",
      item_handle: await handleFor(trip.tripId, lunch),
    });

    expect(outcome).toBe("succeeded");
    expect(result).toMatchObject({ ok: true });
    // Only lunch was planned, and none of its old places came back as candidates.
    const planned = requests[0]!.slots.filter((s) => !s.pinned);
    expect(planned.map((s) => s.key)).toEqual(["lunch"]);
    expect(planned[0]!.candidates.map((c) => c.place_id).filter((id) => before.includes(id))).toEqual([]);
    // The old lunch is history; its replacement points back to it and offers only new places.
    const { data: rows } = await admin
      .from("itinerary_items")
      .select("id, status, supersedes_item_id")
      .eq("trip_id", trip.tripId)
      .eq("slot_key", "lunch");
    expect(rows!.find((r) => r.id === lunch)!.status).toBe("superseded");
    const replacement = rows!.find((r) => r.supersedes_item_id === lunch)!;
    expect(replacement.status).toBe("voting");
    expect((await offeredPlaces(replacement.id)).filter((id) => before.includes(id))).toEqual([]);
    // The group sees the new options on a plan card in replan mode.
    const { data: cards } = await admin.from("messages").select("card_payload").eq("agent_run_id", runId).eq("card_type", "plan");
    const card = PlanCard.parse(cards![0]!.card_payload);
    expect(card.mode).toBe("replan");
    expect(card.changes?.map((c) => c.kind)).toContain("superseded");
  });

  it("the other slots keep their items and options", async () => {
    const trip = await seededTrip();
    await run(trip, "plan_day", { mode: "initial" });
    const morning = trip.item("morning");
    const morningBefore = await offeredPlaces(morning);

    await run(trip, "update_item", { action: "request_alternatives", item_handle: await handleFor(trip.tripId, trip.item("lunch")) });

    const { data } = await admin.from("itinerary_items").select("status").eq("id", morning).single();
    expect(data!.status).toBe("voting");
    expect((await offeredPlaces(morning)).sort()).toEqual([...morningBefore].sort());
  });
});

import { randomUUID } from "node:crypto";
import { ItineraryChangeCard } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAgentRun } from "@/lib/agent/runner";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let person1: TestUser;
let person2: TestUser;
const places: Record<string, string> = {};

beforeAll(async () => {
  [person1, person2] = await Promise.all(["Person 1", "Person 2"].map((displayName) => createUser({ batch, displayName })));
  for (const name of ["Georgia Aquarium", "High Museum", "Cafe", "Diner"]) places[name] = (await createPlace(batch, { name })).placeId;
});

afterAll(() => cleanup(batch));

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert({ ...row, seed_batch: batch }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/**
 * A fresh trip per test, so handles are stable: M1 Person 1 (organizer), M2 Person 2, M3 Person 4;
 * I1 Morning (voting: O1 aquarium, O2 museum), I2 Lunch (decided on O3 cafe), I3 Dinner (booked).
 */
async function setup() {
  const { tripId, memberIds } = await createTrip(batch, {
    title: "Saturday in Atlanta",
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
      { displayName: "Person 4" },
    ],
  });
  const item = (slot_key: string, label: string, category: string, starts: string, ends: string) =>
    insert("itinerary_items", {
      trip_id: tripId, slot_key, label, category, starts_at: `2026-10-03T${starts}:00Z`, ends_at: `2026-10-03T${ends}:00Z`, position: 1,
    });
  const option = (item_id: string, place: string, rank: number) =>
    insert("item_options", {
      trip_id: tripId, item_id, place_id: places[place], rank, price_cents: 4200, score: 0.8, score_breakdown: {}, source: "mock",
    });
  const morning = await item("morning", "Morning", "activity", "14:00", "16:30");
  const lunch = await item("lunch", "Lunch", "food", "16:45", "17:45");
  const dinner = await item("dinner", "Dinner", "food", "23:00", "23:59");
  const aquarium = await option(morning, "Georgia Aquarium", 1);
  await option(morning, "High Museum", 2);
  const cafe = await option(lunch, "Cafe", 1);
  for (const id of [morning, lunch]) {
    await admin.from("itinerary_items").update({ status: "proposing" }).eq("id", id);
    await admin.from("itinerary_items").update({ status: "voting" }).eq("id", id);
  }
  await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: cafe }).eq("id", lunch);
  await admin.from("itinerary_items").update({ status: "booked" }).eq("id", dinner);
  for (const item_id of [morning, lunch, dinner]) {
    for (const member_id of memberIds) await admin.from("item_attendees").insert({ item_id, member_id, trip_id: tripId, seed_batch: batch });
  }
  return { tripId, memberIds, morning, lunch, dinner, aquarium, cafe };
}

function scriptedLlm(input: unknown): LlmProvider {
  return {
    name: "mock",
    async runAgent({ tools }) {
      const output = await tools.update_item!.execute!(input, { toolCallId: "replay-1", messages: [], context: undefined });
      return { text: "Done.", steps: [{ toolName: "update_item", input, output }], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

async function runAs(tripId: string, requester: string, input: unknown) {
  const { data: message } = await admin
    .from("messages")
    .insert({ trip_id: tripId, sender_type: "member", sender_member_id: requester, kind: "text", body: "@agent change it", seed_batch: batch })
    .select("id")
    .single();
  const { data: run } = await admin
    .from("agent_runs")
    .insert({ trip_id: tripId, trigger: "mention", trigger_message_id: message!.id, requester_member_id: requester, provider: "mock", model: "m", seed_batch: batch })
    .select("id")
    .single();
  const outcome = await startAgentRun(run!.id, { llm: scriptedLlm(input), broadcast: async () => {} });
  const { data: cards } = await admin.from("messages").select("card_payload").eq("agent_run_id", run!.id).eq("card_type", "itinerary_change");
  const { data: calls } = await admin.from("tool_calls").select("status, output").eq("run_id", run!.id);
  const output = calls![0]!.output as { ok: boolean; summary: string; error?: { code: string; message: string }; handles?: Record<string, string> };
  return { outcome, cards: cards!.map((c) => ItineraryChangeCard.parse(c.card_payload)), output, runId: run!.id };
}

async function itemRow(id: string) {
  const { data } = await admin.from("itinerary_items").select("status, chosen_option_id").eq("id", id).single();
  return data!;
}

describe("update_item", () => {
  it('swap_option by a non-organizer returns not_permitted with "discuss it in the comments"', async () => {
    const { tripId, memberIds, morning } = await setup();
    const { cards, output } = await runAs(tripId, memberIds[1]!, { action: "swap_option", item_handle: "I1", option_handle: "O2" });

    expect(output.ok).toBe(false);
    expect(output.error).toMatchObject({ code: "not_permitted", message: expect.stringContaining("discuss it in the comments") });
    expect(cards).toEqual([]);
    expect(await itemRow(morning)).toEqual({ status: "voting", chosen_option_id: null });
  });

  it("swap_option by the organizer locks the item to decided", async () => {
    const { tripId, memberIds, morning } = await setup();
    const { data: museum } = await admin.from("item_options").select("id").eq("item_id", morning).eq("rank", 2).single();
    const { outcome, cards, output } = await runAs(tripId, memberIds[0]!, { action: "swap_option", item_handle: "I1", option_handle: "O2" });

    expect(outcome).toBe("succeeded");
    expect(output).toMatchObject({ ok: true, summary: expect.stringContaining("High Museum") });
    expect(await itemRow(morning)).toEqual({ status: "decided", chosen_option_id: museum!.id });
    expect(cards).toEqual([
      {
        card_type: "itinerary_change",
        requested_by_member_id: memberIds[0],
        changes: [{ item_id: morning, label: "Morning", action: "swap_option", summary: "Morning is locked to High Museum." }],
      },
    ]);
  });

  it("mark_tbd on a decided item supersedes it", async () => {
    const { tripId, memberIds, lunch } = await setup();
    const { cards, output } = await runAs(tripId, memberIds[1]!, { action: "mark_tbd", item_handle: "I2" });

    expect(output.ok).toBe(true);
    expect(await itemRow(lunch)).toEqual({ status: "superseded", chosen_option_id: expect.any(String) });
    const { data: replacement } = await admin
      .from("itinerary_items")
      .select("id, slot_key, label, status, starts_at, supersedes_item_id, chosen_option_id")
      .eq("supersedes_item_id", lunch)
      .single();
    expect(replacement).toMatchObject({ slot_key: "lunch", label: "Lunch", status: "tbd", chosen_option_id: null, starts_at: "2026-10-03T16:45:00+00:00" });
    // The replacement keeps the lane: the same attendees.
    const { count } = await admin.from("item_attendees").select("*", { count: "exact", head: true }).eq("item_id", replacement!.id);
    expect(count).toBe(3);
    expect(cards[0]!.changes).toEqual([{ item_id: replacement!.id, label: "Lunch", action: "mark_tbd", summary: "Lunch is TBD again; Cafe was dropped." }]);
    // The new item gets the next handle, which the model can use in its next call.
    expect(output.handles).toEqual({ I4: "Lunch (TBD)" });
    expect(output.summary).toContain("The new item is I4.");
  });

  it("add_slot with an area creates a TBD block with a provisional stop", async () => {
    const { tripId, memberIds } = await setup();
    const slot = {
      slot_key: "dessert",
      label: "Dessert",
      category: "dessert",
      starts_at: "2026-10-04T00:15:00Z",
      ends_at: "2026-10-04T01:00:00Z",
      together: true,
      area: { label: "Midtown", lat: 33.7835, lng: -84.3834 },
    };
    const { cards, output } = await runAs(tripId, memberIds[1]!, { action: "add_slot", slot });

    expect(output.ok).toBe(true);
    const { data: added } = await admin
      .from("itinerary_items")
      .select("id, status, label, together, area_label, area_lat, area_lng, created_by_run_id")
      .eq("trip_id", tripId)
      .eq("slot_key", "dessert")
      .single();
    expect(added).toMatchObject({ status: "tbd", label: "Dessert", together: true, area_label: "Midtown", area_lat: 33.7835, area_lng: -84.3834 });
    const { count } = await admin.from("item_attendees").select("*", { count: "exact", head: true }).eq("item_id", added!.id);
    expect(count).toBe(3);
    expect(cards[0]!.changes).toEqual([
      { item_id: added!.id, label: "Dessert", action: "add_slot", summary: "Added Dessert, 20:15–21:00 near Midtown, to be decided." },
    ]);
  });

  it("every action on a booked item returns not_permitted", async () => {
    const { tripId, memberIds, dinner } = await setup();
    const actions = [
      { action: "mark_tbd", item_handle: "I3" },
      { action: "swap_option", item_handle: "I3", option_handle: "O1" },
      { action: "set_attendees", item_handle: "I3", member_handles: ["M1"] },
      { action: "request_alternatives", item_handle: "I3" },
    ];
    for (const input of actions) {
      const { cards, output } = await runAs(tripId, memberIds[0]!, input);
      expect(output.error?.code, input.action).toBe("not_permitted");
      expect(cards).toEqual([]);
    }
    expect((await itemRow(dinner)).status).toBe("booked");
    const { count } = await admin.from("item_attendees").select("*", { count: "exact", head: true }).eq("item_id", dinner);
    expect(count).toBe(3);
  });

  it("apply_item_change rejects a non-member actor with not_permitted", async () => {
    const { tripId, morning } = await setup();
    const other = await setup();
    const { data: run } = await admin
      .from("agent_runs")
      .insert({ trip_id: tripId, trigger: "mention", provider: "mock", model: "m", seed_batch: batch })
      .select("id")
      .single();
    await admin.from("tool_calls").insert({ trip_id: tripId, run_id: run!.id, tool_call_id: "call-1", tool_name: "update_item", input: {}, status: "started" });

    const { error } = await admin.rpc("apply_item_change", {
      payload: {
        trip_id: tripId,
        // A joined member, but of another trip.
        actor_member_id: other.memberIds[0],
        run_id: run!.id,
        tool_call_id: "call-1",
        action: "mark_tbd",
        item_id: morning,
        new_item_id: randomUUID(),
        card: { card_type: "itinerary_change", requested_by_member_id: other.memberIds[0], changes: [] },
        result_summary: "x",
      },
    });
    expect(error?.message).toMatch(/^not_permitted:/);
    expect((await itemRow(morning)).status).toBe("voting");
  });
});

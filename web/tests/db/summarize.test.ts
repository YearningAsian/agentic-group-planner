import { randomUUID } from "node:crypto";
import { SummaryCard } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startAgentRun } from "@/lib/agent/runner";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { createSummarizeTool } from "@/lib/tools/summarize/tool";
import { adminClient, cleanup, createPlace, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let tripId: string;
let memberIds: string[];
let morning: string;
let lunch: string;

async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await adminClient().from(table).insert({ ...row, seed_batch: batch }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  const users = await Promise.all(["Person 1", "Person 2"].map((displayName) => createUser({ batch, displayName })));
  ({ tripId, memberIds } = await createTrip(batch, {
    title: "Saturday in Atlanta",
    members: [...users.map((u, i) => ({ displayName: `Person ${i + 1}`, profileId: u.userId })), { displayName: "Person 4" }],
  }));
  const [p1, p2, p4] = memberIds as [string, string, string];
  const { placeId } = await createPlace(batch, { name: "Georgia Aquarium" });
  morning = await insert("itinerary_items", {
    trip_id: tripId, slot_key: "morning", label: "Morning", category: "activity",
    starts_at: "2026-10-03T14:00:00Z", ends_at: "2026-10-03T16:30:00Z", position: 1, status: "proposing",
  });
  const option = await insert("item_options", {
    trip_id: tripId, item_id: morning, place_id: placeId, rank: 1, price_cents: 4200, score: 0.9, score_breakdown: {}, source: "mock",
  });
  await admin.from("itinerary_items").update({ status: "voting" }).eq("id", morning);
  await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: option }).eq("id", morning);
  lunch = await insert("itinerary_items", {
    trip_id: tripId, slot_key: "lunch", label: "Lunch", category: "food",
    starts_at: "2026-10-03T16:45:00Z", ends_at: "2026-10-03T17:45:00Z", position: 1,
  });
  for (const item_id of [morning, lunch]) {
    for (const member_id of memberIds) await admin.from("item_attendees").insert({ item_id, member_id, trip_id: tripId, seed_batch: batch });
  }

  // The morning's tickets: Person 1 approved, Person 2 hasn't, and Person 1 fronts Person 4.
  const mandate = await insert("mandates", {
    trip_id: tripId, item_id: morning, option_id: option, merchant: "Demo Tickets (mock merchant)", title: "Georgia Aquarium · 3 tickets",
    quote_id: "q-1", quote_cents: 12_600, cap_cents: 14_400, currency: "usd", expires_at: "2026-10-03T00:00:00Z",
    idempotency_key: `mandate:${randomUUID()}`,
  });
  const hold = (payer: string | null, share: string, kind: "own" | "fronted", status: string) =>
    insert("payment_holds", {
      trip_id: tripId, mandate_id: mandate, payer_member_id: payer, share_member_id: share, kind,
      share_cents: 4200, cap_cents: 4800, status, idempotency_key: `share:${mandate}:${share}:${kind}`,
    });
  await hold(p1, p1, "own", "authorized");
  await hold(p2, p2, "own", "pending");
  await hold(null, p4, "own", "awaiting_member");
  await hold(p1, p4, "fronted", "authorized");
});

afterAll(() => cleanup(batch));

function scriptedLlm(input: unknown): LlmProvider {
  return {
    name: "mock",
    async runAgent({ tools }) {
      const output = await tools.summarize!.execute!(input, { toolCallId: "replay-1", messages: [], context: undefined });
      return { text: "Here's where things stand.", steps: [{ toolName: "summarize", input, output }], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

async function runAs(requester: string, input: unknown) {
  const { data: message } = await admin
    .from("messages")
    .insert({ trip_id: tripId, sender_type: "member", sender_member_id: requester, kind: "text", body: "@agent where are we?", seed_batch: batch })
    .select("id")
    .single();
  const { data: run } = await admin
    .from("agent_runs")
    .insert({ trip_id: tripId, trigger: "mention", trigger_message_id: message!.id, requester_member_id: requester, provider: "mock", model: "m", seed_batch: batch })
    .select("id")
    .single();
  const outcome = await startAgentRun(run!.id, {
    llm: scriptedLlm(input),
    tools: { summarize: createSummarizeTool({ now: () => new Date("2026-10-03T12:00:00Z") }) },
    broadcast: async () => {},
  });
  const { data: cards } = await admin.from("messages").select("card_payload").eq("agent_run_id", run!.id).eq("kind", "card");
  const { data: calls } = await admin.from("tool_calls").select("status, output, message_id").eq("run_id", run!.id);
  return { outcome, cards: cards!, calls: calls! };
}

describe("summarize", () => {
  it("posts one summary card whose numbers come from the database", async () => {
    const [p1, p2, p4] = memberIds as [string, string, string];
    const { outcome, cards, calls } = await runAs(p2, { scope: "full" });

    expect(outcome).toBe("succeeded");
    expect(cards).toHaveLength(1);
    const card = SummaryCard.parse(cards[0]!.card_payload);
    expect(card.timeline.map((t) => [t.item_id, t.place_name])).toEqual([
      [morning, "Georgia Aquarium"],
      [lunch, null],
    ]);
    expect(card.money).toEqual({
      committed_cents: 8400,
      per_member: [
        { member_id: p1, share_cents: 4200, status: "authorized" },
        { member_id: p2, share_cents: 4200, status: "pending" },
        { member_id: p4, share_cents: 4200, status: "fronted" },
      ],
    });
    expect(card.open_items.map((i) => i.item_id)).toEqual([lunch]);
    expect(calls).toEqual([
      { status: "succeeded", output: expect.objectContaining({ ok: true, card_message_id: expect.any(String) }), message_id: expect.any(String) },
    ]);
    expect((calls[0]!.output as { summary: string }).summary).toContain("$84 committed of $126 in shares.");
  });

  it("a personal summary defaults to the requester, and an unknown member handle is correctable", async () => {
    const [, p2] = memberIds as [string, string, string];
    const mine = await runAs(p2, { scope: "personal" });
    const card = SummaryCard.parse(mine.cards[0]!.card_payload);
    expect(card.member_id).toBe(p2);
    expect(card.money.per_member).toEqual([{ member_id: p2, share_cents: 4200, status: "pending" }]);

    const unknown = await runAs(p2, { scope: "personal", member_handle: "M9" });
    expect(unknown.cards).toHaveLength(0);
    expect(unknown.calls).toEqual([expect.objectContaining({ status: "failed", output: expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "unknown_handle" }) }) })]);
  });
});

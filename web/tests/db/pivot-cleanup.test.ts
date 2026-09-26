import { randomUUID } from "node:crypto";
import { BookingProvider, CardType, RunTrigger, ToolName, WebhookProvider } from "@agp/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

// The journey pivot (design §11.6) dropped voting, restaurant calls, and recaps. The schema keeps
// only the tables in design §3.2, and each narrowed CHECK accepts exactly the @agp/shared enum.
const batch = testBatch();
const admin = adminClient();
let tripId: string;
let runId: string;
let itemId: string;

async function insertId(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(table).insert({ ...row, seed_batch: batch }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  const person1 = await createUser({ batch, displayName: "Person 1" });
  ({ tripId } = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: person1.userId }] }));
  runId = await insertId("agent_runs", { trip_id: tripId, trigger: "mention", provider: "mock", model: "muse-spark-1.3" });
  itemId = await insertId("itinerary_items", {
    trip_id: tripId,
    slot_key: "morning",
    label: "Morning",
    category: "activity",
    starts_at: "2026-09-26T14:00:00Z",
    ends_at: "2026-09-26T16:30:00Z",
    position: 1,
  });
});

afterAll(async () => {
  // webhook_events has no trip, so the trip cascade doesn't reach it.
  await admin.from("webhook_events").delete().eq("seed_batch", batch);
  await cleanup(batch);
});

/** One insert per value into a narrowed column: the CHECK's error code, or null when it passed. */
const rows: Record<string, (value: string) => [table: string, row: Record<string, unknown>]> = {
  agent_runs: (trigger) => ["agent_runs", { trip_id: tripId, trigger, status: "failed", provider: "mock", model: "m" }],
  messages: (card_type) => ["messages", { trip_id: tripId, sender_type: "agent", kind: "card", card_type, card_payload: {} }],
  tool_calls: (tool_name) => [
    "tool_calls",
    { trip_id: tripId, run_id: runId, tool_call_id: randomUUID(), tool_name, status: "started", input: {} },
  ],
  bookings: (provider) => [
    "bookings",
    { trip_id: tripId, item_id: itemId, provider, currency: "usd", payer: "split", details: {}, idempotency_key: randomUUID() },
  ],
  webhook_events: (provider) => [
    "webhook_events",
    { provider, event_id: `evt_${randomUUID()}`, type: "test.event", received_at: new Date().toISOString() },
  ],
};

async function checkCode(column: keyof typeof rows, value: string): Promise<string | null> {
  const [table, row] = rows[column](value);
  const { error } = await admin.from(table).insert({ ...row, seed_batch: batch });
  return error?.code ?? null;
}

const narrowed: [keyof typeof rows, readonly string[], string[]][] = [
  ["agent_runs", RunTrigger.options, ["call_completed"]],
  ["messages", CardType.options, ["call_status", "recap"]],
  ["tool_calls", ToolName.options, ["call_restaurant", "generate_recap"]],
  ["bookings", BookingProvider.options, ["voice_reservation"]],
  ["webhook_events", WebhookProvider.options, ["elevenlabs", "elevenlabs_tool"]],
];

describe("journey pivot cleanup", () => {
  it("the votes and calls tables are gone", async () => {
    for (const table of ["votes", "calls"]) {
      const { error } = await admin.from(table).select("id").limit(1);
      expect(error?.code, table).toBe("PGRST205");
    }
  });

  it("agent_runs has no trigger_call_id, and bookings has no call_id", async () => {
    expect((await admin.from("agent_runs").select("trigger_call_id").limit(1)).error?.code).toBe("42703");
    expect((await admin.from("bookings").select("call_id").limit(1)).error?.code).toBe("42703");
  });

  it("rejects the dropped tool names, card types, run trigger, and providers", async () => {
    for (const [column, , dropped] of narrowed) {
      for (const value of dropped) expect(await checkCode(column, value), `${column}: ${value}`).toBe("23514");
    }
  });

  it("accepts every value of the matching @agp/shared enum", async () => {
    for (const [column, values] of narrowed) {
      for (const value of values) expect(await checkCode(column, value), `${column}: ${value}`).toBeNull();
    }
  });
});

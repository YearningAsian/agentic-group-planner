import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

// The journey pivot (design §11.6) dropped voting, restaurant calls, and recaps. The schema keeps
// only the tables in design §3.2, and every enum CHECK lists exactly the design §3.1 values.
const batch = testBatch();
const admin = adminClient();
let tripId: string;
let runId: string;

beforeAll(async () => {
  const person1 = await createUser({ batch, displayName: "Person 1" });
  ({ tripId } = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: person1.userId }] }));
  const run = await admin
    .from("agent_runs")
    .insert({ trip_id: tripId, trigger: "mention", provider: "mock", model: "muse-spark-1.3", seed_batch: batch })
    .select("id")
    .single();
  if (run.error) throw run.error;
  runId = run.data.id as string;
});

afterAll(() => cleanup(batch));

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

  it("rejects the dropped tool name, card types, run trigger, and providers", async () => {
    const toolCall = { trip_id: tripId, run_id: runId, status: "started", input: {}, seed_batch: batch };
    for (const tool_name of ["call_restaurant", "generate_recap"]) {
      const { error } = await admin.from("tool_calls").insert({ ...toolCall, tool_name, tool_call_id: randomUUID() });
      expect(error?.code, tool_name).toBe("23514");
    }

    const card = { trip_id: tripId, sender_type: "agent", kind: "card", card_payload: {}, seed_batch: batch };
    for (const card_type of ["call_status", "recap"]) {
      expect((await admin.from("messages").insert({ ...card, card_type })).error?.code, card_type).toBe("23514");
    }

    const run = { trip_id: tripId, provider: "mock", model: "muse-spark-1.3", seed_batch: batch };
    expect((await admin.from("agent_runs").insert({ ...run, trigger: "call_completed" })).error?.code).toBe("23514");

    const event = { event_id: `evt_${randomUUID()}`, type: "call.ended", received_at: new Date().toISOString() };
    for (const provider of ["elevenlabs", "elevenlabs_tool"]) {
      expect((await admin.from("webhook_events").insert({ ...event, provider })).error?.code, provider).toBe("23514");
    }
  });

  it("still accepts every design §3.1 value for those columns", async () => {
    const toolCall = { trip_id: tripId, run_id: runId, status: "started", input: {}, seed_batch: batch };
    const { error } = await admin.from("tool_calls").insert({ ...toolCall, tool_name: "propose_purchase", tool_call_id: randomUUID() });
    expect(error).toBeNull();
    const card = { trip_id: tripId, sender_type: "agent", kind: "card", card_payload: {}, seed_batch: batch };
    expect((await admin.from("messages").insert({ ...card, card_type: "member_joined" })).error).toBeNull();
  });
});

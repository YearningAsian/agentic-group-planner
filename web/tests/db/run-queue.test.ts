import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunnerDeps, startAgentRun } from "@/lib/agent/runner";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let requesterId: string;
let profileId: string;

beforeAll(async () => {
  profileId = (await createUser({ batch, displayName: "Person 1" })).userId;
});

afterAll(() => cleanup(batch));

/** Each test gets its own trip, so one test's running run never blocks another's claim. */
async function newTrip(): Promise<string> {
  const trip = await createTrip(batch, { members: [{ displayName: "Person 1", profileId }] });
  requesterId = trip.memberIds[0]!;
  return trip.tripId;
}

async function insertRun(tripId: string, fields: Partial<Database["public"]["Tables"]["agent_runs"]["Insert"]> = {}) {
  const { data: message, error } = await admin
    .from("messages")
    .insert({ trip_id: tripId, sender_type: "member", sender_member_id: requesterId, kind: "text", body: "@agent hi", seed_batch: batch })
    .select("id")
    .single();
  if (error) throw error;
  const { data, error: runError } = await admin
    .from("agent_runs")
    .insert({
      trip_id: tripId,
      trigger: "mention",
      trigger_message_id: message.id,
      requester_member_id: requesterId,
      provider: "mock",
      model: "muse-spark-1.3",
      seed_batch: batch,
      ...fields,
    })
    .select("id")
    .single();
  if (runError) throw runError;
  return data.id;
}

async function run(id: string) {
  const { data, error } = await admin.from("agent_runs").select("status, error").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function cards(id: string) {
  const { data } = await admin.from("messages").select("card_type, card_payload").eq("agent_run_id", id);
  return data ?? [];
}

/** A model that answers at once, or waits for `gate` first. */
function llm(gate?: Promise<void>): LlmProvider {
  return {
    name: "mock",
    async runAgent() {
      await gate;
      return { text: "Done.", steps: [], usage: null, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

const deps = (model: LlmProvider): Partial<RunnerDeps> => ({ llm: model, tools: {}, broadcast: async () => {} });

describe("run queue", () => {
  it("a run started while another is running stays queued, then runs when the first finishes", async () => {
    const tripId = await newTrip();
    const first = await insertRun(tripId);
    const second = await insertRun(tripId);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));

    const firstRun = startAgentRun(first, deps(llm(gate)));
    await expect.poll(async () => (await run(first)).status).toBe("running");

    expect(await startAgentRun(second, deps(llm()))).toBeNull();
    expect((await run(second)).status).toBe("queued");

    open();
    expect(await firstRun).toBe("succeeded");
    // Finishing the first run started the trip's oldest queued run.
    expect((await run(second)).status).toBe("succeeded");
  });

  it("a running run with an expired lease is marked failed by the next claimant", async () => {
    const tripId = await newTrip();
    const crashed = await insertRun(tripId, {
      status: "running",
      started_at: new Date(Date.now() - 200_000).toISOString(),
      lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    const next = await insertRun(tripId);

    expect(await startAgentRun(next, deps(llm()))).toBe("succeeded");

    expect(await run(crashed)).toMatchObject({ status: "failed", error: { code: "timeout" } });
    expect(await cards(crashed)).toEqual([
      { card_type: "error", card_payload: expect.objectContaining({ code: "timeout", retryable: true }) },
    ]);
  });

  it("a queued run older than 5 minutes is failed, not started", async () => {
    const tripId = await newTrip();
    const stale = await insertRun(tripId, { created_at: new Date(Date.now() - 6 * 60_000).toISOString() });

    expect(await startAgentRun(stale, deps(llm()))).toBeNull();

    expect(await run(stale)).toMatchObject({ status: "failed", error: { code: "timeout" } });
    expect(await cards(stale)).toEqual([
      { card_type: "error", card_payload: expect.objectContaining({ code: "timeout", retryable: true }) },
    ]);
  });

  it("a live lease is left alone", async () => {
    const tripId = await newTrip();
    const busy = await insertRun(tripId, {
      status: "running",
      started_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const waiting = await insertRun(tripId);

    expect(await startAgentRun(waiting, deps(llm()))).toBeNull();
    expect((await run(busy)).status).toBe("running");
    expect((await run(waiting)).status).toBe("queued");
    await admin.from("agent_runs").update({ status: "failed" }).in("id", [busy, waiting]);
  });
});

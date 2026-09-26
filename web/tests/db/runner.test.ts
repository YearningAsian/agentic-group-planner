import path from "node:path";
import { type AgentStatusEvent, PlanDayInput, type ToolName, type ToolResult } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveHandle } from "@/lib/agent/handles";
import { claimRun, type RunnerDeps, startAgentRun } from "@/lib/agent/runner";
import { runTool } from "@/lib/agent/run-tool";
import { createMockLlmProvider } from "@/lib/providers/llm/mock";
import type { LlmProvider } from "@/lib/providers/llm/types";
import { defineTool, type RunContext, type ToolDefinition } from "@/lib/tools/define-tool";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let tripId: string;
let memberIds: string[];

beforeAll(async () => {
  const person1 = await createUser({ batch, displayName: "Person 1" });
  const person2 = await createUser({ batch, displayName: "Person 2" });
  ({ tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: person1.userId },
      { displayName: "Person 2", profileId: person2.userId },
      { displayName: "Person 4" },
    ],
  }));
});

afterAll(() => cleanup(batch));

/** A member's @agent message and the queued run it starts, as sendMessage writes them. */
async function queuedRun(body = "@agent plan Saturday", trip = tripId, requester = memberIds[1]!) {
  const { data: message, error } = await admin
    .from("messages")
    .insert({ trip_id: trip, sender_type: "member", sender_member_id: requester, kind: "text", body, mentions_agent: true, seed_batch: batch })
    .select("id")
    .single();
  if (error) throw error;
  const { data: run, error: runError } = await admin
    .from("agent_runs")
    .insert({
      trip_id: trip,
      trigger: "mention",
      trigger_message_id: message.id,
      requester_member_id: requester,
      provider: "mock",
      model: "muse-spark-1.3",
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (runError) throw runError;
  return { runId: run.id, messageId: message.id };
}

async function runRow(runId: string) {
  const { data, error } = await admin.from("agent_runs").select("*").eq("id", runId).single();
  if (error) throw error;
  return data;
}

async function runMessages(runId: string) {
  const { data, error } = await admin.from("messages").select("*").eq("agent_run_id", runId);
  if (error) throw error;
  return data;
}

const ok = (summary: string): ToolResult => ({ ok: true, summary });

/** A plan_day stand-in whose handler the test controls. */
function planDay(handler: (input: PlanDayInput, ctx: RunContext) => Promise<ToolResult>): ToolDefinition {
  return defineTool({ name: "plan_day", description: "Plan the day (test stand-in).", input: PlanDayInput, handler }) as ToolDefinition;
}

/** A model that calls the given tools in order, then answers with `text`. */
function scriptedLlm(steps: { toolName: ToolName; input: unknown }[], text: string): LlmProvider {
  return {
    name: "mock",
    async runAgent({ tools }) {
      const done = [];
      for (const [i, step] of steps.entries()) {
        const output = await tools[step.toolName]!.execute!(step.input, {
          toolCallId: `call-${i + 1}`,
          messages: [],
          context: undefined,
        });
        done.push({ ...step, output });
      }
      return { text, steps: done, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, provider: "mock", replayed: true };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

function deps(overrides: Partial<RunnerDeps>): Partial<RunnerDeps> {
  return { broadcast: async () => {}, ...overrides };
}

describe("agent runner", () => {
  it("a queued run is claimed once; a second claim for the same trip returns null while it's running", async () => {
    const first = await queuedRun();
    const second = await queuedRun();

    const claimed = await claimRun(admin, first.runId);
    expect(claimed).toMatchObject({ id: first.runId, status: "running" });
    expect(Date.parse(claimed!.lease_expires_at!)).toBeGreaterThan(Date.now() + 100_000);
    expect(await claimRun(admin, first.runId)).toBeNull();
    expect(await claimRun(admin, second.runId)).toBeNull();
    expect((await runRow(second.runId)).status).toBe("queued");

    // Fail both, so later tests on this trip can claim.
    await admin.from("agent_runs").update({ status: "failed" }).in("id", [first.runId, second.runId]);
    expect(await claimRun(admin, second.runId)).toBeNull();
  });

  it("a succeeded tool_calls row is returned without calling the handler again", async () => {
    const { runId } = await queuedRun();
    await claimRun(admin, runId);
    const handler = vi.fn<(input: PlanDayInput, ctx: RunContext) => Promise<ToolResult>>(async () => ok("Planned the morning."));
    const tool = planDay(handler);
    const ctx: RunContext = { tripId, runId, toolCallId: "call-1", requesterMemberId: memberIds[1]!, handles: {}, admin };

    const first = await runTool(ctx, tool, { mode: "initial" });
    const second = await runTool(ctx, tool, { mode: "initial" });

    expect(handler).toHaveBeenCalledTimes(1);
    // The handler saw the parsed input, defaults applied.
    expect(handler.mock.calls[0]![0]).toMatchObject({ mode: "initial", options_per_slot: 3 });
    expect(second).toEqual(first);
    const { data: calls } = await admin.from("tool_calls").select("status, output, tool_name").eq("run_id", runId);
    expect(calls).toEqual([{ status: "succeeded", output: first, tool_name: "plan_day" }]);
    await admin.from("agent_runs").update({ status: "failed" }).eq("id", runId);
  });

  it("a handler that throws writes one error card and marks the run failed", async () => {
    const { runId, messageId } = await queuedRun();
    const tool = planDay(async () => {
      throw new Error("the optimizer exploded");
    });

    const outcome = await startAgentRun(
      runId,
      deps({ llm: scriptedLlm([{ toolName: "plan_day", input: { mode: "initial" } }], "never"), tools: { plan_day: tool } }),
    );

    expect(outcome).toBe("failed");
    const run = await runRow(runId);
    expect(run).toMatchObject({ status: "failed", lease_expires_at: null });
    expect(run.error).toMatchObject({ code: "internal", tool: "plan_day" });
    const messages = await runMessages(runId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ sender_type: "agent", kind: "card", card_type: "error", reply_to_message_id: messageId });
    // The card never shows the raw error text.
    expect(messages[0]!.card_payload).toEqual({
      card_type: "error",
      code: "internal",
      message: "Something went wrong.",
      tool: "plan_day",
      retryable: true,
      retry_message_id: messageId,
    });
    const { data: calls } = await admin.from("tool_calls").select("status").eq("run_id", runId);
    expect(calls).toEqual([{ status: "failed" }]);
  });

  it("a successful run ends succeeded with exactly one agent text message", async () => {
    const { runId, messageId } = await queuedRun();
    const broadcasts: AgentStatusEvent[] = [];

    const outcome = await startAgentRun(
      runId,
      deps({
        llm: scriptedLlm([{ toolName: "plan_day", input: { mode: "initial" } }], "Here's a plan for Saturday."),
        tools: { plan_day: planDay(async () => ok("Planned 3 slots.")) },
        broadcast: async (_trip, event) => {
          broadcasts.push(event);
        },
      }),
    );

    expect(outcome).toBe("succeeded");
    const run = await runRow(runId);
    expect(run).toMatchObject({ status: "succeeded", step_count: 1, replayed: true, lease_expires_at: null, error: null });
    expect(run.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(run.handles).toMatchObject({ M1: memberIds[0], M2: memberIds[1], M3: memberIds[2] });
    const messages = await runMessages(runId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sender_type: "agent",
      kind: "text",
      body: "Here's a plan for Saturday.",
      reply_to_message_id: messageId,
    });
    expect(broadcasts.map((e) => [e.state, e.step, e.tool])).toEqual([
      ["started", 0, undefined],
      ["tool", 1, "plan_day"],
      ["done", 1, undefined],
    ]);
    expect(broadcasts.every((e) => e.run_id === runId)).toBe(true);
  });

  it('a final text that makes the agent the payer is replaced with "I proposed it. Each of you approves your own share."', async () => {
    const { runId } = await queuedRun();

    await startAgentRun(runId, deps({ llm: scriptedLlm([], "Done! I paid for the aquarium tickets.") }));

    const messages = await runMessages(runId);
    expect(messages.map((m) => m.body)).toEqual(["I proposed it. Each of you approves your own share."]);
  });

  it("an unknown handle goes back to the model instead of ending the run", async () => {
    const { runId } = await queuedRun();
    const tool = planDay(async (input, ctx) => {
      resolveHandle(ctx.handles, input.item_handles?.[0] ?? "", "I");
      return ok("unreachable");
    });

    const outcome = await startAgentRun(
      runId,
      deps({
        llm: scriptedLlm([{ toolName: "plan_day", input: { mode: "initial", item_handles: ["I9"] } }], "Which slot did you mean?"),
        tools: { plan_day: tool },
      }),
    );

    expect(outcome).toBe("succeeded");
    const { data: calls } = await admin.from("tool_calls").select("status, output").eq("run_id", runId);
    expect(calls).toEqual([
      { status: "failed", output: expect.objectContaining({ ok: false, error: expect.objectContaining({ code: "unknown_handle" }) }) },
    ]);
  });

  it("replays the recorded plan prompt through the mock LLM", async () => {
    const { runId } = await queuedRun("@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later.");
    const handler = vi.fn<(input: PlanDayInput, ctx: RunContext) => Promise<ToolResult>>(async () => ok("Planned 3 slots."));
    const llm = createMockLlmProvider({
      recordingsDir: path.resolve(__dirname, "../../scripts/demo/fixtures/agent-recordings"),
      delayMs: [0, 0],
    });

    expect(await startAgentRun(runId, deps({ llm, tools: { plan_day: planDay(handler) } }))).toBe("succeeded");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toMatchObject({
      mode: "initial",
      constraint_updates: [
        { member_handle: "all", budget_cents: 8000 },
        { member_handle: "M2", dietary: ["vegetarian"] },
      ],
    });
    expect((await runRow(runId)).replayed).toBe(true);
  });

  it("a run without a recording under the mock LLM ends in an error card, not a guess", async () => {
    const { runId } = await queuedRun("@agent something nobody recorded");
    const llm = createMockLlmProvider({ recordingsDir: path.resolve(__dirname, "../../scripts/demo/fixtures/agent-recordings") });

    expect(await startAgentRun(runId, deps({ llm }))).toBe("failed");
    const [card] = await runMessages(runId);
    expect(card).toMatchObject({ card_type: "error", card_payload: expect.objectContaining({ retryable: false }) });
  });
});

describe("finish_agent_run", () => {
  it("rejects a non-member actor with not_permitted and writes nothing", async () => {
    const { runId } = await queuedRun();
    const other = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: (await createUser({ batch })).userId }] });

    const { error } = await admin.rpc("finish_agent_run", {
      payload: {
        trip_id: tripId,
        actor_member_id: other.memberIds[0],
        run_id: runId,
        status: "failed",
        message: { kind: "card", card_type: "error", card_payload: {} },
      },
    });

    expect(error?.message).toMatch(/not_permitted/);
    expect((await runRow(runId)).status).toBe("queued");
    expect(await runMessages(runId)).toEqual([]);
  });

  it("finishing twice writes one message and keeps the first outcome", async () => {
    const { runId } = await queuedRun();
    await claimRun(admin, runId);
    const finish = (body: string) =>
      admin.rpc("finish_agent_run", {
        payload: { trip_id: tripId, actor_member_id: memberIds[1], run_id: runId, status: "succeeded", message: { kind: "text", body } },
      });

    expect((await finish("first")).data).toMatchObject({ finished: true, status: "succeeded" });
    expect((await finish("second")).data).toMatchObject({ finished: false, status: "succeeded" });
    expect((await runMessages(runId)).map((m) => m.body)).toEqual(["first"]);
  });

  it("the authenticated role can't execute finish_agent_run", async () => {
    const member = await createUser({ batch });
    const { error } = await member.client.rpc("finish_agent_run", { payload: {} });
    expect(error?.code).toBe("42501");
  });
});

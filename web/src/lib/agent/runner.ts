import "server-only";
import { type AgentStatusEvent, ErrorCard, pairsAgentWithPaid, type ToolName, type ToolResult } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import { tool as aiTool, type ToolSet } from "ai";
import { getLlmProvider, type LlmProvider, RecordingNotFoundError } from "@/lib/providers/llm";
import { AppError, toToolError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import type { ToolDefinition } from "@/lib/tools/define-tool";
import { toolRegistry } from "@/lib/tools/registry";
import { type Broadcast, supabaseBroadcast, TOOL_LABELS } from "./broadcast";
import { buildContext } from "./context";
import { recordingKey } from "./recording-key";
import { runTool } from "./run-tool";

export type AgentRunRow = Database["public"]["Tables"]["agent_runs"]["Row"];

/** A claimed run is presumed dead once its lease lapses (design §4.4). A run takes 90 s at most. */
export const LEASE_MS = 120_000;
const MAX_STEPS = 6;
const RUN_MS = 90_000;
const MESSAGE_MAX = 4000;

/** Replaces any final text that makes the agent the payer (design §2.1, human in the loop). */
export const PAYER_REPLACEMENT = "I proposed it. Each of you approves your own share.";

export interface RunnerDeps {
  admin: AdminClient;
  llm: LlmProvider;
  /** The tools offered to the model; the registry by default. */
  tools: Partial<Record<ToolName, ToolDefinition>>;
  broadcast: Broadcast;
}

export type RunOutcome = "succeeded" | "failed";

/**
 * Claims a queued run: `queued → running` with a lease. Returns null when the run isn't queued, or
 * when another run for the trip is already running (the partial unique index refuses a second).
 */
export async function claimRun(admin: AdminClient, runId: string, leaseMs = LEASE_MS): Promise<AgentRunRow | null> {
  const now = Date.now();
  const { data, error } = await admin
    .from("agent_runs")
    .update({
      status: "running",
      started_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + leaseMs).toISOString(),
    })
    .eq("id", runId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  if (error?.code === "23505") return null;
  if (error) throw new AppError("internal", "Couldn't claim the agent run.", { retryable: true, cause: error });
  return data;
}

/** The member a run's writes are on behalf of: its requester, or the organizer for a server-started run. */
async function actorFor(admin: AdminClient, run: AgentRunRow): Promise<string> {
  if (run.requester_member_id) return run.requester_member_id;
  const { data, error } = await admin
    .from("trip_members")
    .select("id")
    .eq("trip_id", run.trip_id)
    .eq("role", "organizer")
    .single();
  if (error) throw new AppError("internal", "The trip has no organizer.", { retryable: false, cause: error });
  return data.id;
}

async function triggerBody(admin: AdminClient, run: AgentRunRow): Promise<string | null> {
  if (!run.trigger_message_id) return null;
  const { data, error } = await admin.from("messages").select("body").eq("id", run.trigger_message_id).single();
  if (error) throw new AppError("internal", "Couldn't read the message that started the run.", { retryable: true, cause: error });
  return data.body;
}

async function finish(admin: AdminClient, payload: Record<string, unknown>): Promise<void> {
  const { error } = await admin.rpc("finish_agent_run", { payload: payload as never });
  if (error) throw new AppError("internal", "Couldn't finish the agent run.", { retryable: true, cause: error });
}

/** The error card for a failed run. It shows a safe message, never the raw error. */
function errorCardFor(error: unknown, tool: ToolName | null, retryMessageId: string | null): ErrorCard {
  const base =
    error instanceof RecordingNotFoundError
      ? {
          code: "internal" as const,
          message: "There's no recorded run for this request, and the mock model only replays recordings.",
          retryable: false,
        }
      : toToolError(error);
  return ErrorCard.parse({ card_type: "error", ...base, tool, retry_message_id: retryMessageId });
}

/** The agent's closing message: never empty, never long, and never the agent as payer. */
function finalText(text: string, results: unknown[]): string {
  let body = text.trim();
  if (!body) {
    // The step cap can end the loop on a tool call, before the model writes a reply.
    const wroteCard = results.some((r) => typeof (r as ToolResult | null)?.card_message_id === "string");
    body = wroteCard ? "Done. The card above has the details." : "I couldn't finish that. Try asking another way.";
  }
  if (pairsAgentWithPaid(body, { speaker: "agent" })) body = PAYER_REPLACEMENT;
  return body.slice(0, MESSAGE_MAX);
}

/**
 * Claims and runs one queued agent run (design §5.2): builds the context, runs the model's tool
 * loop with the registry's tools, and ends the run through `finish_agent_run` with exactly one
 * agent text message, or, on any failure, one error card with the run marked failed. Broadcasts
 * `agent.status` as it goes. Never throws: it runs inside `after()`. Returns null when the run
 * couldn't be claimed.
 */
export async function startAgentRun(runId: string, overrides: Partial<RunnerDeps> = {}): Promise<RunOutcome | null> {
  const admin = overrides.admin ?? getAdminClient();
  let run: AgentRunRow | null;
  try {
    run = await claimRun(admin, runId);
  } catch (error) {
    console.error(`agent run ${runId}: claim failed`, error);
    return null;
  }
  if (!run) return null;

  const broadcast = overrides.broadcast ?? supabaseBroadcast(admin);
  const status = (event: Omit<AgentStatusEvent, "run_id">) => broadcast(run.trip_id, { run_id: run.id, ...event });
  let step = 0;
  let failedTool: ToolName | null = null;
  let actor: string | null = null;

  try {
    actor = await actorFor(admin, run);
    const [body, context] = await Promise.all([triggerBody(admin, run), buildContext(run.trip_id, run.requester_member_id, admin)]);
    await admin.from("agent_runs").update({ handles: context.handles }).eq("id", run.id);
    await status({ step, state: "started", label: "Reading the trip" });

    const tools: ToolSet = {};
    for (const [name, definition] of Object.entries(overrides.tools ?? toolRegistry) as [ToolName, ToolDefinition][]) {
      tools[name] = aiTool({
        description: definition.description,
        inputSchema: definition.input,
        execute: async (input: unknown, { toolCallId }: { toolCallId: string }) => {
          step += 1;
          await status({ step, state: "tool", label: TOOL_LABELS[name], tool: name });
          const ctx = { tripId: run.trip_id, runId: run.id, toolCallId, requesterMemberId: run.requester_member_id, handles: context.handles, admin };
          try {
            return await runTool(ctx, definition, input);
          } catch (error) {
            failedTool = name;
            throw error;
          }
        },
      });
    }

    const llm = overrides.llm ?? getLlmProvider();
    const result = await llm.runAgent({
      system: context.system,
      messages: context.messages,
      tools,
      maxSteps: MAX_STEPS,
      signal: AbortSignal.timeout(RUN_MS),
      recordingKey: body === null ? undefined : recordingKey(body),
    });

    await finish(admin, {
      trip_id: run.trip_id,
      actor_member_id: actor,
      run_id: run.id,
      status: "succeeded",
      message: { kind: "text", body: finalText(result.text, result.steps.map((s) => s.output)) },
      step_count: result.steps.length,
      usage: result.usage,
      replayed: result.replayed,
    });
    await status({ step, state: "done", label: "Done" });
    return "succeeded";
  } catch (error) {
    console.error(`agent run ${run.id} failed`, error);
    const card = errorCardFor(error, failedTool, run.trigger_message_id);
    try {
      await finish(admin, {
        trip_id: run.trip_id,
        actor_member_id: actor ?? (await actorFor(admin, run)),
        run_id: run.id,
        status: "failed",
        message: { kind: "card", card_type: "error", card_payload: card },
        step_count: step,
        error: { code: card.code, message: card.message, tool: card.tool },
      });
    } catch (finishError) {
      // The lease runs out and the next claimant fails the run (AI-212), so it can't stay running.
      console.error(`agent run ${run.id}: couldn't record the failure`, finishError);
    }
    await status({ step, state: "failed", label: "Something went wrong" });
    return "failed";
  }
}

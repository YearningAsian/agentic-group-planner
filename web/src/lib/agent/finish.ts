import "server-only";
import { ErrorCard, type ToolErrorCode, type ToolName } from "@agp/shared";
import type { Database } from "@agp/shared/db";
import { AppError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";

export type AgentRunRow = Database["public"]["Tables"]["agent_runs"]["Row"];

/** The member a run's writes are on behalf of: its requester, or the organizer for a server-started run. */
export async function actorFor(admin: AdminClient, run: Pick<AgentRunRow, "trip_id" | "requester_member_id">): Promise<string> {
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

export interface FinishResult {
  /** False when the run had already ended; then nothing was written. */
  finished: boolean;
  status: "succeeded" | "failed";
}

/** Ends a run through `finish_agent_run`. A run that already ended is left as it is. */
export async function finishRun(admin: AdminClient, payload: Record<string, unknown>): Promise<FinishResult> {
  const { data, error } = await admin.rpc("finish_agent_run", { payload: payload as never });
  if (error) throw new AppError("internal", "Couldn't finish the agent run.", { retryable: true, cause: error });
  return data as unknown as FinishResult;
}

/** Fails a run with one error card whose fields come from the caller, never from a raw error. */
export async function failRun(
  admin: AdminClient,
  run: Pick<AgentRunRow, "id" | "trip_id" | "requester_member_id" | "trigger_message_id">,
  error: { code: ToolErrorCode; message: string; retryable: boolean; tool?: ToolName | null },
  stepCount?: number,
): Promise<void> {
  const card = ErrorCard.parse({
    card_type: "error",
    code: error.code,
    message: error.message,
    tool: error.tool ?? null,
    retryable: error.retryable,
    retry_message_id: run.trigger_message_id,
  });
  await finishRun(admin, {
    trip_id: run.trip_id,
    actor_member_id: await actorFor(admin, run),
    run_id: run.id,
    status: "failed",
    message: { kind: "card", card_type: "error", card_payload: card },
    ...(stepCount === undefined ? {} : { step_count: stepCount }),
    error: { code: card.code, message: card.message, tool: card.tool },
  });
}

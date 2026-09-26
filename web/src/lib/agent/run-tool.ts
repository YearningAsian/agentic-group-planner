import "server-only";
import { type ToolError, ToolResult } from "@agp/shared";
import { z } from "zod";
import { AppError, toToolError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import type { RunContext, ToolDefinition } from "@/lib/tools/define-tool";

/**
 * Errors the model can fix by calling again with other input, so they go back to it as a failed
 * ToolResult. Anything else (a provider outage, a timeout, a bug) ends the run with an error card.
 */
const CORRECTABLE = new Set(["invalid_input", "unknown_handle", "not_permitted", "conflict", "domain_rule", "not_found"]);

type CallRow = { id: string; status: string; output: unknown; error: unknown };

async function findCall(admin: AdminClient, runId: string, toolCallId: string): Promise<CallRow | null> {
  const { data, error } = await admin
    .from("tool_calls")
    .select("id, status, output, error")
    .eq("run_id", runId)
    .eq("tool_call_id", toolCallId)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read the tool call.", { retryable: true, cause: error });
  return data;
}

/** The result a finished call already stored. A call that threw stored no output, only its error. */
function storedResult(row: CallRow): ToolResult {
  const stored = ToolResult.safeParse(row.output);
  if (stored.success) return stored.data;
  const error = (row.error as ToolError | null) ?? { code: "internal", message: "Something went wrong.", retryable: true };
  return { ok: false, summary: error.message.slice(0, 600), error };
}

async function finishCall(admin: AdminClient, id: string, fields: Record<string, unknown>, status: "succeeded" | "failed") {
  // Conditional: a write function (apply_plan) may already have marked the call succeeded.
  const { error } = await admin
    .from("tool_calls")
    .update({ ...fields, status })
    .eq("id", id)
    .eq("status", "started");
  if (error) throw new AppError("internal", "Couldn't record the tool call.", { retryable: true, cause: error });
  if (typeof fields.duration_ms === "number") await admin.from("tool_calls").update({ duration_ms: fields.duration_ms }).eq("id", id);
}

/**
 * Runs one tool call exactly once per `(run_id, tool_call_id)` (design §7.1). A call that already
 * finished returns its stored result without running the handler again, so a replayed or retried
 * run never repeats a write. The input is parsed with the tool's schema (defaults applied) before
 * the handler sees it. Correctable errors come back as a failed ToolResult; anything else is
 * recorded on the call and rethrown, which ends the run.
 */
export async function runTool(ctx: RunContext, tool: ToolDefinition, rawInput: unknown): Promise<ToolResult> {
  const { admin } = ctx;
  let row = await findCall(admin, ctx.runId, ctx.toolCallId);
  let lostRace = false;
  if (!row) {
    const { data, error } = await admin
      .from("tool_calls")
      .insert({
        trip_id: ctx.tripId,
        run_id: ctx.runId,
        tool_call_id: ctx.toolCallId,
        tool_name: tool.name,
        input: (rawInput ?? {}) as never,
        status: "started",
      })
      .select("id, status, output, error")
      .single();
    // Another executor inserted the same call first; use its row.
    if (error?.code === "23505") {
      lostRace = true;
      row = await findCall(admin, ctx.runId, ctx.toolCallId);
    } else if (error) throw new AppError("internal", "Couldn't record the tool call.", { retryable: true, cause: error });
    else row = data;
  }
  if (!row) throw new AppError("internal", "The tool call disappeared.", { retryable: true });
  if (row.status !== "started") return storedResult(row);
  // Another executor is running this call right now; running the handler twice isn't safe.
  if (lostRace) {
    const error: ToolError = { code: "conflict", message: "This tool call is already running.", retryable: false };
    return { ok: false, summary: error.message, error };
  }

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const error: ToolError = { code: "invalid_input", message: z.prettifyError(parsed.error).slice(0, 500), retryable: false };
    const result: ToolResult = { ok: false, summary: `The ${tool.name} input was invalid.`, error };
    await finishCall(admin, row.id, { output: result, error }, "failed");
    return result;
  }

  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  let result: ToolResult;
  try {
    result = await tool.handler(parsed.data, ctx);
  } catch (error) {
    if (error instanceof AppError && CORRECTABLE.has(error.code)) {
      const toolError = toToolError(error);
      result = { ok: false, summary: toolError.message.slice(0, 600), error: toolError };
    } else {
      // Members can read tool_calls, so store the safe message, never the raw one.
      await finishCall(admin, row.id, { error: toToolError(error), duration_ms: elapsed() }, "failed").catch(() => {});
      throw error;
    }
  }

  if (result.ok) {
    await finishCall(
      admin,
      row.id,
      { output: result, message_id: result.card_message_id ?? null, duration_ms: elapsed() },
      "succeeded",
    );
  } else {
    await finishCall(admin, row.id, { output: result, error: result.error ?? null, duration_ms: elapsed() }, "failed");
  }
  return result;
}

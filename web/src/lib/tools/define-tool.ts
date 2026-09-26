import "server-only";
import type { ToolName, ToolResult } from "@agp/shared";
import type { z } from "zod";
import type { AdminClient } from "@/lib/supabase/admin";

/** Handle → UUID for one run, e.g. `{ M1: "…", I2: "…" }`. Built once per run, in a stable order. */
export type HandleTable = Readonly<Record<string, string>>;

/**
 * What every tool handler receives. The trip, run, and requester come from the server, never from
 * the model, so a tool can't be pointed at another trip.
 */
export interface RunContext {
  tripId: string;
  runId: string;
  toolCallId: string;
  requesterMemberId: string | null;
  handles: HandleTable;
  admin: AdminClient;
}

export interface ToolDefinition<Input extends z.ZodType = z.ZodType> {
  name: ToolName;
  /** What the model reads to decide when to call the tool. */
  description: string;
  input: Input;
  handler: (input: z.output<Input>, ctx: RunContext) => Promise<ToolResult>;
}

export function defineTool<Input extends z.ZodType>(definition: ToolDefinition<Input>): ToolDefinition<Input> {
  return definition;
}

/** The result a stub tool returns until its owner builds it. */
export function notBuiltResult(tool: ToolName): ToolResult {
  return {
    ok: false,
    summary: `${tool} isn't available yet.`,
    error: { code: "internal", message: `${tool} isn't built yet`, retryable: false },
  };
}

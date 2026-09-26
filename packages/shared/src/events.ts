import { z } from "zod";
import { Timestamp } from "./common";
import { ToolName } from "./enums";

/** Broadcast event names on a trip's Realtime channel. */
export const TRIP_EVENTS = { agentStatus: "agent.status", demoReset: "demo.reset" } as const;

/** Progress of an agent run, for the status bar. `done` and `failed` clear it. */
export const AgentStatusEvent = z.object({
  run_id: z.uuid(),
  step: z.number().int().min(0),
  state: z.enum(["started", "tool", "done", "failed"]),
  label: z.string(),
  tool: ToolName.optional(),
});
export type AgentStatusEvent = z.infer<typeof AgentStatusEvent>;

/** Sent by `reset:demo`; clients drop their cache and reload. */
export const DemoResetEvent = z.object({ at: Timestamp });
export type DemoResetEvent = z.infer<typeof DemoResetEvent>;

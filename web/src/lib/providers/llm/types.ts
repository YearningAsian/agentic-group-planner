import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";

export type LlmProviderName = "meta" | "google" | "mock";

export interface AgentStep {
  toolName: string;
  input: unknown;
  output: unknown;
}

export interface RunAgentInput {
  system: string;
  messages: ModelMessage[];
  /** The registry's tools, already bound to this run's context. */
  tools: ToolSet;
  /** 6 by default. */
  maxSteps?: number;
  signal?: AbortSignal;
  /** Picks the recording to replay (mock) or to write (AGENT_RECORD=1). */
  recordingKey?: string;
}

export interface RunAgentResult {
  text: string;
  steps: AgentStep[];
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | null;
  provider: LlmProviderName;
  replayed: boolean;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  /**
   * The AI SDK tool loop: 25 s and one retry per model call, 90 s per run.
   */
  runAgent(input: RunAgentInput): Promise<RunAgentResult>;
  generateObject<T extends z.ZodType>(input: { schema: T; prompt: string; images?: string[] }): Promise<z.output<T>>;
  describeImage(input: { url: string; context: string }): Promise<{ caption: string; aesthetic_score: number }>;
}

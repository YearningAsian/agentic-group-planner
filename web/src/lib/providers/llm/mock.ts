import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { recordingFileName } from "@/lib/agent/recording-key";
import { NotBuiltError } from "@/lib/not-built";
import { stepLimitError } from "./errors";
import type { AgentStep, LlmProvider } from "./types";

const Recording = z.object({
  key: z.string(),
  steps: z.array(z.object({ toolName: z.string(), input: z.unknown() })),
  finalText: z.string(),
});

/** Replay needs a recording for the exact prompt; without one the run fails instead of guessing. */
export class RecordingNotFoundError extends Error {
  override readonly name = "RecordingNotFoundError";

  constructor(readonly key: string | undefined) {
    super(key === undefined ? "LLM_PROVIDER=mock needs a recording key" : `No agent recording for "${key}"`);
  }
}

export interface MockLlmOptions {
  /** Defaults to `scripts/demo/fixtures/agent-recordings` under the web app. */
  recordingsDir?: string;
  /** The pause before each replayed step, so the UI shows progress as it would live (design §7.5). */
  delayMs?: readonly [min: number, max: number];
  random?: () => number;
}

const DEFAULT_DELAY_MS = [400, 900] as const;
const DEFAULT_MAX_STEPS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replays a recorded run's tool calls against the real tools, so database state, the optimizer,
 * and the cards are real while no model is called. Development and tests only.
 */
export function createMockLlmProvider(options: MockLlmOptions = {}): LlmProvider {
  const dir = options.recordingsDir ?? path.join(process.cwd(), "scripts/demo/fixtures/agent-recordings");
  const [minDelay, maxDelay] = options.delayMs ?? DEFAULT_DELAY_MS;
  const random = options.random ?? Math.random;

  async function load(key: string | undefined) {
    if (key === undefined) throw new RecordingNotFoundError(undefined);
    let raw: string;
    try {
      // Keep the recordings folder statically scoped so Next does not trace the whole repo.
      raw = await readFile(
        path.join(/* turbopackIgnore: true */ dir, recordingFileName(key)),
        "utf8",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENAMETOOLONG") throw new RecordingNotFoundError(key);
      throw error;
    }
    const recording = Recording.parse(JSON.parse(raw));
    // Different prompts can share a file name ("café" and "cafè"); never replay another prompt's run.
    if (recording.key !== key) throw new RecordingNotFoundError(key);
    return recording;
  }

  return {
    name: "mock",

    async runAgent(input) {
      const recording = await load(input.recordingKey);
      const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;
      // A live run fails at the step cap (design §4.4), so a replay of a longer run does too.
      if (recording.steps.length > maxSteps) throw stepLimitError(maxSteps);
      const planned = recording.steps;
      const missing = planned.find((step) => !input.tools[step.toolName]?.execute);
      if (missing) throw new Error(`Recording "${recording.key}" calls ${missing.toolName}, which this run doesn't offer`);

      const steps: AgentStep[] = [];
      for (const [index, step] of planned.entries()) {
        input.signal?.throwIfAborted();
        await sleep(minDelay + random() * (maxDelay - minDelay));
        input.signal?.throwIfAborted();
        // Stable call IDs, so a retried replay hits the same tool_calls rows.
        const output = await input.tools[step.toolName].execute!(step.input, {
          toolCallId: `replay-${index + 1}`,
          messages: input.messages,
          abortSignal: input.signal,
          context: undefined,
        });
        steps.push({ toolName: step.toolName, input: step.input, output });
      }
      return { text: recording.finalText, steps, usage: null, provider: "mock", replayed: true };
    },

    async generateObject() {
      throw new NotBuiltError("the mock LLM's generateObject");
    },
  };
}

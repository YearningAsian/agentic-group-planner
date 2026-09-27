import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmProvider } from "@/lib/providers/llm";
import { recordingFileName } from "./recording-key";

/** Where recordings live (design §7.5); the mock LLM replays from the same folder. */
export const RECORDINGS_DIR = path.join(process.cwd(), "scripts/demo/fixtures/agent-recordings");

/**
 * With `AGENT_RECORD=1`, a live run that succeeds writes `{ key, steps: [{ toolName, input }],
 * finalText }` for its prompt (design §7.5), so tests and offline development can replay it. Only
 * the tool inputs are kept: a replay runs the real tools again. A failed run writes nothing and
 * never falls back to a recording; the error reaches the runner, which posts an error card.
 * Disabled, or on the mock provider, the provider is returned unchanged.
 */
export function withRecording(llm: LlmProvider, options: { enabled: boolean; dir?: string }): LlmProvider {
  if (!options.enabled || llm.name === "mock") return llm;
  const dir = options.dir ?? RECORDINGS_DIR;
  return {
    ...llm,
    name: llm.name,
    async runAgent(input) {
      const result = await llm.runAgent(input);
      if (input.recordingKey && !result.replayed) {
        const recording = {
          key: input.recordingKey,
          steps: result.steps.map(({ toolName, input: toolInput }) => ({ toolName, input: toolInput })),
          finalText: result.text,
        };
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(/* turbopackIgnore: true */ dir, recordingFileName(input.recordingKey)),
          `${JSON.stringify(recording, null, 2)}\n`,
        );
      }
      return result;
    },
    generateObject: (request) => llm.generateObject(request),
  };
}

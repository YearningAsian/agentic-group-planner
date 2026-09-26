import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LlmProvider, RunAgentInput, RunAgentResult } from "@/lib/providers/llm";
import { AppError } from "@/lib/reliability";
import { withRecording } from "./recorder";
import { recordingFileName, recordingKey } from "./recording-key";

const key = recordingKey("@agent plan Saturday, $80 each");
const input: RunAgentInput = { system: "s", messages: [{ role: "user", content: "plan" }], tools: {}, recordingKey: key };

function live(result: Partial<RunAgentResult> | Error): LlmProvider {
  return {
    name: "meta",
    async runAgent() {
      if (result instanceof Error) throw result;
      return { text: "Here's a plan.", steps: [], usage: null, provider: "meta", replayed: false, ...result };
    },
    async generateObject() {
      throw new Error("not used");
    },
  };
}

const freshDir = () => mkdtempSync(path.join(tmpdir(), "recordings-"));

describe("withRecording", () => {
  it("AGENT_RECORD=1 writes { key, steps, finalText } to the recording file", async () => {
    const dir = freshDir();
    const steps = [{ toolName: "plan_day", input: { mode: "initial" }, output: { ok: true, summary: "Planned." } }];

    const result = await withRecording(live({ steps }), { enabled: true, dir }).runAgent(input);

    expect(result.text).toBe("Here's a plan.");
    const file = path.join(dir, recordingFileName(key));
    // Outputs aren't recorded: a replay runs the real tools again.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      key,
      steps: [{ toolName: "plan_day", input: { mode: "initial" } }],
      finalText: "Here's a plan.",
    });
  });

  it("without AGENT_RECORD, nothing is written", async () => {
    const dir = freshDir();
    const provider = live({});
    expect(withRecording(provider, { enabled: false, dir })).toBe(provider);
    await withRecording(provider, { enabled: false, dir }).runAgent(input);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a slow or failing model step ends in an error card; it never switches to a recording", async () => {
    const dir = freshDir();
    // A recording for this very prompt exists, and still isn't used.
    writeFileSync(path.join(dir, recordingFileName(key)), JSON.stringify({ key, steps: [], finalText: "stale" }));
    const timeout = new AppError("timeout", "The agent took too long. Try again.");

    await expect(withRecording(live(timeout), { enabled: true, dir }).runAgent(input)).rejects.toBe(timeout);
    // The runner turns that rejection into an error card; the stale recording is untouched.
    expect(JSON.parse(readFileSync(path.join(dir, recordingFileName(key)), "utf8")).finalText).toBe("stale");
  });

  it("never records a replay or a run without a key", async () => {
    const dir = freshDir();
    const mock = { ...live({ replayed: true }), name: "mock" as const };
    expect(withRecording(mock, { enabled: true, dir })).toBe(mock);
    await withRecording(live({}), { enabled: true, dir }).runAgent({ ...input, recordingKey: undefined });
    expect(existsSync(dir) && readdirSync(dir)).toEqual([]);
  });
});

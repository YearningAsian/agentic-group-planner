import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlanDayInput } from "@agp/shared";
import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { NotBuiltError } from "@/lib/not-built";
import { recordingFileName, recordingKey } from "@/lib/agent/recording-key";
import { createMockLlmProvider, RecordingNotFoundError } from "./mock";

const noDelay = { random: () => 0, delayMs: [0, 0] as const };

/** Writes one recording to a fresh directory and returns the directory. */
function recordingsWith(key: string, steps: { toolName: string; input: unknown }[], finalText = "Done.") {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-recordings-"));
  writeFileSync(path.join(dir, recordingFileName(key)), JSON.stringify({ key, steps, finalText }));
  return dir;
}

/** A tool that records each call and echoes its input back. */
function echoTool(calls: string[], name: string) {
  return tool({
    description: name,
    inputSchema: z.looseObject({}),
    execute: async (input, { toolCallId }) => {
      calls.push(`${name}:${toolCallId}`);
      return { echoed: input };
    },
  });
}

const base = { system: "You plan trips.", messages: [{ role: "user" as const, content: "plan it" }] };

afterEach(() => vi.useRealTimers());

describe("mock LLM provider", () => {
  it("mock runAgent returns the recorded steps in order and replayed = true", async () => {
    const key = "plan then search";
    const dir = recordingsWith(key, [
      { toolName: "plan_day", input: { mode: "initial" } },
      { toolName: "search_places", input: { query: "tacos" } },
    ], "Here's the plan.");
    const calls: string[] = [];
    const tools = { plan_day: echoTool(calls, "plan_day"), search_places: echoTool(calls, "search_places") };

    const result = await createMockLlmProvider({ recordingsDir: dir, ...noDelay }).runAgent({ ...base, tools, recordingKey: key });

    expect(calls).toEqual(["plan_day:replay-1", "search_places:replay-2"]);
    expect(result).toEqual({
      text: "Here's the plan.",
      steps: [
        { toolName: "plan_day", input: { mode: "initial" }, output: { echoed: { mode: "initial" } } },
        { toolName: "search_places", input: { query: "tacos" }, output: { echoed: { query: "tacos" } } },
      ],
      usage: null,
      provider: "mock",
      replayed: true,
    });
  });

  it("mock runAgent without a recording throws a named error", async () => {
    const provider = createMockLlmProvider({ recordingsDir: mkdtempSync(path.join(tmpdir(), "empty-")), ...noDelay });

    await expect(provider.runAgent({ ...base, tools: {}, recordingKey: "never recorded" })).rejects.toMatchObject({
      name: "RecordingNotFoundError",
      key: "never recorded",
    });
    await expect(provider.runAgent({ ...base, tools: {} })).rejects.toBeInstanceOf(RecordingNotFoundError);
  });

  it("a recorded step naming a tool the run doesn't offer throws before calling anything", async () => {
    const key = "stale recording";
    const dir = recordingsWith(key, [{ toolName: "retired_tool", input: {} }]);

    await expect(
      createMockLlmProvider({ recordingsDir: dir, ...noDelay }).runAgent({ ...base, tools: {}, recordingKey: key }),
    ).rejects.toThrow(/retired_tool/);
  });

  it("a tool that throws ends the replay with that error", async () => {
    const key = "throws then plans";
    const dir = recordingsWith(key, [
      { toolName: "broken", input: {} },
      { toolName: "plan_day", input: {} },
    ]);
    const calls: string[] = [];
    const broken = tool({
      description: "broken",
      inputSchema: z.looseObject({}),
      execute: async (): Promise<{ ok: boolean }> => {
        throw new Error("optimizer exploded");
      },
    });

    await expect(
      createMockLlmProvider({ recordingsDir: dir, ...noDelay }).runAgent({
        ...base,
        tools: { broken, plan_day: echoTool(calls, "plan_day") },
        recordingKey: key,
      }),
    ).rejects.toThrow("optimizer exploded");
    expect(calls).toEqual([]);
  });

  it("waits 400–900 ms before each replayed step", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const key = "one step";
    const dir = recordingsWith(key, [{ toolName: "plan_day", input: {} }]);
    const calls: string[] = [];
    const provider = createMockLlmProvider({ recordingsDir: dir, random: () => 1 });

    const run = provider.runAgent({ ...base, tools: { plan_day: echoTool(calls, "plan_day") }, recordingKey: key });
    // The recording is read from disk first; the replay delay starts once that finishes.
    while (vi.getTimerCount() === 0) await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(899);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(calls).toHaveLength(1);
  });

  it("the hand-written plan recording replays one valid plan_day step", async () => {
    const key = recordingKey("@agent plan Saturday, $80 each, Person 2's vegetarian, Person 4 joins later.");
    const inputs: unknown[] = [];
    const planDay = tool({
      description: "plan_day",
      inputSchema: z.looseObject({}),
      execute: async (input) => {
        inputs.push(input);
        return { ok: true };
      },
    });

    const result = await createMockLlmProvider(noDelay).runAgent({ ...base, tools: { plan_day: planDay }, recordingKey: key });

    expect(result.steps.map((step) => step.toolName)).toEqual(["plan_day"]);
    expect(PlanDayInput.safeParse(inputs[0]).success).toBe(true);
  });

  it("generateObject fails loudly instead of inventing output", async () => {
    const provider = createMockLlmProvider(noDelay);

    await expect(provider.generateObject({ schema: z.object({}), prompt: "x" })).rejects.toBeInstanceOf(NotBuiltError);
  });

  it("a recording with more tool calls than the step cap fails, like a live run would", async () => {
    const key = "loop forever";
    const dir = recordingsWith(key, Array.from({ length: 3 }, () => ({ toolName: "plan_day", input: { mode: "initial" } })));
    const calls: string[] = [];

    await expect(
      createMockLlmProvider({ recordingsDir: dir, ...noDelay }).runAgent({
        ...base,
        tools: { plan_day: echoTool(calls, "plan_day") },
        recordingKey: key,
        maxSteps: 2,
      }),
    ).rejects.toMatchObject({ name: "AppError", message: expect.stringContaining("too many steps") });
    expect(calls).toEqual([]);
  });

  it("an aborted run stops before the next recorded step", async () => {
    const key = "plan then search";
    const dir = recordingsWith(key, [
      { toolName: "plan_day", input: { mode: "initial" } },
      { toolName: "search_places", input: { query: "tacos" } },
    ]);
    const calls: string[] = [];
    const controller = new AbortController();
    const tools = {
      plan_day: tool({
        description: "plan",
        inputSchema: z.looseObject({}),
        execute: async () => {
          calls.push("plan_day");
          controller.abort(new Error("run budget spent"));
          return {};
        },
      }),
      search_places: echoTool(calls, "search_places"),
    };

    await expect(
      createMockLlmProvider({ recordingsDir: dir, ...noDelay }).runAgent({ ...base, tools, recordingKey: key, signal: controller.signal }),
    ).rejects.toThrow("run budget spent");
    expect(calls).toEqual(["plan_day"]);
  });

  it("a recording stored under another key, or a key too long for a file name, is not found", async () => {
    // "café" and "cafè" share a file name; replaying one for the other would be a silent wrong answer.
    const dir = recordingsWith("book the café", [], "Booked.");
    const provider = createMockLlmProvider({ recordingsDir: dir, ...noDelay });

    await expect(provider.runAgent({ ...base, tools: {}, recordingKey: "book the cafè" })).rejects.toBeInstanceOf(RecordingNotFoundError);
    await expect(provider.runAgent({ ...base, tools: {}, recordingKey: "x".repeat(400) })).rejects.toBeInstanceOf(RecordingNotFoundError);
  });
});

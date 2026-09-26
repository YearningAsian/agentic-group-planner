import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createMetaProvider } from "./real";

/** A Chat Completions response body, as Meta's Model API returns it. */
function completion(message: Record<string, unknown>, finishReason: string) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "muse-spark-1.3",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/** A fetch that answers each call with the next canned body and keeps every request it saw. */
function scriptedFetch(bodies: unknown[]) {
  const requests: { url: string; body: Record<string, unknown>; authorization: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const body = bodies[requests.length - 1];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, requests };
}

/** A fetch that never answers; it rejects only when the request is aborted. */
function hangingFetch() {
  const requests: RequestInit[] = [];
  const fetch = (_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      requests.push(init ?? {});
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  return { fetch, requests };
}

/** Lets pending I/O and promise chains run without moving the fake clock. */
async function until(condition: () => boolean) {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

const toolCall = (name: string, args: string) =>
  completion({ content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] }, "tool_calls");

const planPrompt = { system: "You plan trips.", messages: [{ role: "user" as const, content: "plan saturday" }] };

afterEach(() => vi.useRealTimers());

function metaWith(fetch: typeof globalThis.fetch) {
  return createMetaProvider({
    apiKey: "test-key",
    baseURL: "https://meta.test/v1",
    agentModel: "muse-spark-1.3",
    fetch,
  });
}

describe("meta LLM provider", () => {
  it("the meta provider never sends a tool_choice other than auto (Meta returns 400 otherwise)", async () => {
    const { fetch, requests } = scriptedFetch([
      completion(
        {
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "plan_day", arguments: '{"mode":"initial"}' } }],
        },
        "tool_calls",
      ),
      completion({ content: "Here's a plan for Saturday." }, "stop"),
    ]);
    const planDay = tool({
      description: "Plan the day.",
      inputSchema: z.object({ mode: z.enum(["initial", "replan"]) }),
      execute: async () => ({ ok: true }),
    });

    const result = await metaWith(fetch).runAgent({
      system: "You plan trips.",
      messages: [{ role: "user", content: "plan saturday" }],
      tools: { plan_day: planDay },
    });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe("https://meta.test/v1/chat/completions");
      expect(request.authorization).toBe("Bearer test-key");
      expect(request.body.tool_choice).toBe("auto");
    }
    expect(result).toMatchObject({
      text: "Here's a plan for Saturday.",
      steps: [{ toolName: "plan_day", input: { mode: "initial" }, output: { ok: true } }],
      provider: "meta",
      replayed: false,
    });
  });

  it("meta generateObject sends response_format json_schema, not a forced tool call", async () => {
    const { fetch, requests } = scriptedFetch([completion({ content: '{"caption":"Tacos at noon"}' }, "stop")]);

    const object = await metaWith(fetch).generateObject({
      schema: z.object({ caption: z.string() }),
      prompt: "Caption this.",
    });

    expect(object).toEqual({ caption: "Tacos at noon" });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.response_format).toMatchObject({ type: "json_schema" });
    expect(requests[0].body.tools).toBeUndefined();
    expect(requests[0].body.tool_choice).toBeUndefined();
  });

  it("a model call that hangs past 25 s is retried once, then fails with a timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch, requests } = hangingFetch();

    const outcome = metaWith(fetch).runAgent({ ...planPrompt, tools: {} }).catch((error: unknown) => error);
    await until(() => requests.length === 1);
    await vi.advanceTimersByTimeAsync(25_000 + 400);
    await until(() => requests.length === 2);
    await vi.advanceTimersByTimeAsync(25_000);

    expect(await outcome).toMatchObject({ name: "AppError", code: "timeout" });
    expect(requests).toHaveLength(2);
  });

  it("a tool that runs longer than 25 s doesn't cut the run short", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { fetch, requests } = scriptedFetch([
      toolCall("plan_day", '{"mode":"initial"}'),
      completion({ content: "Here's a plan for Saturday." }, "stop"),
    ]);
    let toolDone = false;
    const slowPlanDay = tool({
      description: "Plan the day.",
      inputSchema: z.object({ mode: z.enum(["initial", "replan"]) }),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30_000));
        toolDone = true;
        return { ok: true };
      },
    });

    const run = metaWith(fetch).runAgent({ ...planPrompt, tools: { plan_day: slowPlanDay } });
    await until(() => requests.length === 1);
    await vi.advanceTimersByTimeAsync(30_000);
    await until(() => toolDone);

    await expect(run).resolves.toMatchObject({ text: "Here's a plan for Saturday.", steps: [{ toolName: "plan_day" }] });
    expect(requests).toHaveLength(2);
  });

  it("a tool that throws ends the run with that error, without another model call", async () => {
    const { fetch, requests } = scriptedFetch([
      toolCall("plan_day", '{"mode":"initial"}'),
      completion({ content: "Something went wrong, sorry." }, "stop"),
    ]);
    const broken = tool({
      description: "Plan the day.",
      inputSchema: z.object({ mode: z.enum(["initial", "replan"]) }),
      execute: async (): Promise<{ ok: boolean }> => {
        throw new Error("optimizer exploded");
      },
    });

    await expect(metaWith(fetch).runAgent({ ...planPrompt, tools: { plan_day: broken } })).rejects.toThrow(
      "optimizer exploded",
    );
    expect(requests).toHaveLength(1);
  });
});

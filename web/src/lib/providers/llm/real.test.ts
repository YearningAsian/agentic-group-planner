import { tool } from "ai";
import { describe, expect, it } from "vitest";
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

function metaWith(fetch: typeof globalThis.fetch) {
  return createMetaProvider({
    apiKey: "test-key",
    baseURL: "https://meta.test/v1",
    agentModel: "muse-spark-1.3",
    visionModel: "muse-spark-1.3",
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

  it("describeImage sends the photo to the vision model and returns a caption and score", async () => {
    const { fetch, requests } = scriptedFetch([
      completion({ content: '{"caption":"Four friends at the pier","aesthetic_score":0.8}' }, "stop"),
    ]);
    const photo = "data:image/png;base64,iVBORw0KGgo=";

    const description = await createMetaProvider({
      apiKey: "test-key",
      baseURL: "https://meta.test/v1",
      agentModel: "muse-spark-1.3",
      visionModel: "vision-test",
      fetch,
    }).describeImage({ url: photo, context: "Saturday at the pier" });

    expect(description).toEqual({ caption: "Four friends at the pier", aesthetic_score: 0.8 });
    expect(requests[0].body.model).toBe("vision-test");
    expect(JSON.stringify(requests[0].body.messages)).toContain("iVBORw0KGgo=");
  });
});

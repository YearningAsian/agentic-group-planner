import { describe, expect, it } from "vitest";
import { bundledSampleCatalog } from "@/lib/demo/sample-catalog";
import { SAFE_LINE } from "./ground";
import { runPlannerChat } from "./run";

const noMiamiStays = {
  ...bundledSampleCatalog,
  stays: { ...bundledSampleCatalog.stays, miami: [] },
};

function sse(content: string): Response {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "muse-spark-1.3",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return new Response(
    chunk({ role: "assistant", content: "" }, null) + chunk({ content }, null) + chunk({}, "stop") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function toolSse(name: string, args: string): Response {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "muse-spark-1.3",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return new Response(
    chunk(
      { role: "assistant", tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: args } }] },
      null,
    ) +
      chunk({}, "tool_calls") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

function scriptedFetch(steps: Array<string | (() => Response)>) {
  let index = 0;
  const bodies: unknown[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : "{}");
    bodies.push(JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw as Uint8Array)));
    const step = steps[Math.min(index, steps.length - 1)] ?? "";
    index += 1;
    return typeof step === "string" ? sse(step) : step();
  };
  return { fetch, calls: () => index, bodies: () => bodies };
}

const request = {
  messages: [{ role: "user" as const, text: "Find a flight to Miami" }],
  fromQuestionnaire: true,
};

describe("runPlannerChat sample catalog", () => {
  it("drops an invented fare and keeps the follow-up question", async () => {
    const { fetch, calls } = scriptedFetch(["Delta is $400.", "What dates are you traveling?"]);
    const response = await runPlannerChat(request, { apiKey: "test-key", fetchImpl: fetch });
    const body = await response.text();
    expect(body).not.toMatch(/\$400|Delta/);
    expect(body).toContain("What dates are you traveling?");
    expect(calls()).toBe(2);
  });

  it("caps the muse request: short instructions, eight turns, and a small completion", async () => {
    const history = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `note ${index} ${"prefer quiet streets ".repeat(40)}`,
    }));
    const { fetch, bodies } = scriptedFetch(["What dates are you traveling?"]);
    const response = await runPlannerChat(
      { messages: history, trip: { destination: "Miami" }, fromQuestionnaire: true },
      { apiKey: "test-key", fetchImpl: fetch },
    );
    await response.text();
    const body = bodies()[0] as {
      max_tokens?: number;
      messages?: { role: string; content: string }[];
    };
    expect(body.max_tokens).toBe(320);
    const system = body.messages?.find((message) => message.role === "system")?.content ?? "";
    expect(system.length).toBeLessThan(1300);
    expect(system).not.toMatch(/not chosen|not set|not listed/);
    expect(system).toContain("Destination: Miami");
    const chat = body.messages?.filter((message) => message.role !== "system") ?? [];
    expect(chat).toHaveLength(8);
    expect(chat[0]?.content.length).toBeLessThanOrEqual(160);
  });

  it("sends a clarifying question through without a second model call", async () => {
    const { fetch, calls } = scriptedFetch(["What dates are you traveling?"]);
    const response = await runPlannerChat(request, { apiKey: "test-key", fetchImpl: fetch });
    const body = await response.text();
    expect(body).toContain("What dates are you traveling?");
    expect(calls()).toBe(1);
  });

  it("replaces an ungrounded price when the catalog was not the source of that number", async () => {
    const { fetch } = scriptedFetch(["The fare is $400."]);
    const response = await runPlannerChat(request, { apiKey: "test-key", fetchImpl: fetch });
    const first = await response.text();
    expect(first).not.toMatch(/\$400/);
    expect(first).toContain(SAFE_LINE);
  });

  it("replaces an invented price after a catalog search and keeps the sample fare", async () => {
    const { fetch } = scriptedFetch([
      () =>
        toolSse(
          "search_flights",
          JSON.stringify({ origin: "ATL", destination: "MIA", departureDate: "2026-10-15", travelers: 1 }),
        ),
      "Delta is $400.",
    ]);
    const response = await runPlannerChat(request, {
      apiKey: "test-key",
      fetchImpl: fetch,
      catalog: bundledSampleCatalog,
    });
    const body = await response.text();
    expect(body).not.toMatch(/\$400/);
    expect(body).toContain("The pick is Mariner from JFK to MIA at 08:05 for $196.");
  });

  it("asks for the missing budget before it searches when the questionnaire was skipped", async () => {
    const { fetch, calls } = scriptedFetch([""]);
    const response = await runPlannerChat(
      {
        messages: [{ role: "user", text: "Plan the trip" }],
        trip: {
          origin: "ATL",
          destination: "Miami",
          startDate: "2026-10-15",
          endDate: "2026-10-18",
          members: ["Ava"],
        },
      },
      { apiKey: "test-key", fetchImpl: fetch, catalog: bundledSampleCatalog },
    );
    const body = await response.text();
    expect(body).toContain("What's the budget per person?");
    expect(body).toContain('"type":"clarify"');
    expect(body).not.toContain("The pick is");
    expect(body).not.toContain('"type":"cards"');
    expect(calls()).toBe(0);
  });

  it("asks a fare tradeoff from the sample catalog after the questionnaire", async () => {
    const { fetch, calls } = scriptedFetch([""]);
    const response = await runPlannerChat(
      {
        messages: [{ role: "user", text: "Plan the trip" }],
        fromQuestionnaire: true,
        trip: {
          origin: "New York",
          destination: "Miami",
          startDate: "2026-10-15",
          endDate: "2026-10-18",
          budget: 800,
          members: ["Ava"],
        },
      },
      { apiKey: "test-key", fetchImpl: fetch, catalog: bundledSampleCatalog },
    );
    const body = await response.text();
    expect(body).toContain("Mariner");
    expect(body).toContain("$196");
    expect(body).toContain("Cedar Air");
    expect(body).toContain("$148");
    expect(body).toMatch(/price or time/i);
    expect(body).toContain('"type":"clarify"');
    expect(body).not.toContain('"type":"cards"');
    expect(calls()).toBe(0);
  });

  it("commits one sample flight and one hotel after the question cap", async () => {
    const { fetch, calls } = scriptedFetch([""]);
    const response = await runPlannerChat(
      {
        messages: [
          { role: "user", text: "Plan the trip" },
          { role: "user", text: "cheaper" },
          { role: "user", text: "the guest score" },
        ],
        fromQuestionnaire: true,
        clarifyCount: 2,
        trip: {
          origin: "New York",
          destination: "Miami",
          startDate: "2026-10-15",
          endDate: "2026-10-18",
          budget: 800,
        },
      },
      { apiKey: "test-key", fetchImpl: fetch, catalog: bundledSampleCatalog },
    );
    const body = await response.text();
    expect(body).toMatch(/based on that, i'd go with/i);
    expect(body).toContain("Cedar Air");
    expect(body).toContain("Coconut Grove rooms");
    expect(body).toContain('"commit":true');
    expect(body).not.toContain("Lumen");
    expect(body).not.toContain("Wynwood");
    expect(calls()).toBe(0);
  });

  it("keeps the flight pick and says when hotel search fails", async () => {
    const { fetch } = scriptedFetch([
      () =>
        toolSse(
          "search_flights",
          JSON.stringify({ origin: "ATL", destination: "MIA", departureDate: "2026-10-15", travelers: 1 }),
        ),
      "",
    ]);
    const response = await runPlannerChat(
      {
        messages: [
          { role: "user", text: "Plan the trip" },
          { role: "user", text: "time" },
        ],
        fromQuestionnaire: true,
        clarifyCount: 2,
        trip: {
          origin: "New York",
          destination: "Miami",
          startDate: "2026-10-15",
          endDate: "2026-10-18",
          budget: 800,
        },
      },
      { apiKey: "test-key", fetchImpl: fetch, catalog: noMiamiStays },
    );
    const body = await response.text();
    expect(body).toMatch(/based on that, i'd go with/i);
    expect(body).toContain("Mariner");
    expect(body).toContain("No hotels matched that search.");
    expect(body).not.toContain("Stay at");
    expect(body).toContain('"commit":true');
  });

  it("fills hotels from the catalog after a miss on an unknown city", async () => {
    const { fetch } = scriptedFetch([
      () =>
        toolSse(
          "search_hotels",
          JSON.stringify({ destination: "Nowhere", checkIn: "2026-10-15", checkOut: "2026-10-18", guests: 1 }),
        ),
      "",
    ]);
    const response = await runPlannerChat(
      {
        messages: [{ role: "user", text: "Where should we stay?" }],
        fromQuestionnaire: true,
        trip: { destination: "Miami", startDate: "2026-10-15", endDate: "2026-10-18" },
      },
      { apiKey: "test-key", fetchImpl: fetch, catalog: bundledSampleCatalog },
    );
    const body = await response.text();
    expect(body).toContain("Stay at Coconut Grove rooms in Coconut Grove for $210 a night.");
    expect(body).not.toContain("Nowhere");
  });
});

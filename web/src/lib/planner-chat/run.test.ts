import { describe, expect, it } from "vitest";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";
import { offerRecommendation, SAFE_LINE } from "./ground";
import { HOTEL_UNAVAILABLE } from "./types";
import { runPlannerChat } from "./run";

const miami: PlaceSuggestion = {
  kind: "city",
  name: "Miami",
  iataCode: "MIA",
  airports: [],
  lat: 25.76,
  lng: -80.19,
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

const request = { messages: [{ role: "user" as const, text: "Find a flight to Miami" }] };

describe("runPlannerChat Duffel gate", () => {
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
      { messages: history, trip: { destination: "Miami" } },
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

  it("replaces an ungrounded price after Duffel was not the source of that number", async () => {
    const { fetch } = scriptedFetch(["The fare is $400."]);
    const response = await runPlannerChat(request, { apiKey: "test-key", fetchImpl: fetch });
    const first = await response.text();
    expect(first).not.toMatch(/\$400/);
    expect(first).toContain(SAFE_LINE);
  });

  it("replaces an invented price after a Duffel search and keeps the Duffel card", async () => {
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
      places: { suggest: async () => [{ ...miami, iataCode: "ATL", name: "Atlanta" }, miami] },
      flights: {
        search: async () => ({
          flights: [
            {
              airline: "Delta Air Lines",
              flightNumber: "DL123",
              origin: "ATL",
              destination: "MIA",
              departureTime: "2026-10-15T08:20:00",
              arrivalTime: "2026-10-15T10:05:00",
              stops: 0,
              price: 179,
              totalPrice: 179,
              currency: "USD",
            },
          ],
        }),
      },
    });
    const body = await response.text();
    expect(body).not.toMatch(/\$400/);
    expect(body).toContain("The pick is Delta Air Lines DL123");
    expect(body).toContain("$179");
  });

  it("recommends from the trip draft when the model does not search", async () => {
    const { fetch } = scriptedFetch([""]);
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
      {
        apiKey: "test-key",
        fetchImpl: fetch,
        places: { suggest: async () => [miami] },
        flights: {
          search: async () => ({
            flights: [
              {
                airline: "Delta Air Lines",
                flightNumber: "DL123",
                origin: "ATL",
                destination: "MIA",
                departureTime: "2026-10-15T08:20:00",
                arrivalTime: "2026-10-15T10:05:00",
                stops: 0,
                price: 179,
                totalPrice: 179,
                currency: "USD",
              },
            ],
          }),
        },
        stays: {
          search: async () => [
            {
              id: "stay-1",
              name: "The Example Hotel",
              image: null,
              area: "South Beach",
              guestScore: 8.8,
              reviewCount: 10,
              starRating: 4,
              nightlyAmount: 210,
              totalAmount: 630,
              currency: "USD",
              amenities: ["Pool"],
            },
          ],
          getAccommodation: async () => null,
          getRates: async () => null,
          getReviews: async () => [],
        },
      },
    );
    const body = await response.text();
    expect(body).not.toContain("Tell me a bit more");
    expect(body).toContain("Stay at The Example Hotel");
    expect(body).toContain(offerRecommendation(
      [
        {
          airline: "Delta Air Lines",
          flightNumber: "DL123",
          origin: "ATL",
          destination: "MIA",
          departureTime: "2026-10-15T08:20:00",
          arrivalTime: "2026-10-15T10:05:00",
          stops: 0,
          price: 179,
          totalPrice: 179,
          currency: "USD",
        },
      ],
      [
        {
          name: "The Example Hotel",
          location: "South Beach",
          pricePerNight: 210,
          totalPrice: 630,
          currency: "USD",
          rating: 8.8,
          amenities: ["Pool"],
        },
      ],
    ));
  });

  it("recommends a hotel when the model only searched flights", async () => {
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
        messages: [{ role: "user", text: "Plan the trip" }],
        trip: { destination: "Miami", startDate: "2026-10-15", endDate: "2026-10-18" },
      },
      {
        apiKey: "test-key",
        fetchImpl: fetch,
        places: { suggest: async () => [miami] },
        flights: {
          search: async () => ({
            flights: [
              {
                airline: "Delta Air Lines",
                flightNumber: "DL123",
                origin: "ATL",
                destination: "MIA",
                departureTime: "2026-10-15T08:20:00",
                arrivalTime: "2026-10-15T10:05:00",
                stops: 0,
                price: 179,
                totalPrice: 179,
                currency: "USD",
              },
            ],
          }),
        },
        stays: {
          search: async () => [
            {
              id: "stay-1",
              name: "The Example Hotel",
              image: null,
              area: "South Beach",
              guestScore: 8.8,
              reviewCount: 10,
              starRating: 4,
              nightlyAmount: 210,
              totalAmount: 630,
              currency: "USD",
              amenities: ["Pool"],
            },
          ],
          getAccommodation: async () => null,
          getRates: async () => null,
          getReviews: async () => [],
        },
      },
    );
    const body = await response.text();
    expect(body).toContain("The pick is Delta Air Lines DL123");
    expect(body).toContain("Stay at The Example Hotel in South Beach");
    expect(body).toContain('"name":"The Example Hotel"');
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
        messages: [{ role: "user", text: "Plan the trip" }],
        trip: { destination: "Miami", startDate: "2026-10-15", endDate: "2026-10-18" },
      },
      {
        apiKey: "test-key",
        fetchImpl: fetch,
        places: { suggest: async () => [miami] },
        flights: {
          search: async () => ({
            flights: [
              {
                airline: "Delta Air Lines",
                flightNumber: "DL123",
                origin: "ATL",
                destination: "MIA",
                departureTime: "2026-10-15T08:20:00",
                arrivalTime: "2026-10-15T10:05:00",
                stops: 0,
                price: 179,
                totalPrice: 179,
                currency: "USD",
              },
            ],
          }),
        },
        stays: {
          search: async () => Promise.reject(new Error("stays down")),
          getAccommodation: async () => null,
          getRates: async () => null,
          getReviews: async () => [],
        },
      },
    );
    const body = await response.text();
    expect(body).toContain("The pick is Delta Air Lines DL123");
    expect(body).toContain(HOTEL_UNAVAILABLE);
    expect(body).not.toContain("Stay at");
  });

  it("retries hotels after a failed stay lookup", async () => {
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
        trip: { destination: "Miami", startDate: "2026-10-15", endDate: "2026-10-18" },
      },
      {
        apiKey: "test-key",
        fetchImpl: fetch,
        places: { suggest: async (query) => (query.toLowerCase() === "miami" ? [miami] : []) },
        stays: {
          search: async () => [
            {
              id: "stay-1",
              name: "The Example Hotel",
              image: null,
              area: "South Beach",
              guestScore: 8.8,
              reviewCount: 10,
              starRating: 4,
              nightlyAmount: 210,
              totalAmount: 630,
              currency: "USD",
              amenities: ["Pool"],
            },
          ],
          getAccommodation: async () => null,
          getRates: async () => null,
          getReviews: async () => [],
        },
      },
    );
    const body = await response.text();
    expect(body).toContain("Stay at The Example Hotel in South Beach");
    expect(body).not.toContain("Nowhere");
  });
});

import { describe, expect, it } from "vitest";
import { createOptimizerClient, type PlanRequest, type PlanResponse } from "./client";

const request: PlanRequest = {
  request_id: "call-1",
  mode: "initial",
  members: [
    { id: "00000000-0000-4000-8000-000000000001", budget_cents: 8000, dietary: [], interests: ["art"] },
    { id: "00000000-0000-4000-8000-000000000002", budget_cents: 8000, dietary: ["vegetarian"], interests: [] },
  ],
  slots: [
    {
      key: "morning",
      starts_at: "2026-10-03T14:00:00Z",
      ends_at: "2026-10-03T16:30:00Z",
      together: true,
      pinned: null,
      candidates: [
        {
          place_id: "00000000-0000-4000-8000-000000000031",
          price_cents: 4200,
          tags: ["animals"],
          dietary_tags: [],
          rating: 4.6,
          open_from: null,
          open_until: null,
          duration_min: 150,
        },
      ],
    },
  ],
  travel: [],
};

const response: PlanResponse = {
  request_id: "call-1",
  engine: "cp_sat",
  status: "optimal",
  solve_ms: 12,
  plans: [
    {
      rank: 1,
      total_score: 0.8,
      fairness: 0.7,
      split: false,
      member_scores: [],
      assignments: [
        { slot_key: "morning", groups: [{ place_id: "00000000-0000-4000-8000-000000000031", member_ids: request.members.map((m) => m.id) }] },
      ],
    },
  ],
  slot_options: [],
  infeasible_reasons: [],
};

/** A fetch that answers with the given statuses in turn, and records each request. */
function fetchAnswering(...answers: [status: number, body: unknown][]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const client = (fetch: typeof globalThis.fetch) =>
  createOptimizerClient({ baseUrl: "http://optimizer.test/", token: "secret-token", fetch, backoffMs: 1 });

describe("optimizer client", () => {
  it("sends the bearer token and parses the PlanResponse", async () => {
    const { fetch, calls } = fetchAnswering([200, response]);

    await expect(client(fetch).plan(request)).resolves.toEqual(response);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://optimizer.test/v1/plan");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it("a 5xx is retried once, then surfaces AppError provider_unavailable", async () => {
    const { fetch, calls } = fetchAnswering([503, { error: { code: "internal" } }]);

    await expect(client(fetch).plan(request)).rejects.toMatchObject({ name: "AppError", code: "provider_unavailable", retryable: true });
    expect(calls).toHaveLength(2);
  });

  it("a 5xx then a 200 succeeds on the retry", async () => {
    const { fetch, calls } = fetchAnswering([500, {}], [200, response]);
    await expect(client(fetch).plan(request)).resolves.toEqual(response);
    expect(calls).toHaveLength(2);
  });

  it("a 422 or 401 isn't retried, and never echoes the token", async () => {
    for (const status of [422, 401]) {
      const { fetch, calls } = fetchAnswering([status, { detail: "bad" }]);
      const error = await client(fetch).plan(request).catch((e: unknown) => e);
      expect(error).toMatchObject({ name: "AppError", code: "internal", retryable: false });
      expect(String((error as Error).message)).not.toContain("secret-token");
      expect(calls).toHaveLength(1);
    }
  });

  it("a body that isn't a PlanResponse is an internal error", async () => {
    const { fetch } = fetchAnswering([200, { request_id: "call-1", engine: "magic" }]);
    await expect(client(fetch).plan(request)).rejects.toMatchObject({ code: "internal" });
  });
});

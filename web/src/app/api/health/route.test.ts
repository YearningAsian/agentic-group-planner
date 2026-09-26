import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbResult = vi.fn();
const fetchMock = vi.fn();

// The admin client's query chain, ending in whatever `dbResult` resolves to.
const query = {
  select: () => query,
  limit: () => query,
  abortSignal: () => dbResult(),
};

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ from: () => query }) }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => ({ OPTIMIZER_URL: "http://optimizer.test:8000" }) }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  dbResult.mockResolvedValue({ data: [], error: null });
  fetchMock.mockResolvedValue(Response.json({ status: "ok" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it('returns 200 with optimizer "error" when FastAPI is unreachable', async () => {
    // What undici throws when nothing listens on the port.
    fetchMock.mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ web: "ok", db: "ok", optimizer: "error" });
  });

  it('returns all "ok" when the db and optimizer respond', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ web: "ok", db: "ok", optimizer: "ok" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://optimizer.test:8000/health");
    // A monitor must see the current state, never a cached one.
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it('reports db "error" when the query fails, and optimizer "error" on a non-ok answer', async () => {
    dbResult.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    fetchMock.mockResolvedValue(new Response("bad gateway", { status: 502 }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ web: "ok", db: "error", optimizer: "error" });
  });
});

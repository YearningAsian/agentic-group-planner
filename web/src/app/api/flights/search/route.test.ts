import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ DUFFEL_ACCESS_TOKEN: "duffel_test_token" }),
}));

vi.mock("@/lib/planner-chat/search", () => ({
  executeFlightSearch: (...args: unknown[]) => search(...args),
}));

describe("GET /api/flights/search", () => {
  beforeEach(() => {
    search.mockReset();
  });

  it("asks for an origin instead of searching when it is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/flights/search?destination=LIS&departureDate=2026-06-01"));
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("searches Duffel with the trip origin, destination, dates, and travelers", async () => {
    search.mockResolvedValue({
      ok: true,
      flights: [{ airline: "TAP", origin: "JFK", destination: "LIS", price: 480, currency: "USD" }],
    });
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/flights/search?origin=New%20York&destination=LIS&departureDate=2026-06-01&returnDate=2026-06-04&travelers=2",
      ),
    );
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      {
        origin: "New York",
        destination: "LIS",
        departureDate: "2026-06-01",
        returnDate: "2026-06-04",
        travelers: 2,
      },
      { duffelToken: "duffel_test_token" },
    );
    await expect(response.json()).resolves.toEqual({
      flights: [{ airline: "TAP", origin: "JFK", destination: "LIS", price: 480, currency: "USD" }],
    });
  });

  it("says flights are unavailable when Duffel rejects the search", async () => {
    search.mockResolvedValue({ ok: false, error: "I couldn't retrieve flight options right now. Try again in a moment." });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/flights/search?origin=JFK&destination=LIS&departureDate=2026-06-01&travelers=1"),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "I couldn't retrieve flight options right now. Try again in a moment." },
    });
  });
});

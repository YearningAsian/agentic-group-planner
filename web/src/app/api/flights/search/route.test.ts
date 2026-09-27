import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();

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

  it("searches the sample catalog with the trip origin, destination, dates, and travelers", async () => {
    search.mockResolvedValue({
      ok: true,
      flights: [{ airline: "Mariner", origin: "JFK", destination: "LIS", price: 548, currency: "USD" }],
    });
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/flights/search?origin=New%20York&destination=LIS&departureDate=2026-06-01&returnDate=2026-06-04&travelers=2",
      ),
    );
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      origin: "New York",
      destination: "LIS",
      departureDate: "2026-06-01",
      returnDate: "2026-06-04",
      travelers: 2,
    });
    await expect(response.json()).resolves.toEqual({
      flights: [{ airline: "Mariner", origin: "JFK", destination: "LIS", price: 548, currency: "USD" }],
    });
  });

  it("says flights are unavailable when the catalog search fails", async () => {
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

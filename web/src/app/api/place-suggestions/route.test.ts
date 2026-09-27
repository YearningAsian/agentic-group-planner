import { beforeEach, describe, expect, it, vi } from "vitest";

const suggest = vi.fn();

vi.mock("@/lib/providers/place-suggestions", () => ({
  getPlaceSuggestionsProvider: () => ({ suggest }),
}));

describe("GET /api/place-suggestions", () => {
  beforeEach(() => {
    suggest.mockReset();
  });

  it("returns 400 when query is shorter than 2 characters", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/place-suggestions?query=l"));
    expect(response.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("returns IATA-bearing suggestions from the provider", async () => {
    suggest.mockResolvedValue([
      { kind: "city", name: "Lisbon", iataCode: "LIS", lat: 38.72, lng: -9.13, airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport" }] },
    ]);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/place-suggestions?query=lis"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [
        { kind: "city", name: "Lisbon", iataCode: "LIS", lat: 38.72, lng: -9.13, airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport" }] },
      ],
    });
  });
});

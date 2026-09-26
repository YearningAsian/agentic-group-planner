import { beforeEach, describe, expect, it, vi } from "vitest";

const suggest = vi.fn();

vi.mock("@/lib/providers/geocoding", () => ({
  getGeocodingProvider: () => ({ suggest }),
}));

describe("GET /api/geocode", () => {
  beforeEach(() => {
    suggest.mockReset();
  });

  it("returns 400 when query is shorter than 2 characters", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/geocode?query=a"));
    expect(response.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it("returns suggestions from the geocoding provider", async () => {
    suggest.mockResolvedValue([{ label: "123 Mission St", lat: 37.79, lng: -122.39 }]);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/geocode?query=mission"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [{ label: "123 Mission St", lat: 37.79, lng: -122.39 }],
    });
    expect(suggest).toHaveBeenCalledWith("mission");
  });
});

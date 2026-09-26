import { describe, expect, it } from "vitest";
import { mockGeocodingProvider } from "./mock";

describe("mock geocoding provider", () => {
  it("filters fixture addresses by query without touching the network", async () => {
    const results = await mockGeocodingProvider.suggest("mission");
    expect(results).toEqual([
      {
        label: "123 Mission St, San Francisco, CA 94105, United States",
        lat: 37.7935,
        lng: -122.396,
      },
    ]);
  });

  it("returns an empty list for a blank query", async () => {
    await expect(mockGeocodingProvider.suggest("  ")).resolves.toEqual([]);
  });
});

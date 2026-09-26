import { describe, expect, it, vi } from "vitest";
import { createMapboxGeocoding } from "./real";

const FEATURE = {
  properties: {
    full_address: "123 Mission St, San Francisco, California 94105, United States",
    coordinates: { latitude: 37.7935, longitude: -122.396 },
  },
};

describe("Mapbox geocoding provider", () => {
  it("calls the Geocoding v6 forward endpoint and maps address + coordinates", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("https://api.mapbox.com/search/geocode/v6/forward");
      expect(url).toContain("q=mission");
      expect(url).toContain("autocomplete=true");
      expect(url).toContain("types=address%2Cstreet");
      expect(url).toContain("access_token=pk.live-token-for-tests-xxxxxxxxxxxxxxxx");
      return new Response(JSON.stringify({ features: [FEATURE] }), { status: 200 });
    });

    const provider = createMapboxGeocoding({
      token: "pk.live-token-for-tests-xxxxxxxxxxxxxxxx",
      fetchImpl,
    });
    const results = await provider.suggest("mission");

    expect(results).toEqual([
      {
        label: "123 Mission St, San Francisco, California 94105, United States",
        lat: 37.7935,
        lng: -122.396,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips the network for a blank query", async () => {
    const fetchImpl = vi.fn();
    const provider = createMapboxGeocoding({ token: "pk.live-token-for-tests-xxxxxxxxxxxxxxxx", fetchImpl });
    await expect(provider.suggest("")).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createDuffelPlaceSuggestions } from "./real";

const DUFFEL_BODY = {
  data: [
    {
      type: "city",
      iata_code: "LIS",
      name: "Lisbon",
      latitude: 38.7223,
      longitude: -9.1393,
      airports: [{ iata_code: "LIS", name: "Humberto Delgado Airport", latitude: 38.7742, longitude: -9.1342 }],
    },
    {
      type: "airport",
      iata_code: "LHR",
      name: "Heathrow",
      city_name: "London",
      latitude: 51.47,
      longitude: -0.4543,
      airports: [],
    },
  ],
};

describe("Duffel place suggestions provider", () => {
  it("calls Places Suggestions with the test token and Duffel-Version v2", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.duffel.com/places/suggestions?query=lis");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer duffel_test_abc");
      expect(headers.get("Duffel-Version")).toBe("v2");
      expect(headers.get("Accept")).toBe("application/json");
      return new Response(JSON.stringify(DUFFEL_BODY), { status: 200 });
    });

    const provider = createDuffelPlaceSuggestions({ token: "duffel_test_abc", fetchImpl });
    const results = await provider.suggest("lis");

    expect(results).toEqual([
      {
        kind: "city",
        name: "Lisbon",
        iataCode: "LIS",
        lat: 38.7223,
        lng: -9.1393,
        airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport", lat: 38.7742, lng: -9.1342 }],
      },
      {
        kind: "airport",
        name: "Heathrow",
        cityName: "London",
        iataCode: "LHR",
        lat: 51.47,
        lng: -0.4543,
        airports: [{ iataCode: "LHR", name: "Heathrow" }],
      },
    ]);
  });

  it("skips the network for a blank query", async () => {
    const fetchImpl = vi.fn();
    const provider = createDuffelPlaceSuggestions({ token: "duffel_test_abc", fetchImpl });
    await expect(provider.suggest("")).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

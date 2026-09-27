import { describe, expect, it } from "vitest";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";
import { stayAreaForPlace } from "./place-point";

const tokyo: PlaceSuggestion = {
  kind: "city",
  name: "Tokyo",
  iataCode: "TYO",
  lat: null,
  lng: null,
  airports: [
    { iataCode: "HND", name: "Haneda", lat: 35.5494, lng: 139.7798 },
    { iataCode: "NRT", name: "Narita", lat: 35.772, lng: 140.3929 },
  ],
};

const atlanta: PlaceSuggestion = {
  kind: "city",
  name: "Atlanta",
  iataCode: "ATL",
  lat: 33.6407,
  lng: -84.4277,
  airports: [{ iataCode: "ATL", name: "Hartsfield-Jackson" }],
};

describe("stayAreaForPlace", () => {
  it("searches a city that already has coordinates within 5 km", () => {
    const area = stayAreaForPlace(
      { label: "Tokyo", iata: "TYO" },
      [{ ...tokyo, lat: 35.6762, lng: 139.6503 }, atlanta],
    );
    expect(area).toEqual({ lat: 35.6762, lng: 139.6503, radiusKm: 5 });
  });

  it("covers Tokyo from its airports when the city has no coordinates", () => {
    const area = stayAreaForPlace({ label: "Tokyo", iata: "TYO" }, [tokyo, atlanta]);
    expect(area).not.toBeNull();
    expect(area!.lat).toBeCloseTo(35.6607, 3);
    expect(area!.lng).toBeCloseTo(140.08635, 3);
    expect(area!.radiusKm).toBeGreaterThanOrEqual(20);
    expect(area!.radiusKm).toBeLessThanOrEqual(80);
  });

  it("uses airport suggestions that name the destination city", () => {
    const area = stayAreaForPlace({ label: "Tokyo", iata: "TYO" }, [
      { ...tokyo, airports: [{ iataCode: "HND", name: "Haneda" }, { iataCode: "NRT", name: "Narita" }] },
      {
        kind: "airport",
        name: "Haneda",
        cityName: "Tokyo",
        iataCode: "HND",
        lat: 35.5494,
        lng: 139.7798,
        airports: [],
      },
      {
        kind: "airport",
        name: "Narita",
        cityName: "Tokyo",
        iataCode: "NRT",
        lat: 35.772,
        lng: 140.3929,
        airports: [],
      },
    ]);
    expect(area!.lat).toBeCloseTo(35.6607, 3);
    expect(area!.lng).toBeCloseTo(140.08635, 3);
  });

  it("returns null when the destination cannot be placed", () => {
    expect(stayAreaForPlace({ label: "Tokyo", iata: "TYO" }, [atlanta])).toBeNull();
  });
});

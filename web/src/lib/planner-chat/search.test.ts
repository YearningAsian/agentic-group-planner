import { describe, expect, it, vi } from "vitest";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";
import type { StayCard } from "@/lib/providers/stays/types";
import { executeFlightSearch, executeHotelSearch, flightModelText, hotelModelText, noteStayArea, stayAreaModelText } from "./search";
import { FLIGHT_UNAVAILABLE, HOTEL_UNAVAILABLE } from "./types";

const miami: PlaceSuggestion = {
  kind: "city",
  name: "Miami",
  iataCode: "MIA",
  airports: [{ iataCode: "MIA", name: "Miami International" }],
  lat: 25.76,
  lng: -80.19,
};

const stay: StayCard = {
  id: "acc_1",
  name: "The Example Hotel",
  image: null,
  area: "South Beach",
  guestScore: 8.8,
  reviewCount: 10,
  starRating: 4,
  nightlyAmount: 179,
  totalAmount: 537,
  currency: "USD",
  amenities: ["Pool", "Wi-Fi"],
};

describe("planner travel search", () => {
  it("does not search hotels when Duffel is not configured", async () => {
    const result = await executeHotelSearch(
      { destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2 },
      {},
    );
    expect(result).toEqual({ ok: false, error: HOTEL_UNAVAILABLE });
  });

  it("searches the named city when other cities are also suggested", async () => {
    const search = vi.fn(async () => [stay]);
    const other: PlaceSuggestion = { ...miami, name: "Miami Beach", iataCode: "FLL", lat: 26.1, lng: -80.1 };
    const result = await executeHotelSearch(
      { destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2, rooms: 2 },
      {
        duffelToken: "duffel_test_abc",
        places: { suggest: async () => [miami, other] },
        stays: { search } as never,
      },
    );
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ lat: 25.76, lng: -80.19, radiusKm: 5 }));
    expect(result).toMatchObject({ ok: true, area: { label: "Miami", lat: 25.76, lng: -80.19 } });
  });

  it("does not search when the destination cannot be placed", async () => {
    const search = vi.fn();
    const result = await executeHotelSearch(
      { destination: "Tokyo", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2 },
      {
        duffelToken: "duffel_test_abc",
        places: { suggest: async () => [miami] },
        stays: { search } as never,
      },
    );
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "I couldn't find a stay area for Tokyo." });
  });

  it("searches from airports when the city has no coordinates", async () => {
    const search = vi.fn(async () => [stay]);
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
    const result = await executeHotelSearch(
      { destination: "Tokyo", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2 },
      {
        duffelToken: "duffel_test_abc",
        places: { suggest: async () => [tokyo] },
        stays: { search } as never,
      },
    );
    expect(search).toHaveBeenCalledTimes(1);
    const area = search.mock.calls[0]?.[0] as { lat: number; lng: number; radiusKm: number };
    expect(area.lat).toBeCloseTo(35.6607, 3);
    expect(area.lng).toBeCloseTo(140.08635, 3);
    expect(area.radiusKm).toBeGreaterThanOrEqual(20);
    expect(result).toMatchObject({ ok: true, area: { label: "Tokyo" } });
  });

  it("searches stays at the resolved coordinates and keeps Duffel fields", async () => {
    const search = vi.fn(async () => [stay]);
    const result = await executeHotelSearch(
      { destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2, rooms: 2 },
      {
        duffelToken: "duffel_test_abc",
        places: { suggest: async () => [miami] },
        stays: { search } as never,
      },
    );
    expect(search).toHaveBeenCalledWith({
      lat: 25.76,
      lng: -80.19,
      radiusKm: 5,
      checkIn: "2026-10-15",
      checkOut: "2026-10-19",
      adults: 2,
      rooms: 2,
    });
    expect(result).toEqual({
      ok: true,
      hotels: [
        {
          id: "acc_1",
          name: "The Example Hotel",
          location: "South Beach",
          image: null,
          pricePerNight: 179,
          totalPrice: 537,
          currency: "USD",
          rating: 8.8,
          amenities: ["Pool", "Wi-Fi"],
        },
      ],
      area: { label: "Miami", lat: 25.76, lng: -80.19 },
    });
  });

  it("resolves a stay area without searching hotels", async () => {
    const search = vi.fn();
    const result = await noteStayArea("Miami", {
      duffelToken: "duffel_test_abc",
      places: { suggest: async () => [miami] },
      stays: { search } as never,
    });
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, label: "Miami", lat: 25.76, lng: -80.19 });
  });

  it("passes airport codes through to flight search without asking places", async () => {
    const suggest = vi.fn(async () => [miami]);
    const search = vi.fn(async () => ({ flights: [] }));
    const result = await executeFlightSearch(
      { origin: "ATL", destination: "MIA", departureDate: "2026-10-15", travelers: 4 },
      { duffelToken: "duffel_test_abc", places: { suggest }, flights: { search } },
    );
    expect(suggest).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ origin: "ATL", destination: "MIA", travelers: 4 }));
    expect(result).toEqual({ ok: true, flights: [], note: "No flights matched that search." });
  });

  it("sends the model a short line instead of the full offer", () => {
    const text = flightModelText({
      ok: true,
      flights: [
        {
          airline: "Delta Air Lines",
          flightNumber: "DL123",
          origin: "ATL",
          destination: "MIA",
          departureTime: "2026-10-15T08:20:00",
          arrivalTime: "2026-10-15T10:05:00",
          stops: 0,
          price: 179,
          totalPrice: 179,
          currency: "USD",
        },
      ],
    });
    expect(text).toBe("DL123 Delta Air Lines ATL-MIA 08:20-10:05 0 stops USD 179");
    expect(text).not.toMatch(/2026-10-15|totalPrice|flightNumber/);
    expect(
      hotelModelText({
        ok: true,
        hotels: [
          {
            name: "The Example Hotel",
            location: "South Beach",
            pricePerNight: 179,
            totalPrice: 537,
            currency: "USD",
            rating: 8.8,
            amenities: ["Pool", "Wi-Fi", "Gym", "Spa", "Bar"],
          },
        ],
        area: { label: "Miami", lat: 25.761234, lng: -80.191234 },
      }),
    ).toBe("The Example Hotel South Beach USD 179/night USD 537 total score 8.8 Pool,Wi-Fi,Gym");
    expect(stayAreaModelText({ ok: true, label: "Miami", lat: 25.76, lng: -80.19 })).toBe("Miami");
  });

  it("reports a flight provider failure without the underlying error", async () => {
    const result = await executeFlightSearch(
      { origin: "Atlanta", destination: "Miami", departureDate: "2026-10-15", travelers: 2 },
      {
        duffelToken: "duffel_test_abc",
        places: { suggest: async () => [miami] },
        flights: { search: async () => Promise.reject(new Error("Bearer duffel_test_secret")) },
      },
    );
    expect(result).toEqual({ ok: false, error: FLIGHT_UNAVAILABLE });
  });
});

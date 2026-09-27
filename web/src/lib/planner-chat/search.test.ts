import { describe, expect, it } from "vitest";
import { bundledSampleCatalog } from "@/lib/demo/sample-catalog";
import { executeFlightSearch, executeHotelSearch, flightModelText, hotelModelText, noteStayArea, stayAreaModelText } from "./search";

describe("planner travel search", () => {
  it("returns the sample Miami fares, including a New York note when the origin is not New York", async () => {
    const result = await executeFlightSearch(
      { origin: "Atlanta", destination: "Miami", departureDate: "2026-10-15", travelers: 2 },
      { catalog: bundledSampleCatalog },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBe("Sample fares are round-trip from New York.");
    expect(result.flights.map((flight) => flight.airline)).toEqual(["Mariner", "Cedar Air", "Lumen"]);
    expect(result.flights[0]).toMatchObject({
      origin: "JFK",
      destination: "MIA",
      departureTime: "2026-10-15T08:05:00",
      stops: 0,
      price: 196,
      currency: "USD",
    });
  });

  it("omits the New York note when the trip already starts there", async () => {
    const result = await executeFlightSearch(
      { origin: "JFK", destination: "LIS", departureDate: "2026-10-15", travelers: 1 },
      { catalog: bundledSampleCatalog },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBeUndefined();
    expect(result.flights[0]?.destination).toBe("LIS");
  });

  it("keeps only nonstop sample fares when asked", async () => {
    const result = await executeFlightSearch(
      { origin: "New York", destination: "Miami", departureDate: "2026-10-15", travelers: 1, nonstop: true },
      { catalog: bundledSampleCatalog },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.flights.every((flight) => flight.stops === 0)).toBe(true);
    expect(result.flights.map((flight) => flight.airline)).toEqual(["Mariner", "Lumen"]);
  });

  it("returns the sample Miami stays and the city pin", async () => {
    const result = await executeHotelSearch(
      { destination: "Miami", checkIn: "2026-10-15", checkOut: "2026-10-18", guests: 2 },
      { catalog: bundledSampleCatalog },
    );
    expect(result).toMatchObject({
      ok: true,
      area: { label: "Miami", lat: 25.7617, lng: -80.1918 },
    });
    if (!result.ok) return;
    expect(result.hotels.map((hotel) => hotel.name)).toEqual([
      "South Beach studio",
      "Wynwood loft",
      "Coconut Grove rooms",
    ]);
    expect(result.hotels[2]).toMatchObject({
      id: "miami-stay-2",
      location: "Coconut Grove",
      pricePerNight: 210,
      totalPrice: 630,
      currency: "USD",
      rating: 4.9,
    });
  });

  it("does not invent stays for a city outside the catalog", async () => {
    const result = await executeHotelSearch(
      { destination: "Nowhere", checkIn: "2026-10-15", checkOut: "2026-10-19", guests: 2 },
      { catalog: bundledSampleCatalog },
    );
    expect(result).toEqual({ ok: false, error: "I couldn't find a stay area for Nowhere." });
  });

  it("resolves a stay area from the catalog without prices", async () => {
    const result = await noteStayArea("Miami", { catalog: bundledSampleCatalog });
    expect(result).toEqual({ ok: true, label: "Miami", lat: 25.7617, lng: -80.1918 });
  });

  it("sends the model a short line instead of the full offer", () => {
    const text = flightModelText({
      ok: true,
      flights: [
        {
          airline: "Mariner",
          origin: "JFK",
          destination: "MIA",
          departureTime: "2026-10-15T08:05:00",
          arrivalTime: "2026-10-15T11:15:00",
          stops: 0,
          price: 196,
          totalPrice: 196,
          currency: "USD",
        },
      ],
    });
    expect(text).toBe("Mariner JFK-MIA 08:05-11:15 0 stops USD 196");
    expect(
      hotelModelText({
        ok: true,
        hotels: [
          {
            name: "South Beach studio",
            location: "South Beach",
            pricePerNight: 176,
            totalPrice: 528,
            currency: "USD",
            rating: 4.81,
            amenities: [],
          },
        ],
        area: { label: "Miami", lat: 25.7617, lng: -80.1918 },
      }),
    ).toBe("South Beach studio South Beach USD 176/night USD 528 total score 4.81");
    expect(stayAreaModelText({ ok: true, label: "Miami", lat: 25.76, lng: -80.19 })).toBe("Miami");
  });
});

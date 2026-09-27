import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();
const suggest = vi.fn();

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ DUFFEL_ACCESS_TOKEN: "duffel_test_token" }),
}));

vi.mock("@/lib/providers/stays", async () => {
  const { stayAreaForPlace } = await import("@/lib/providers/stays/place-point");
  return {
    createDuffelStays: () => ({ search }),
    stayAreaForPlace,
  };
});

vi.mock("@/lib/providers/place-suggestions", () => ({
  createDuffelPlaceSuggestions: () => ({ suggest }),
}));

describe("GET /api/stays/search", () => {
  beforeEach(() => {
    search.mockReset();
    suggest.mockReset();
  });

  it("asks for dates instead of searching when the range is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/stays/search?destinationId=lisbon"));
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects an unknown destination", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=not-a-city&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("searches the fixture city's coordinates within 5 km", async () => {
    search.mockResolvedValue([{ id: "acc_1", name: "Duffel Test Hotel" }]);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=lisbon&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      lat: 38.7223,
      lng: -9.1393,
      radiusKm: 5,
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 2,
    });
    await expect(response.json()).resolves.toEqual({ stays: [{ id: "acc_1", name: "Duffel Test Hotel" }] });
  });

  it("says stays are unavailable when Duffel rejects the search", async () => {
    search.mockRejectedValue(new Error("HTTP 403"));
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=lisbon&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Stays are unavailable right now." },
    });
  });

  it("searches the preferred stay coordinates instead of the fixture city", async () => {
    search.mockResolvedValue([{ id: "acc_2", name: "Alfama House" }]);
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/stays/search?lat=38.71&lng=-9.13&label=Alfama&checkIn=2026-06-01&checkOut=2026-06-04&adults=2",
      ),
    );
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ lat: 38.71, lng: -9.13 }));
  });

  it("looks up the trip destination through Duffel when it has no coordinates", async () => {
    suggest.mockResolvedValue([
      {
        kind: "city",
        name: "Tokyo",
        iataCode: "TYO",
        lat: null,
        lng: null,
        airports: [
          { iataCode: "HND", name: "Haneda", lat: 35.5494, lng: 139.7798 },
          { iataCode: "NRT", name: "Narita", lat: 35.772, lng: 140.3929 },
        ],
      },
      {
        kind: "city",
        name: "Atlanta",
        iataCode: "ATL",
        lat: 33.6407,
        lng: -84.4277,
        airports: [],
      },
    ]);
    search.mockResolvedValue([{ id: "acc_tyo", name: "Park Hyatt Tokyo" }]);
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/stays/search?place=Tokyo&iata=TYO&checkIn=2026-06-01&checkOut=2026-06-04&adults=2",
      ),
    );
    expect(response.status).toBe(200);
    expect(suggest).toHaveBeenCalledWith("Tokyo");
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: expect.closeTo(35.6607, 3),
        lng: expect.closeTo(140.08635, 3),
        checkIn: "2026-06-01",
        checkOut: "2026-06-04",
        adults: 2,
      }),
    );
    const radiusKm = search.mock.calls[0][0].radiusKm as number;
    expect(radiusKm).toBeGreaterThan(5);
    await expect(response.json()).resolves.toEqual({ stays: [{ id: "acc_tyo", name: "Park Hyatt Tokyo" }] });
  });
});

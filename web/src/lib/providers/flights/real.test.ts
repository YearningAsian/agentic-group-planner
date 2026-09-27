import { describe, expect, it, vi } from "vitest";
import { createDuffelFlights, normalizeOffer } from "./real";

const OFFER = {
  total_amount: "368.00",
  total_currency: "USD",
  owner: { name: "Delta Air Lines", iata_code: "DL" },
  slices: [
    {
      duration: "PT1H58M",
      origin: { iata_code: "ATL" },
      destination: { iata_code: "MIA" },
      segments: [
        {
          departing_at: "2026-10-15T08:20:00",
          arriving_at: "2026-10-15T10:18:00",
          marketing_carrier: { iata_code: "DL", name: "Delta Air Lines" },
          marketing_carrier_flight_number: "1234",
        },
      ],
    },
    {
      duration: "PT2H4M",
      origin: { iata_code: "MIA" },
      destination: { iata_code: "ATL" },
      segments: [
        {
          departing_at: "2026-10-19T16:10:00",
          arriving_at: "2026-10-19T18:14:00",
          marketing_carrier: { iata_code: "DL", name: "Delta Air Lines" },
          marketing_carrier_flight_number: "4321",
        },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Duffel flights provider", () => {
  it("creates an offer request and normalizes the offer", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.duffel.com/air/offer_requests");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer duffel_test_abc");
      expect(headers.get("Duffel-Version")).toBe("v2");
      const body = JSON.parse(String(init?.body)) as {
        data: {
          cabin_class: string;
          max_connections: number;
          passengers: { type: string }[];
          slices: { origin: string; destination: string; departure_date: string; departure_time?: { from: string } }[];
        };
      };
      expect(body.data.cabin_class).toBe("economy");
      expect(body.data.max_connections).toBe(0);
      expect(body.data.passengers).toEqual([{ type: "adult" }, { type: "adult" }]);
      expect(body.data.slices[0]).toMatchObject({
        origin: "ATL",
        destination: "MIA",
        departure_date: "2026-10-15",
        departure_time: { from: "06:00", to: "12:00" },
      });
      expect(body.data.slices[1]).toMatchObject({ origin: "MIA", destination: "ATL", departure_date: "2026-10-19" });
      return jsonResponse({ data: { offers: [OFFER] } });
    });

    const provider = createDuffelFlights({ token: "duffel_test_abc", fetchImpl });
    const result = await provider.search({
      origin: "ATL",
      destination: "MIA",
      departureDate: "2026-10-15",
      returnDate: "2026-10-19",
      travelers: 2,
      cabinClass: "economy",
      nonstop: true,
      departureTimeFrom: "06:00",
      departureTimeTo: "12:00",
      airline: "Delta",
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.flights).toEqual([
      {
        airline: "Delta Air Lines",
        flightNumber: "DL1234",
        origin: "ATL",
        destination: "MIA",
        departureTime: "2026-10-15T08:20:00",
        arrivalTime: "2026-10-15T10:18:00",
        duration: "PT1H58M",
        stops: 0,
        price: 184,
        totalPrice: 368,
        currency: "USD",
        returnDepartureTime: "2026-10-19T16:10:00",
        returnArrivalTime: "2026-10-19T18:14:00",
      },
    ]);
  });

  it("drops an offer that has no price", () => {
    expect(normalizeOffer({ owner: { name: "Delta Air Lines" }, slices: [] }, 1)).toBeNull();
  });

  it("searches again without the nonstop limit when that search is empty", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { data: { max_connections?: number } };
      if (body.data.max_connections === 0) return jsonResponse({ data: { offers: [] } });
      return jsonResponse({
        data: {
          offers: [
            {
              ...OFFER,
              slices: [
                {
                  ...OFFER.slices[0],
                  segments: [
                    OFFER.slices[0].segments[0],
                    {
                      departing_at: "2026-10-15T11:00:00",
                      arriving_at: "2026-10-15T13:00:00",
                      marketing_carrier: { iata_code: "DL", name: "Delta Air Lines" },
                      marketing_carrier_flight_number: "99",
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
    });

    const result = await createDuffelFlights({ token: "duffel_test_abc", fetchImpl }).search({
      origin: "ATL",
      destination: "MIA",
      departureDate: "2026-10-15",
      travelers: 1,
      nonstop: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.note).toMatch(/nonstop/i);
    expect(result.flights[0]?.stops).toBe(1);
    expect(result.flights[0]?.flightNumber).toBe("DL1234, DL99");
  });
});

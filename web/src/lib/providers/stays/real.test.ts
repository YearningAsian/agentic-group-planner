import { describe, expect, it, vi } from "vitest";
import { createDuffelStays } from "./real";

const ACCOMMODATION = {
  id: "acc_test_hotel",
  name: "Duffel Test Hotel",
  description: "A test hotel.",
  photos: [{ url: "https://assets.duffel.com/img/stays/image.jpg" }],
  amenities: [{ type: "parking", description: "Parking" }, { type: "wifi", description: "Wi-Fi" }],
  location: {
    geographic_coordinates: { latitude: 51.5071, longitude: -0.1416 },
    address: {
      line_one: "100 Clifton Street",
      city_name: "London",
      region: "England",
      postal_code: "EC2A 4TP",
      country_code: "GB",
    },
  },
  review_score: 8.8,
  review_count: 336,
  rating: 4,
  brand: { id: "bra_1", name: "Duffel Test" },
  chain: { id: "chn_1", name: "Accor Hotels" },
  check_in_information: { check_in_after_time: "14:30", check_out_before_time: "11:30" },
  rooms: [] as unknown[],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Duffel stays provider", () => {
  it("searches by coordinates and maps the cheapest total into a nightly card", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.duffel.com/stays/search");
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer duffel_test_abc");
      expect(headers.get("Duffel-Version")).toBe("v2");
      const body = JSON.parse(String(init?.body)) as { data: { location: { radius: number }; guests: unknown[] } };
      expect(body.data.location.radius).toBe(5);
      expect(body.data.guests).toHaveLength(2);
      return jsonResponse({
        data: {
          results: [
            {
              id: "srr_1",
              check_in_date: "2026-06-01",
              check_out_date: "2026-06-04",
              cheapest_rate_total_amount: "300.00",
              cheapest_rate_currency: "GBP",
              accommodation: ACCOMMODATION,
            },
          ],
        },
      });
    });

    const provider = createDuffelStays({ token: "duffel_test_abc", fetchImpl });
    const cards = await provider.search({
      lat: 51.5071,
      lng: -0.1416,
      radiusKm: 5,
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 2,
    });

    expect(cards).toEqual([
      {
        id: "acc_test_hotel",
        name: "Duffel Test Hotel",
        image: "https://assets.duffel.com/img/stays/image.jpg",
        area: "London",
        guestScore: 8.8,
        reviewCount: 336,
        starRating: 4,
        nightlyAmount: 100,
        currency: "GBP",
      },
    ]);
  });

  it("loads accommodation details and hides a missing record", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/acc_missing")) return jsonResponse({ errors: [] }, 404);
      return jsonResponse({ data: ACCOMMODATION });
    });
    const provider = createDuffelStays({ token: "duffel_test_abc", fetchImpl });
    const stay = await provider.getAccommodation("acc_test_hotel");
    expect(stay).toMatchObject({
      name: "Duffel Test Hotel",
      brandName: "Duffel Test",
      chainName: "Accor Hotels",
      guestScore: 8.8,
      starRating: 4,
      address: { cityName: "London", lineOne: "100 Clifton Street" },
      amenities: [
        { type: "parking", description: "Parking" },
        { type: "wifi", description: "Wi-Fi" },
      ],
    });
    await expect(provider.getAccommodation("acc_missing")).resolves.toBeNull();
  });

  it("fetches all rates when the search omits room rates", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/stays/search")) {
        return jsonResponse({
          data: {
            results: [
              {
                id: "srr_1",
                cheapest_rate_total_amount: "799.00",
                cheapest_rate_currency: "GBP",
                accommodation: { ...ACCOMMODATION, rooms: [] },
              },
            ],
          },
        });
      }
      expect(url).toBe("https://api.duffel.com/stays/search_results/srr_1/actions/fetch_all_rates");
      expect(init?.method).toBe("POST");
      return jsonResponse({
        data: {
          id: "srr_1",
          cheapest_rate_total_amount: "799.00",
          cheapest_rate_currency: "GBP",
          accommodation: {
            ...ACCOMMODATION,
            rooms: [
              {
                name: "Double Suite",
                beds: [{ type: "king", count: 2 }],
                photos: [{ url: "https://assets.duffel.com/img/stays/room.jpg" }],
                rates: [
                  {
                    name: "Best Available Rate",
                    total_amount: "799.00",
                    total_currency: "GBP",
                    board_type: "room_only",
                    payment_type: "pay_now",
                    cancellation_timeline: [{ refund_amount: "799.00", currency: "GBP", before: "2026-05-01T13:00:00Z" }],
                  },
                ],
              },
            ],
          },
        },
      });
    });

    const provider = createDuffelStays({ token: "duffel_test_abc", fetchImpl });
    const rates = await provider.getRates({
      accommodationId: "acc_test_hotel",
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rates?.totalAmount).toBe("799.00");
    expect(rates?.rooms[0]).toMatchObject({
      name: "Double Suite",
      beds: [{ type: "king", count: 2 }],
      cancellationTimeline: [{ refundAmount: "799.00", currency: "GBP", before: "2026-05-01T13:00:00Z" }],
    });
  });

  it("reads guest review text from the reviews endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: {
          reviews: [
            {
              text: "Excellent facilities.",
              score: 8.4,
              reviewer_name: "Bessie Coleman",
              created_at: "2025-01-01",
            },
          ],
        },
      }),
    );
    const provider = createDuffelStays({ token: "duffel_test_abc", fetchImpl });
    await expect(provider.getReviews("acc_test_hotel")).resolves.toEqual([
      { text: "Excellent facilities.", score: 8.4, reviewerName: "Bessie Coleman", createdAt: "2025-01-01" },
    ]);
  });
});

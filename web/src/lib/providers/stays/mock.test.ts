import { describe, expect, it } from "vitest";
import { mockStaysProvider, stayCardsForDestination } from "./mock";

const LISBON = { lat: 38.7223, lng: -9.1393 };

describe("mock stays provider", () => {
  it("returns fixture cards for the destination nearest the search coordinates", async () => {
    const cards = await mockStaysProvider.search({
      ...LISBON,
      radiusKm: 5,
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 2,
    });
    expect(cards.map((card) => card.name)).toEqual(["Alfama townhouse", "Tile-roof flat", "River-view loft"]);
    expect(cards[0]).toMatchObject({
      id: "lisbon-stay-0",
      area: "Alfama",
      guestScore: 4.94,
      reviewCount: 186,
      nightlyAmount: 168,
      currency: "USD",
      starRating: null,
    });
  });

  it("returns an empty list when the coordinates match no fixture city", async () => {
    const cards = await mockStaysProvider.search({
      lat: 0,
      lng: 0,
      radiusKm: 5,
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 1,
    });
    expect(cards).toEqual([]);
  });

  it("loads a fixture stay by id, including a stay total for the requested nights", async () => {
    const stay = await mockStaysProvider.getAccommodation("lisbon-stay-1");
    expect(stay?.name).toBe("Tile-roof flat");
    expect(stay?.address.cityName).toBe("Lisbon");
    const rates = await mockStaysProvider.getRates({
      accommodationId: "lisbon-stay-1",
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 1,
    });
    expect(rates?.totalAmount).toBe("372.00");
    expect(rates?.rooms[0]?.beds).toEqual([{ type: "double", count: 1 }]);
    await expect(mockStaysProvider.getReviews("lisbon-stay-1")).resolves.toEqual([]);
    expect(stayCardsForDestination("lisbon")).toHaveLength(3);
  });

  it("returns null for an unknown accommodation", async () => {
    await expect(mockStaysProvider.getAccommodation("acc_missing")).resolves.toBeNull();
    await expect(
      mockStaysProvider.getRates({
        accommodationId: "acc_missing",
        checkIn: "2026-06-01",
        checkOut: "2026-06-04",
        adults: 1,
      }),
    ).resolves.toBeNull();
  });
});

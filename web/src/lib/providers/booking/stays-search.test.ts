import { describe, expect, it } from "vitest";
import { createMockStaysSearch, nightsBetween, selectStaysSearch } from "./stays-search";

const midtown = { lat: 33.7812, lng: -84.3857 };

describe("hotel search", () => {
  it("the mock returns the nearest hotels first, priced per guest for every night", async () => {
    const search = createMockStaysSearch();
    const one = await search.search({ near: midtown, checkIn: "2026-09-26T22:00:00Z", checkOut: "2026-09-27T15:00:00Z", guests: 4, maxResults: 3 });
    expect(one).toHaveLength(3);
    expect(one[0]).toMatchObject({ providerPlaceId: "stays_mock:midtown-commons:1n", name: "Midtown Commons Hotel", pricePerGuestCents: 11900 });
    const distances = one.map((h) => h.distanceKm);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));

    const two = await search.search({ near: midtown, checkIn: "2026-09-26T22:00:00Z", checkOut: "2026-09-28T15:00:00Z", guests: 4, maxResults: 1 });
    expect(two[0]).toMatchObject({ providerPlaceId: "stays_mock:midtown-commons:2n", pricePerGuestCents: 23800 });
  });

  it("the same search gives the same hotels", async () => {
    const input = { near: midtown, checkIn: "2026-09-26T22:00:00Z", checkOut: "2026-09-27T15:00:00Z", guests: 2, maxResults: 5 };
    expect(await createMockStaysSearch().search(input)).toEqual(await createMockStaysSearch().search(input));
  });

  it("nightsBetween counts calendar nights in UTC, at least one", () => {
    expect(nightsBetween("2026-09-26T22:00:00Z", "2026-09-27T15:00:00Z")).toBe(1);
    expect(nightsBetween("2026-09-26T15:00:00Z", "2026-09-27T16:00:00Z")).toBe(1);
    expect(nightsBetween("2026-09-26T22:00:00Z", "2026-09-28T10:00:00Z")).toBe(2);
    expect(nightsBetween("2026-09-26T22:00:00Z", "2026-09-26T23:00:00Z")).toBe(1);
  });

  it("live hotel search waits for Duffel Stays access", async () => {
    await expect(
      selectStaysSearch({ STAYS_PROVIDER: "real" }).search({ near: midtown, checkIn: "2026-09-26T22:00:00Z", checkOut: "2026-09-27T15:00:00Z", guests: 1, maxResults: 1 }),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: false });
    expect(selectStaysSearch({ STAYS_PROVIDER: "mock" }).id).toBe("stays_mock");
  });
});

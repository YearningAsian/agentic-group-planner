import { describe, expect, it, vi } from "vitest";
import { createDuffelStaysSearch, createMockStaysSearch, nightsBetween, selectStaysSearch } from "./stays-search";

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

  it("live hotel search expands a result, then offers an eligible rate with its ID and expiry", async () => {
    const client = {
      search: vi.fn(async () => ({ data: { results: [{
        id: "srr_1", check_in_date: "2026-10-03", check_out_date: "2026-10-05", expires_at: "2026-10-01T15:00:00Z",
        guests: [{ type: "adult" }, { type: "adult" }, { type: "adult" }],
        accommodation: { id: "acc_1", name: "Test Hotel", rating: 4, location: {
          geographic_coordinates: { latitude: -24.38, longitude: -128.32 },
          address: { line_one: "1 Test Road", city_name: "Test Island" },
        } },
      }] } })),
      searchResults: { fetchAllRates: vi.fn(async () => ({ data: {
        id: "srr_1", check_in_date: "2026-10-03", check_out_date: "2026-10-05", expires_at: "2026-10-01T15:00:00Z",
        guests: [{ type: "adult" }, { type: "adult" }, { type: "adult" }],
        accommodation: { id: "acc_1", name: "Test Hotel", rating: 4, location: {
          geographic_coordinates: { latitude: -24.38, longitude: -128.32 },
          address: { line_one: "1 Test Road", city_name: "Test Island" },
        }, rooms: [{ rates: [
          { id: "rat_pay_later", total_amount: "90.00", total_currency: "USD", payment_type: "guarantee", available_payment_methods: ["card"], due_at_accommodation_amount: "90.00", loyalty_programme_required: false },
          { id: "rat_good", total_amount: "120.01", total_currency: "USD", payment_type: "pay_now", available_payment_methods: ["balance"], due_at_accommodation_amount: "0.00", loyalty_programme_required: false, expires_at: "2026-10-01T14:00:00Z" },
        ] }] },
      } })) },
    };
    const input = { near: { lat: -24.38, lng: -128.32 }, checkIn: "2026-10-03T22:00:00Z", checkOut: "2026-10-05T15:00:00Z", guests: 3, maxResults: 1 };
    const offers = await createDuffelStaysSearch({ client: client as never, now: () => Date.parse("2026-09-26T12:00:00Z") }).search(input);
    expect(offers).toEqual([expect.objectContaining({
      providerPlaceId: "srr_1:rat_good", rateId: "rat_good", name: "Test Hotel",
      pricePerGuestCents: 4001, totalCents: 12001, expiresAt: "2026-10-01T14:00:00.000Z",
    })]);
    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({
      check_in_date: "2026-10-03", check_out_date: "2026-10-05", rooms: 1,
      guests: [{ type: "adult" }, { type: "adult" }, { type: "adult" }],
    }));
    expect(client.searchResults.fetchAllRates).toHaveBeenCalledWith("srr_1");
    expect(selectStaysSearch({ STAYS_PROVIDER: "mock" }).id).toBe("stays_mock");
  });

  it("one result's failure skips that hotel instead of discarding the others", async () => {
    const hotel = (id: string, rateId: string) => ({
      id, check_in_date: "2026-10-03", check_out_date: "2026-10-05", expires_at: "2026-10-01T15:00:00Z",
      guests: [{ type: "adult" }],
      accommodation: { id: `acc_${id}`, name: `Hotel ${id}`, rating: 4,
        location: { geographic_coordinates: { latitude: -24.38, longitude: -128.32 }, address: { line_one: "1 Test Road" } },
        rooms: [{ rates: [{ id: rateId, total_amount: "100.00", total_currency: "USD", payment_type: "pay_now",
          available_payment_methods: ["balance"], due_at_accommodation_amount: "0.00", loyalty_programme_required: false,
          expires_at: "2026-10-01T14:00:00Z" }] }] },
    });
    const client = {
      search: async () => ({ data: { results: [hotel("srr_1", "rat_1"), hotel("srr_2", "rat_2")] } }),
      searchResults: { fetchAllRates: async (id: string) => {
        if (id === "srr_1") throw Object.assign(new Error("result no longer available"), { status: 422 });
        return { data: hotel("srr_2", "rat_2") };
      } },
    };
    const search = createDuffelStaysSearch({ client: client as never, now: () => Date.parse("2026-09-26T12:00:00Z") });
    const offers = await search.search({ near: { lat: -24.38, lng: -128.32 }, checkIn: "2026-10-03", checkOut: "2026-10-05", guests: 1, maxResults: 2 });
    expect(offers.map((o) => o.rateId)).toEqual(["rat_2"]);
  });

  it("an access error stops the search as unavailable, not retryable", async () => {
    const client = {
      search: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); },
      searchResults: { fetchAllRates: async () => ({ data: {} }) },
    };
    const search = createDuffelStaysSearch({ client: client as never });
    await expect(search.search({ near: { lat: 0, lng: 0 }, checkIn: "2026-10-03", checkOut: "2026-10-05", guests: 1, maxResults: 1 }))
      .rejects.toMatchObject({ code: "provider_unavailable", retryable: false });
  });

  it("a request Duffel rejects outright isn't retryable", async () => {
    const client = {
      search: async () => { throw Object.assign(new Error("stay too long"), { status: 422 }); },
      searchResults: { fetchAllRates: async () => ({ data: {} }) },
    };
    const search = createDuffelStaysSearch({ client: client as never });
    await expect(search.search({ near: { lat: 0, lng: 0 }, checkIn: "2026-10-03", checkOut: "2026-10-05", guests: 1, maxResults: 1 }))
      .rejects.toMatchObject({ retryable: false });
  });

  it("expands at most twice as many results as it needs", async () => {
    const results = Array.from({ length: 6 }, (_, i) => ({ id: `srr_${i}`, accommodation: {
      location: { geographic_coordinates: { latitude: -24.38, longitude: -128.32 } } } }));
    const fetchAllRates = vi.fn(async () => { throw Object.assign(new Error("gone"), { status: 404 }); });
    const client = { search: async () => ({ data: { results } }), searchResults: { fetchAllRates } };
    const search = createDuffelStaysSearch({ client: client as never });
    await search.search({ near: { lat: -24.38, lng: -128.32 }, checkIn: "2026-10-03", checkOut: "2026-10-05", guests: 1, maxResults: 1 });
    expect(fetchAllRates).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rate with an invalid expiry", async () => {
    const result = {
      id: "srr_1", check_in_date: "2026-10-03", check_out_date: "2026-10-05", expires_at: "2026-10-01T15:00:00Z",
      guests: [{ type: "adult" }],
      accommodation: { id: "acc_1", name: "Test Hotel", rating: 4,
        location: { geographic_coordinates: { latitude: -24.38, longitude: -128.32 }, address: { line_one: "1 Test Road" } },
        rooms: [{ rates: [{ id: "rat_bad", total_amount: "120.00", total_currency: "USD", payment_type: "pay_now",
          available_payment_methods: ["balance"], due_at_accommodation_amount: "0.00", loyalty_programme_required: false,
          expires_at: "invalid" }] }],
      },
    };
    const client = { search: async () => ({ data: { results: [result] } }),
      searchResults: { fetchAllRates: async () => ({ data: result }) } };
    const search = createDuffelStaysSearch({ client: client as never, now: () => Date.parse("2026-09-26T12:00:00Z") });
    await expect(search.search({ near: { lat: -24.38, lng: -128.32 }, checkIn: "2026-10-03T22:00:00Z",
      checkOut: "2026-10-05T15:00:00Z", guests: 1, maxResults: 1 })).resolves.toEqual([]);
  });
});

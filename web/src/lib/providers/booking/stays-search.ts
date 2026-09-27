import "server-only";
import { decimalToCents } from "@agp/shared";
import { Duffel, DuffelError } from "@duffel/api";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { AppError, withPolicy } from "@/lib/reliability";

type DuffelSearchResult = Awaited<ReturnType<Duffel["stays"]["search"]>>["data"]["results"][number];
export interface DuffelStaysSearchClient {
  search: Duffel["stays"]["search"];
  searchResults: Pick<Duffel["stays"]["searchResults"], "fetchAllRates">;
}

const SEARCH_POLICY = { timeoutMs: 20_000, retries: 1 } as const;
const RATE_POLICY = { timeoutMs: 20_000, retries: 0 } as const;

export interface StayOffer {
  /** Unique per provider; the `places` cache key. */
  providerPlaceId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Null when the provider has no rating for the hotel, rather than zero stars. */
  rating: number | null;
  tags: string[];
  /** For every night of the stay, one guest's even share. */
  pricePerGuestCents: number;
  distanceKm: number;
  /** Only live Duffel offers carry a short-lived rate that can be quoted. */
  rateId?: string;
  totalCents?: number;
  expiresAt?: string;
}

export interface StaysSearch {
  readonly id: "stays_mock" | "duffel_stays";
  search(input: {
    near: { lat: number; lng: number };
    checkIn: string;
    checkOut: string;
    guests: number;
    maxResults: number;
  }): Promise<StayOffer[]>;
}

/** Calendar nights between check-in and check-out (UTC dates); a stay is at least one night. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const day = (iso: string) => {
    const d = new Date(iso);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return Math.max(1, Math.round((day(checkOut) - day(checkIn)) / 86_400_000));
}

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Fictional hotels around the seeded Atlanta trip; the nightly price is per guest.
const MOCK_HOTELS = [
  { key: "midtown-commons", name: "Midtown Commons Hotel", address: "1100 Peachtree St NE, Atlanta, GA", lat: 33.7852, lng: -84.3838, rating: 4.4, nightly: 11900, tags: ["walkable", "pool"] },
  { key: "peachtree-loft", name: "Peachtree Loft Inn", address: "800 Peachtree St NE, Atlanta, GA", lat: 33.7765, lng: -84.3843, rating: 4.1, nightly: 8900, tags: ["walkable", "budget"] },
  { key: "piedmont-garden", name: "Piedmont Garden Hotel", address: "1500 Piedmont Ave NE, Atlanta, GA", lat: 33.7925, lng: -84.3735, rating: 4.6, nightly: 15200, tags: ["parks", "quiet"] },
  { key: "ponce-park", name: "Ponce Park Suites", address: "650 Ponce De Leon Ave NE, Atlanta, GA", lat: 33.7727, lng: -84.3657, rating: 4.5, nightly: 13400, tags: ["food", "suites"] },
  { key: "centennial-plaza", name: "Centennial Plaza Hotel", address: "200 Centennial Olympic Park Dr, Atlanta, GA", lat: 33.7614, lng: -84.3931, rating: 4.0, nightly: 10500, tags: ["museums", "downtown"] },
  { key: "fourth-ward", name: "Old Fourth Ward Guesthouse", address: "500 Irwin St NE, Atlanta, GA", lat: 33.7596, lng: -84.3712, rating: 4.3, nightly: 7600, tags: ["budget", "beltline"] },
  { key: "castleberry", name: "Castleberry Rooms", address: "300 Peters St SW, Atlanta, GA", lat: 33.7494, lng: -84.4005, rating: 3.9, nightly: 6800, tags: ["budget", "art"] },
  { key: "buckhead-crest", name: "Buckhead Crest Hotel", address: "3300 Peachtree Rd NE, Atlanta, GA", lat: 33.8466, lng: -84.3673, rating: 4.7, nightly: 18900, tags: ["luxury", "shopping"] },
] as const;

/** The hotel mock (`STAYS_PROVIDER=mock`): a fixed list, nearest first, so every run finds the same hotels. */
export function createMockStaysSearch(): StaysSearch {
  return {
    id: "stays_mock",
    async search({ near, checkIn, checkOut, maxResults }) {
      const nights = nightsBetween(checkIn, checkOut);
      return MOCK_HOTELS.map((h) => ({
        providerPlaceId: `stays_mock:${h.key}:${nights}n`,
        name: h.name,
        address: h.address,
        lat: h.lat,
        lng: h.lng,
        rating: h.rating,
        tags: [...h.tags],
        pricePerGuestCents: h.nightly * nights,
        distanceKm: Math.round(distanceKm(near, h) * 10) / 10,
      }))
        .sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name))
        .slice(0, maxResults);
    },
  };
}

function eligibleRate(result: DuffelSearchResult, now: number) {
  const rates = result.accommodation?.rooms?.flatMap((room) => room.rates ?? []) ?? [];
  return rates.flatMap((rate) => {
    if (!rate.id || rate.total_currency !== "USD" || rate.payment_type !== "pay_now" ||
      !rate.available_payment_methods?.includes("balance") || rate.loyalty_programme_required ||
      (rate.quantity_available !== null && rate.quantity_available !== undefined && rate.quantity_available < 1) ||
      !(Date.parse(rate.expires_at) > now)) return [];
    try {
      if (rate.due_at_accommodation_amount && decimalToCents(rate.due_at_accommodation_amount) !== 0) return [];
      const cents = decimalToCents(rate.total_amount);
      return cents > 0 ? [{ rate, cents }] : [];
    } catch { return []; }
  }).sort((a, b) => a.cents - b.cents)[0];
}

/** An HTTP status from a Duffel error, whichever shape it arrived in. */
function statusOf(error: unknown): number | undefined {
  if (error instanceof DuffelError) return error.status ?? error.meta?.status;
  const status = (error as { status?: unknown; meta?: { status?: unknown } } | null)?.status ?? (error as { meta?: { status?: unknown } } | null)?.meta?.status;
  return typeof status === "number" ? status : undefined;
}

const accessDenied = (error: unknown) => statusOf(error) === 401 || statusOf(error) === 403;

/** Only a 429, a 5xx, or no answer at all is worth trying again; Duffel rejected anything else. */
function staysError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (accessDenied(error)) {
    throw new AppError("provider_unavailable", "Hotel search isn't available right now.", { retryable: false, cause: error });
  }
  const status = statusOf(error);
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    throw new AppError("provider_unavailable", "The hotel provider couldn't search these dates.", { retryable: false, cause: error });
  }
  throw new AppError("provider_unavailable", "Hotel search is unavailable. Try again.", { retryable: true, cause: error });
}

/** Searches Duffel Test Stays, then expands each result before selecting a bookable USD rate. */
export function createDuffelStaysSearch(options: { token?: string; client?: DuffelStaysSearchClient; now?: () => number }): StaysSearch {
  const client = options.client ?? (() => {
    if (!options.token?.startsWith("duffel_test_")) throw new AppError("internal", "A Duffel test token is required.", { retryable: false });
    return new Duffel({ token: options.token }).stays;
  })();
  const now = options.now ?? Date.now;
  return {
    id: "duffel_stays",
    async search({ near, checkIn, checkOut, guests, maxResults }) {
      if (!Number.isInteger(guests) || guests < 1 || guests > 9) {
        throw new AppError("invalid_input", "Hotel search needs one to nine guests.", { retryable: false });
      }
      const params = {
        check_in_date: checkIn.slice(0, 10), check_out_date: checkOut.slice(0, 10), rooms: 1,
        guests: Array.from({ length: guests }, () => ({ type: "adult" as const })),
        location: { radius: 5, geographic_coordinates: { latitude: near.lat, longitude: near.lng } },
      };
      let results: DuffelSearchResult[];
      try {
        ({ data: { results } } = await withPolicy(() => client.search(params), SEARCH_POLICY));
      } catch (error) { return staysError(error); }
      const offers: StayOffer[] = [];
      const nearby = results.filter((r) => r.id && r.accommodation?.location?.geographic_coordinates)
        .sort((a, b) => {
          const ac = a.accommodation.location.geographic_coordinates!;
          const bc = b.accommodation.location.geographic_coordinates!;
          return distanceKm(near, { lat: ac.latitude, lng: ac.longitude }) - distanceKm(near, { lat: bc.latitude, lng: bc.longitude });
        });
      // Each expansion is a call of its own, so stop after twice as many as the search needs.
      for (const result of nearby.slice(0, maxResults * 2)) {
        if (offers.length >= maxResults) break;
        let expanded: DuffelSearchResult;
        try {
          ({ data: expanded } = await withPolicy(() => client.searchResults.fetchAllRates(result.id), RATE_POLICY));
        } catch (error) {
          // A result can go stale between search and expansion; only lost access ends the search.
          if (accessDenied(error)) return staysError(error);
          continue;
        }
        if (expanded.id !== result.id || expanded.check_in_date !== params.check_in_date || expanded.check_out_date !== params.check_out_date ||
          expanded.guests.length !== guests) continue;
        const best = eligibleRate(expanded, now());
        const hotel = expanded.accommodation;
        const coords = hotel?.location?.geographic_coordinates;
        if (!best || !hotel?.id || !hotel.name || !coords || !(Date.parse(expanded.expires_at) > now())) continue;
        const address = hotel.location.address;
        const km = distanceKm(near, { lat: coords.latitude, lng: coords.longitude });
        offers.push({
          providerPlaceId: `${expanded.id}:${best.rate.id}`,
          rateId: best.rate.id,
          totalCents: best.cents,
          expiresAt: new Date(Math.min(Date.parse(expanded.expires_at), Date.parse(best.rate.expires_at))).toISOString(),
          name: hotel.name,
          address: [address?.line_one, address?.city_name, address?.region].filter(Boolean).join(", "),
          lat: coords.latitude, lng: coords.longitude,
          rating: hotel.rating ?? null,
          tags: [],
          pricePerGuestCents: Math.ceil(best.cents / guests),
          distanceKm: Math.round(km * 10) / 10,
        });
      }
      return offers;
    },
  };
}

export function selectStaysSearch(env: Pick<ServerEnv, "STAYS_PROVIDER"> & Partial<Pick<ServerEnv, "DUFFEL_ACCESS_TOKEN">>): StaysSearch {
  return env.STAYS_PROVIDER === "mock" ? createMockStaysSearch() : createDuffelStaysSearch({ token: env.DUFFEL_ACCESS_TOKEN });
}

export function getStaysSearch(): StaysSearch {
  return selectStaysSearch(getServerEnv());
}

import "server-only";
import { getServerEnv, type ServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";

export interface StayOffer {
  /** Unique per provider; the `places` cache key. */
  providerPlaceId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  tags: string[];
  /** For every night of the stay, one guest's even share. */
  pricePerGuestCents: number;
  distanceKm: number;
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

/** Whole nights between check-in and check-out, rounded up; a stay is at least one night. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const hours = (Date.parse(checkOut) - Date.parse(checkIn)) / 3_600_000;
  return Math.max(1, Math.ceil(hours / 24));
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
        providerPlaceId: `stays_mock:${h.key}`,
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

// Duffel's stays search answers 403 until the account has Stays access, and a Duffel option needs
// its rate_id carried through to quote(), which the places cache doesn't hold yet.
function blockedDuffelSearch(): StaysSearch {
  return {
    id: "duffel_stays",
    async search() {
      throw new AppError("provider_unavailable", "Live hotel search needs Duffel Stays access; use STAYS_PROVIDER=mock for now.", {
        retryable: false,
      });
    },
  };
}

export function selectStaysSearch(env: Pick<ServerEnv, "STAYS_PROVIDER">): StaysSearch {
  return env.STAYS_PROVIDER === "mock" ? createMockStaysSearch() : blockedDuffelSearch();
}

export function getStaysSearch(): StaysSearch {
  return selectStaysSearch(getServerEnv());
}

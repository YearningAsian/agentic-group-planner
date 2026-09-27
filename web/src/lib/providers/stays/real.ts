import { withPolicy } from "@/lib/reliability/with-policy";
import type {
  CancellationPoint,
  StayAccommodation,
  StayAddress,
  StayAmenity,
  StayBed,
  StayCard,
  StayPhoto,
  StayRates,
  StayReview,
  StayRoom,
  StaysProvider,
} from "./types";

// Duffel isolates test and live data. This adapter only accepts a duffel_test_ token
// (enforced in web/src/lib/env/server.ts). Never put a duffel_live_ token in DUFFEL_ACCESS_TOKEN.
const POLICY = { timeoutMs: 20_000, retries: 0 } as const;
const API = "https://api.duffel.com";

interface DuffelPhoto {
  url?: string;
}

interface DuffelAmenity {
  type?: string;
  description?: string;
}

interface DuffelAccommodation {
  id?: string;
  name?: string;
  description?: string | null;
  photos?: DuffelPhoto[];
  amenities?: DuffelAmenity[] | null;
  location?: {
    geographic_coordinates?: { latitude?: number; longitude?: number };
    address?: {
      line_one?: string | null;
      city_name?: string | null;
      region?: string | null;
      postal_code?: string | null;
      country_code?: string | null;
    };
  };
  review_score?: number | null;
  review_count?: number | null;
  rating?: number | null;
  brand?: { name?: string } | null;
  chain?: { name?: string } | null;
  check_in_information?: {
    check_in_after_time?: string | null;
    check_out_before_time?: string | null;
  } | null;
  rooms?: DuffelRoom[];
}

interface DuffelCancellation {
  refund_amount?: string;
  currency?: string;
  before?: string;
}

interface DuffelRate {
  name?: string;
  total_amount?: string;
  total_currency?: string;
  board_type?: string;
  payment_type?: string;
  cancellation_timeline?: DuffelCancellation[];
}

interface DuffelBed {
  type?: string;
  count?: number;
}

interface DuffelRoom {
  name?: string;
  beds?: DuffelBed[];
  photos?: DuffelPhoto[];
  rates?: DuffelRate[];
}

interface DuffelSearchResult {
  id?: string;
  check_in_date?: string;
  check_out_date?: string;
  cheapest_rate_total_amount?: string | null;
  cheapest_rate_currency?: string | null;
  accommodation?: DuffelAccommodation;
}

interface DuffelReview {
  text?: string;
  score?: number | null;
  reviewer_name?: string;
  created_at?: string;
}

export function createDuffelStays(opts: { token: string; fetchImpl?: typeof fetch }): StaysProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function duffel<T>(url: string, init: { method: string; body?: unknown }, signal: AbortSignal): Promise<T> {
    const response = await fetchImpl(url, {
      method: init.method,
      signal,
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    }
    return (await response.json()) as T;
  }

  return {
    async search(input) {
      const body = await withPolicy(
        (signal) =>
          duffel<{ data?: { results?: DuffelSearchResult[] } }>(
            `${API}/stays/search`,
            {
              method: "POST",
              body: {
                data: {
                  check_in_date: input.checkIn,
                  check_out_date: input.checkOut,
                  rooms: clampCount(input.rooms, 1),
                  guests: guests(input.adults),
                  location: {
                    radius: clampRadius(input.radiusKm),
                    geographic_coordinates: { latitude: input.lat, longitude: input.lng },
                  },
                },
              },
            },
            signal,
          ),
        POLICY,
      );
      return (body.data?.results ?? []).flatMap((result) => {
        const card = toCard(result);
        return card ? [card] : [];
      });
    },

    async getAccommodation(id) {
      try {
        const body = await withPolicy(
          (signal) =>
            duffel<{ data?: DuffelAccommodation }>(
              `${API}/stays/accommodation/${encodeURIComponent(id)}`,
              { method: "GET" },
              signal,
            ),
          POLICY,
        );
        return body.data ? toAccommodation(body.data) : null;
      } catch (error) {
        if (statusOf(error) === 404) return null;
        throw error;
      }
    },

    async getRates(input) {
      const searched = await withPolicy(
        (signal) =>
          duffel<{ data?: { results?: DuffelSearchResult[] } }>(
            `${API}/stays/search`,
            {
              method: "POST",
              body: {
                data: {
                  check_in_date: input.checkIn,
                  check_out_date: input.checkOut,
                  rooms: 1,
                  guests: guests(input.adults),
                  accommodation: { ids: [input.accommodationId], fetch_rates: true },
                },
              },
            },
            signal,
          ),
        POLICY,
      );
      let result = searched.data?.results?.[0];
      if (!result) return null;
      const searchResultId = result.id;
      if (roomsLackRates(result.accommodation?.rooms) && searchResultId) {
        const fetched = await withPolicy(
          (signal) =>
            duffel<{ data?: DuffelSearchResult }>(
              `${API}/stays/search_results/${encodeURIComponent(searchResultId)}/actions/fetch_all_rates`,
              { method: "POST", body: { data: {} } },
              signal,
            ),
          POLICY,
        );
        if (fetched.data) result = fetched.data;
      }
      return toRates(result);
    },

    async getReviews(id) {
      try {
        const body = await withPolicy(
          (signal) =>
            duffel<{ data?: { reviews?: DuffelReview[] } | DuffelReview[] }>(
              `${API}/stays/accommodation/${encodeURIComponent(id)}/reviews?limit=8`,
              { method: "GET" },
              signal,
            ),
          POLICY,
        );
        return reviewsFrom(body).flatMap((review) => {
          if (!review.text) return [];
          return [
            {
              text: review.text,
              score: numberOrNull(review.score),
              reviewerName: review.reviewer_name || "Anonymous",
              createdAt: review.created_at ?? "",
            } satisfies StayReview,
          ];
        });
      } catch (error) {
        if (statusOf(error) === 404) return [];
        throw error;
      }
    },
  };
}

function guests(adults: number): { type: "adult" }[] {
  const count = clampCount(adults, 1);
  return Array.from({ length: count }, () => ({ type: "adult" as const }));
}

function clampCount(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(9, Math.max(1, Math.floor(value)));
}

function clampRadius(radiusKm: number): number {
  if (!Number.isFinite(radiusKm)) return 5;
  return Math.min(100, Math.max(1, Math.round(radiusKm)));
}

function nightsBetween(checkIn: string | undefined, checkOut: string | undefined): number {
  if (!checkIn || !checkOut) return 1;
  const ms = Date.parse(`${checkOut}T12:00:00`) - Date.parse(`${checkIn}T12:00:00`);
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.round(ms / 86_400_000);
}

function toCard(result: DuffelSearchResult): StayCard | null {
  const accommodation = result.accommodation;
  if (!accommodation?.id || !accommodation.name) return null;
  const total = numberOrNull(result.cheapest_rate_total_amount);
  const nights = nightsBetween(result.check_in_date, result.check_out_date);
  return {
    id: accommodation.id,
    name: accommodation.name,
    image: photos(accommodation.photos)[0]?.url ?? null,
    area: accommodation.location?.address?.city_name ?? "",
    guestScore: numberOrNull(accommodation.review_score),
    reviewCount: numberOrNull(accommodation.review_count),
    starRating: starRating(accommodation.rating),
    nightlyAmount: total == null ? null : total / nights,
    totalAmount: total,
    currency: result.cheapest_rate_currency ?? null,
    amenities: amenities(accommodation.amenities).map((item) => item.description),
  };
}

function toAccommodation(raw: DuffelAccommodation): StayAccommodation | null {
  if (!raw.id || !raw.name) return null;
  const address = raw.location?.address;
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? null,
    photos: photos(raw.photos),
    amenities: amenities(raw.amenities),
    address: toAddress(address),
    lat: numberOrNull(raw.location?.geographic_coordinates?.latitude),
    lng: numberOrNull(raw.location?.geographic_coordinates?.longitude),
    guestScore: numberOrNull(raw.review_score),
    reviewCount: numberOrNull(raw.review_count),
    starRating: starRating(raw.rating),
    brandName: raw.brand?.name ?? null,
    chainName: raw.chain?.name ?? null,
    checkInAfter: raw.check_in_information?.check_in_after_time ?? null,
    checkOutBefore: raw.check_in_information?.check_out_before_time ?? null,
  };
}

function toAddress(address: NonNullable<DuffelAccommodation["location"]>["address"]): StayAddress {
  return {
    lineOne: address?.line_one ?? null,
    cityName: address?.city_name ?? null,
    region: address?.region ?? null,
    postalCode: address?.postal_code ?? null,
    countryCode: address?.country_code ?? null,
  };
}

function toRates(result: DuffelSearchResult): StayRates {
  return {
    searchResultId: result.id ?? null,
    totalAmount: result.cheapest_rate_total_amount ?? null,
    currency: result.cheapest_rate_currency ?? null,
    rooms: (result.accommodation?.rooms ?? []).map(toRoom),
  };
}

function toRoom(room: DuffelRoom): StayRoom {
  const rate = cheapestRate(room.rates ?? []);
  return {
    name: room.name ?? "Room",
    beds: beds(room.beds),
    photos: photos(room.photos),
    rateName: rate?.name ?? null,
    totalAmount: rate?.total_amount ?? null,
    currency: rate?.total_currency ?? null,
    boardType: rate?.board_type ?? null,
    paymentType: rate?.payment_type ?? null,
    cancellationTimeline: timeline(rate?.cancellation_timeline),
  };
}

function cheapestRate(rates: DuffelRate[]): DuffelRate | null {
  const priced = rates.filter((rate) => numberOrNull(rate.total_amount) != null);
  if (priced.length === 0) return rates[0] ?? null;
  return priced.reduce((best, rate) =>
    Number(rate.total_amount) < Number(best.total_amount) ? rate : best,
  );
}

function roomsLackRates(rooms: DuffelRoom[] | undefined): boolean {
  if (!rooms || rooms.length === 0) return true;
  return rooms.every((room) => !room.rates || room.rates.length === 0);
}

function photos(list: DuffelPhoto[] | undefined): StayPhoto[] {
  return (list ?? []).flatMap((photo) => (photo.url ? [{ url: photo.url }] : []));
}

function amenities(list: DuffelAmenity[] | null | undefined): StayAmenity[] {
  return (list ?? []).flatMap((item) => {
    if (!item.description) return [];
    return [{ type: item.type ?? "", description: item.description }];
  });
}

function beds(list: DuffelBed[] | undefined): StayBed[] {
  return (list ?? []).flatMap((bed) => {
    if (!bed.type || bed.count == null || bed.count < 1) return [];
    return [{ type: bed.type, count: bed.count }];
  });
}

function timeline(list: DuffelCancellation[] | undefined): CancellationPoint[] {
  return (list ?? []).flatMap((point) => {
    if (!point.refund_amount || !point.currency || !point.before) return [];
    return [{ refundAmount: point.refund_amount, currency: point.currency, before: point.before }];
  });
}

function reviewsFrom(body: { data?: { reviews?: DuffelReview[] } | DuffelReview[] }): DuffelReview[] {
  const data = body.data;
  if (Array.isArray(data)) return data;
  return data?.reviews ?? [];
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function starRating(value: number | null | undefined): number | null {
  const rating = numberOrNull(value);
  if (rating == null) return null;
  const stars = Math.round(rating);
  if (stars < 1 || stars > 5) return null;
  return stars;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export interface StayCard {
  id: string;
  name: string;
  image: string | null;
  /** City, or a fixture neighborhood when Duffel has no finer area. */
  area: string;
  /** Duffel `review_score`, 1–10. Null when the source has no guest score. */
  guestScore: number | null;
  reviewCount: number | null;
  /** Hotel class, 1–5. Not a guest score. */
  starRating: number | null;
  /** Cheapest stay total divided by nights. Null when Duffel has no rate. */
  nightlyAmount: number | null;
  /** Duffel `cheapest_rate_total_amount`. Null when Duffel has no rate. */
  totalAmount?: number | null;
  currency: string | null;
  /** Amenity descriptions from the accommodation. Omitted when the source lists none. */
  amenities?: string[];
}

export interface StaySearchInput {
  lat: number;
  lng: number;
  radiusKm: number;
  checkIn: string;
  checkOut: string;
  adults: number;
  /** Duffel `rooms`. Defaults to 1. */
  rooms?: number;
}

export interface StayPhoto {
  url: string;
}

export interface StayAmenity {
  type: string;
  description: string;
}

export interface StayAddress {
  lineOne: string | null;
  cityName: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
}

export interface StayAccommodation {
  id: string;
  name: string;
  description: string | null;
  photos: StayPhoto[];
  amenities: StayAmenity[];
  address: StayAddress;
  lat: number | null;
  lng: number | null;
  guestScore: number | null;
  reviewCount: number | null;
  starRating: number | null;
  brandName: string | null;
  chainName: string | null;
  checkInAfter: string | null;
  checkOutBefore: string | null;
}

export interface CancellationPoint {
  refundAmount: string;
  currency: string;
  before: string;
}

export interface StayBed {
  type: string;
  count: number;
}

export interface StayRoom {
  name: string;
  beds: StayBed[];
  photos: StayPhoto[];
  rateName: string | null;
  totalAmount: string | null;
  currency: string | null;
  boardType: string | null;
  paymentType: string | null;
  cancellationTimeline: CancellationPoint[];
}

export interface StayRates {
  searchResultId: string | null;
  totalAmount: string | null;
  currency: string | null;
  rooms: StayRoom[];
}

export interface StayReview {
  text: string;
  score: number | null;
  reviewerName: string;
  createdAt: string;
}

export interface StayRatesInput {
  accommodationId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
}

export interface StaysProvider {
  search(input: StaySearchInput): Promise<StayCard[]>;
  getAccommodation(id: string): Promise<StayAccommodation | null>;
  getRates(input: StayRatesInput): Promise<StayRates | null>;
  getReviews(id: string): Promise<StayReview[]>;
}

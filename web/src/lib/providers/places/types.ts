import type { PlaceCategory } from "@agp/shared";

/** A row for the `places` cache, as a provider returns it. */
export interface PlaceRecord {
  provider: "google" | "mock" | "seed";
  provider_place_id: string;
  name: string;
  category: PlaceCategory;
  address: string | null;
  lat: number;
  lng: number;
  price_level: number | null;
  rating: number | null;
  phone: string | null;
  photo_url: string | null;
  hours: Record<string, [string, string][]> | null;
  tags: string[];
  dietary_tags: string[];
}

export interface PlacesProvider {
  search(input: {
    query: string;
    category?: PlaceCategory;
    near?: { lat: number; lng: number };
    openAt?: string;
    maxResults: number;
  }): Promise<PlaceRecord[]>;
  get(providerPlaceId: string): Promise<PlaceRecord | null>;
}

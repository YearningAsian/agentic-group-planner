import "server-only";
import type { PlaceCategory } from "@agp/shared";
import { AppError } from "@/lib/reliability";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import type { RequestPlace } from "./build-plan-request";

/** How many rows to rank from; the cache holds a city's worth of places, not the world's. */
const SCAN_LIMIT = 200;

export interface FindPlacesQuery {
  category: PlaceCategory;
  /** The group's interests; places tagged with more of them come first. */
  tags?: readonly string[];
  limit: number;
}

/**
 * Candidate places for a slot, from the `places` cache only (design §2.3); the provider fallback
 * comes with AI-S04. Only places with a known per-person price (`raw.price_cents`) are returned,
 * since a place without one is never a candidate (design §11.7). Ranked by how many of `tags` a
 * place carries, then rating, then name.
 */
export async function findPlaces(query: FindPlacesQuery, admin: AdminClient = getAdminClient()): Promise<RequestPlace[]> {
  const { data, error } = await admin
    .from("places")
    .select("id, name, category, rating, tags, dietary_tags, hours, raw")
    .eq("category", query.category)
    .not("raw->price_cents", "is", null)
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(SCAN_LIMIT);
  if (error) throw new AppError("internal", "Couldn't read the places cache.", { retryable: true, cause: error });
  const wanted = new Set(query.tags ?? []);
  const liked = (place: { tags: string[] }) => place.tags.filter((tag) => wanted.has(tag)).length;
  return data
    .map((place) => ({ ...place, rating: place.rating === null ? null : Number(place.rating) }))
    .sort((a, b) => liked(b) - liked(a) || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
    .slice(0, query.limit);
}

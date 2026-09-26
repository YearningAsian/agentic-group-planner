import { Dietary, PlaceCategory } from "@agp/shared";
import type { PlanRequest } from "./client";

/** The database CHECKs keep these to the dietary enum; this narrows the type and drops anything else. */
const dietary = (values: string[]): Dietary[] => values.filter((v): v is Dietary => Dietary.safeParse(v).success);

/** Design §2.1: a plan covers the earliest 3 open slots; later slots stay TBD blocks. */
export const MAX_PLANNED_SLOTS = 3;
/** Design §2.2: at most 6 candidates per slot. */
export const MAX_CANDIDATES = 6;

export interface RequestMember {
  id: string;
  budget_cents: number | null;
  dietary: string[];
  interests: string[];
}

export interface RequestItem {
  id: string;
  slot_key: string;
  category: string;
  starts_at: string;
  ends_at: string;
  together: boolean;
}

/** A `places` row as the builder reads it. The per-person price and visit length live in `raw`. */
export interface RequestPlace {
  id: string;
  name: string;
  category: string;
  rating: number | null;
  tags: string[];
  dietary_tags: string[];
  raw: unknown;
}

/**
 * A candidate's price per person, in cents, and its visit length. The design has no price column
 * on `places`, so both come from the provider payload (`raw.price_cents`, `raw.duration_min`); a
 * place without a known price is never offered, since the model must never invent one.
 */
function pricing(place: RequestPlace): { price_cents: number; duration_min: number | null } | null {
  const raw = (place.raw ?? {}) as { price_cents?: unknown; duration_min?: unknown };
  if (!Number.isInteger(raw.price_cents) || (raw.price_cents as number) < 0) return null;
  const duration = Number.isInteger(raw.duration_min) && (raw.duration_min as number) > 0 ? (raw.duration_min as number) : null;
  return { price_cents: raw.price_cents as number, duration_min: duration };
}

const minutesBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60_000);

/**
 * The first plan request (AI-107): one slot per item, in time order, with candidates from the
 * places cache by category (best rated first, at most 6) and no travel edges yet. AI-207 replaces
 * it with pinned neighbors, travel, and the booked-time shift.
 */
export function buildPlanRequest(input: {
  requestId: string;
  mode: PlanRequest["mode"];
  members: RequestMember[];
  items: RequestItem[];
  places: RequestPlace[];
}): PlanRequest {
  const slots = [...input.items]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .map((item) => {
      const candidates = input.places
        .filter((place) => place.category === item.category)
        .flatMap((place) => {
          const priced = pricing(place);
          return priced ? [{ place, ...priced }] : [];
        })
        .sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0) || a.place.name.localeCompare(b.place.name))
        .slice(0, MAX_CANDIDATES)
        .map(({ place, price_cents, duration_min }) => ({
          place_id: place.id,
          price_cents,
          tags: place.tags,
          dietary_tags: dietary(place.dietary_tags),
          rating: place.rating,
          open_from: null,
          open_until: null,
          duration_min: duration_min ?? minutesBetween(item.starts_at, item.ends_at),
        }));
      return {
        key: item.slot_key,
        starts_at: item.starts_at,
        ends_at: item.ends_at,
        // Dietary rules apply only to food and dessert slots, so the engines need the category.
        category: PlaceCategory.parse(item.category),
        together: item.together,
        pinned: null,
        candidates,
      };
    });
  return {
    request_id: input.requestId,
    mode: input.mode,
    members: input.members.map((m) => ({ id: m.id, budget_cents: m.budget_cents, dietary: dietary(m.dietary), interests: m.interests })),
    slots,
    travel: [],
  };
}

import { Dietary, PlaceCategory } from "@agp/shared";
import type { PlanRequest } from "./client";

type Slot = PlanRequest["slots"][number];
type Candidate = Slot["candidates"][number];
type TravelEdge = PlanRequest["travel"][number];

/** Design §2.1: a plan covers the earliest 3 open slots; later slots stay TBD blocks. */
export const MAX_PLANNED_SLOTS = 3;
/** Design §2.2: at most 6 candidates per slot, and 5 slots per request. */
export const MAX_CANDIDATES = 6;
const MAX_SLOTS = 5;

/** Statuses a slot can be planned from: a first plan fills TBD slots, a re-plan revisits open ones (§2.1). */
const PLANNABLE: Record<PlanRequest["mode"], readonly string[]> = {
  initial: ["tbd"],
  replan: ["tbd", "voting", "decided"],
};
/** Dietary rules apply only to these slots (the engines' `rules.is_food`). */
const FOOD = new Set(["food", "dessert"]);
/** The keys of `places.hours`. */
type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

/** The database CHECKs keep these to the dietary enum; this narrows the type and drops anything else. */
const dietary = (values: readonly string[]): Dietary[] => values.filter((v): v is Dietary => Dietary.safeParse(v).success);

export interface RequestMember {
  id: string;
}

/** A `member_constraints` row. A member without one plans with no budget, diet, or interests. */
export interface RequestConstraints {
  member_id: string;
  budget_cents: number | null;
  dietary: readonly string[];
  interests: readonly string[];
}

/** One of the trip's live items (not cancelled or superseded). Split siblings share a `slot_key`. */
export interface RequestItem {
  id: string;
  slot_key: string;
  category: string;
  starts_at: string;
  ends_at: string;
  together: boolean;
  status: string;
  pinned: boolean;
  /** Who goes. A pinned slot fixes these members; none recorded means everyone. */
  attendee_ids?: readonly string[];
  /** The chosen option's place, for a booked or pinned item. */
  place_id?: string | null;
  /** The chosen option's per-person price. */
  price_cents?: number | null;
  /** A booked item's confirmed start (`bookings.details.starts_at`); it may differ from the slot's. */
  booked_starts_at?: string | null;
  /** Minutes earlier replans already shifted this item (`itinerary_items.shifted_min`). */
  shifted_min?: number;
}

/** A `places` row as the builder reads it. The per-person price and visit length live in `raw` (design §11.7). */
export interface RequestPlace {
  id: string;
  name: string;
  category: string;
  rating: number | null;
  tags: readonly string[];
  dietary_tags: readonly string[];
  /** Local opening hours by weekday, e.g. `{ "sat": [["09:00", "18:00"]] }`; null when unknown. */
  hours: unknown;
  raw: unknown;
}

export interface BuildPlanRequestInput {
  /** The tool-call ID. */
  requestId: string;
  mode: PlanRequest["mode"];
  /** The trip's time zone, since opening hours are local wall-clock times. */
  timezone: string;
  /** In `sort_order`; the request keeps this order. */
  members: readonly RequestMember[];
  constraints: readonly RequestConstraints[];
  items: readonly RequestItem[];
  /** Candidate places (from `findPlaces`) and the places of booked or pinned items. */
  places: readonly RequestPlace[];
  /** Travel minutes between places; the builder keeps the ones between consecutive slots. */
  travel: readonly TravelEdge[];
  /** The items to plan (resolved `item_handles`); default: the earliest 3 open slots. */
  planItemIds?: readonly string[];
}

/** A slot: its items (two when split), in one time window. */
interface DaySlot {
  key: string;
  items: RequestItem[];
  starts_at: string;
  ends_at: string;
}

const minutes = (ms: number) => Math.round(ms / 60_000);
const toIso = (ms: number) => new Date(ms).toISOString();
const isFixed = (slot: DaySlot) => slot.items.some((i) => i.pinned || i.status === "booked");

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

/** The trip's slots in time order, siblings grouped by `slot_key`. */
function daySlots(items: readonly RequestItem[]): DaySlot[] {
  const byKey = new Map<string, RequestItem[]>();
  for (const item of items) byKey.set(item.slot_key, [...(byKey.get(item.slot_key) ?? []), item]);
  return [...byKey]
    .map(([key, group]) => ({ key, items: group, starts_at: group[0]!.starts_at, ends_at: group[0]!.ends_at }))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.key.localeCompare(b.key));
}

/**
 * Design §2.1, the replan time shift: when a booked item's confirmed start differs from its slot's
 * by Δ (dinner booked at 19:45 for a 19:00 slot, Δ = +45 min), the slot right before it moves by Δ,
 * both groups if it's split, unless that slot is booked or pinned itself. Nothing else moves.
 * Returns the new times for each moved item, computed from the confirmed time; no shifted time is
 * written anywhere by hand.
 */
export function timeShifts(items: readonly RequestItem[]): Map<string, { starts_at: string; ends_at: string; delta_min: number }> {
  const slots = daySlots(items);
  const shifts = new Map<string, { starts_at: string; ends_at: string; delta_min: number }>();
  slots.forEach((slot, i) => {
    const booked = slot.items.find((item) => item.status === "booked" && item.booked_starts_at);
    const before = slots[i - 1];
    if (!booked || !before || isFixed(before)) return;
    const delta = Date.parse(booked.booked_starts_at!) - Date.parse(booked.starts_at);
    for (const item of before.items) {
      // The booked item never moves, so its Δ stays; only the part not yet applied is left.
      const left = delta - (item.shifted_min ?? 0) * 60_000;
      if (left === 0) continue;
      shifts.set(item.id, {
        starts_at: toIso(Date.parse(item.starts_at) + left),
        ends_at: toIso(Date.parse(item.ends_at) + left),
        delta_min: minutes(left),
      });
    }
  });
  return shifts;
}

/** The wall-clock date and weekday of an instant in a time zone. */
function localDay(instant: string, timeZone: string): { date: string; weekday: Weekday } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday!.toLowerCase().slice(0, 3) as Weekday };
}

/** How far a time zone's wall clock is ahead of UTC at an instant, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - instant;
}

/** A local wall-clock time ("HH:MM") on a local date, as a UTC instant in ms. */
function localTime(date: string, time: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`);
  // Two passes settle the offset even when the guess lands across a DST change.
  const first = guess - offsetMs(guess, timeZone);
  return guess - offsetMs(first, timeZone);
}

/**
 * The opening window that covers a slot's start, from local hours like `{ "sat": [["09:00","18:00"]] }`.
 * Unknown hours mean open (null, null). No hours listed for the day means closed (undefined), and
 * such a place isn't offered. An interval that closes past midnight ends the next day.
 */
function openWindow(place: RequestPlace, slotStart: string, timeZone: string): { open_from: string | null; open_until: string | null } | undefined {
  if (!place.hours || typeof place.hours !== "object") return { open_from: null, open_until: null };
  const { date, weekday } = localDay(slotStart, timeZone);
  const intervals = ((place.hours as Record<string, unknown>)[weekday] ?? []) as [string, string][];
  if (!Array.isArray(intervals) || intervals.length === 0) return undefined;
  const windows = intervals.map(([open, close]) => {
    const from = localTime(date, open, timeZone);
    let until = localTime(date, close, timeZone);
    if (until <= from) until += 24 * 60 * 60_000;
    return { from, until };
  });
  const start = Date.parse(slotStart);
  // The one the slot starts in, else the next to open, else the day's last; the engines check the fit.
  const chosen = windows.find((w) => w.from <= start && start < w.until) ?? windows.find((w) => w.from > start) ?? windows.at(-1)!;
  return { open_from: toIso(chosen.from), open_until: toIso(chosen.until) };
}

/**
 * The candidates for an unpinned slot: priced places of the slot's category that open that day,
 * ranked for the group so the best 6 survive the cut. In a food slot, a place that covers everyone's
 * dietary needs comes first (otherwise six places could crowd out every one the group can eat at);
 * then the most matches with the group's interests, then rating, then name. Places the day's pinned
 * stops already visit aren't offered again.
 */
function candidatesFor(
  slot: DaySlot,
  starts_at: string,
  ends_at: string,
  input: BuildPlanRequestInput,
  group: { dietary: Set<string>; interests: Set<string> },
  guests: number,
  visited: Set<string>,
): Candidate[] {
  const category = slot.items[0]!.category;
  const food = FOOD.has(category);
  const covers = (place: RequestPlace) => [...group.dietary].every((need) => place.dietary_tags.includes(need));
  const liked = (place: RequestPlace) => place.tags.filter((tag) => group.interests.has(tag)).length;
  const length = minutes(Date.parse(slot.ends_at) - Date.parse(slot.starts_at));
  return input.places
    .filter((place) => {
      if (place.category !== category || visited.has(place.id)) return false;
      const raw = place.raw as Record<string, unknown> | null;
      if (typeof raw?.rate_id !== "string") return true;
      return slot.items.length === 1 && raw.item_id === slot.items[0]!.id &&
        raw.check_in_date === starts_at.slice(0, 10) && raw.check_out_date === ends_at.slice(0, 10) &&
        raw.guests === guests;
    })
    .flatMap((place) => {
      const priced = pricing(place);
      const window = priced && openWindow(place, starts_at, input.timezone);
      return priced && window ? [{ place, priced, window }] : [];
    })
    .sort(
      (a, b) =>
        (food ? Number(covers(b.place)) - Number(covers(a.place)) : 0) ||
        liked(b.place) - liked(a.place) ||
        (b.place.rating ?? 0) - (a.place.rating ?? 0) ||
        a.place.name.localeCompare(b.place.name),
    )
    .slice(0, MAX_CANDIDATES)
    .map(({ place, priced, window }) => ({
      place_id: place.id,
      price_cents: priced.price_cents,
      tags: [...place.tags],
      dietary_tags: dietary(place.dietary_tags),
      rating: place.rating,
      ...window,
      duration_min: priced.duration_min ?? length,
    }));
}

/**
 * A pinned context slot's one candidate: the booked or pinned place. A booked stop is already
 * paid for, so it's priced 0 and doesn't count against anyone's budget a second time; a pinned
 * stop that isn't booked yet carries its option's price. Its visit lasts the slot.
 */
function pinnedCandidate(item: RequestItem, starts_at: string, ends_at: string, input: BuildPlanRequestInput): Candidate {
  const place = input.places.find((p) => p.id === item.place_id);
  return {
    place_id: item.place_id!,
    price_cents: item.status === "booked" ? 0 : (item.price_cents ?? 0),
    tags: [...(place?.tags ?? [])],
    dietary_tags: dietary(place?.dietary_tags ?? []),
    rating: place?.rating ?? null,
    ...((place && openWindow(place, starts_at, input.timezone)) ?? { open_from: null, open_until: null }),
    duration_min: minutes(Date.parse(ends_at) - Date.parse(starts_at)),
  };
}

/** Every (from, to) place pair between consecutive slots: the travel edges a request needs. */
export function travelPairs(slots: readonly Slot[]): { from: string; to: string }[] {
  const pairs = new Map<string, { from: string; to: string }>();
  for (let i = 1; i < slots.length; i++) {
    for (const from of slots[i - 1]!.candidates) {
      for (const to of slots[i]!.candidates) {
        if (from.place_id !== to.place_id) pairs.set(`${from.place_id}:${to.place_id}`, { from: from.place_id, to: to.place_id });
      }
    }
  }
  return [...pairs.values()];
}

/**
 * The optimizer request for `plan_day` (design §2.1–§2.2). It plans the named items, or by default
 * the earliest 3 open slots (TBD ones on a first plan; TBD, voting, or decided ones on a re-plan),
 * so dinner stays a TBD block on the seeded trip. Each booked or pinned stop next to a planned slot
 * comes along as a pinned slot with its one place, so travel into and out of it is checked. A booked
 * stop confirmed at another time than its slot moves the slot before it by the same amount
 * (`timeShifts`), and sits in the request at its confirmed time. Candidates come from `places` by
 * category, at most 6 per slot; travel keeps the given edges between consecutive slots. Pure: the
 * same input always builds the same request, which the committed fixtures depend on.
 */
export function buildPlanRequest(input: BuildPlanRequestInput): PlanRequest {
  const memberIds = input.members.map((m) => m.id);
  const byMember = new Map(input.constraints.map((c) => [c.member_id, c]));
  const shifts = timeShifts(input.items);
  const slots = daySlots(input.items);

  const wanted = input.planItemIds ? new Set(input.planItemIds) : null;
  const planned = new Set(
    (wanted
      ? slots.filter((s) => s.items.some((i) => wanted.has(i.id)))
      : slots.filter((s) => !isFixed(s) && s.items.every((i) => PLANNABLE[input.mode].includes(i.status)))
    )
      .slice(0, MAX_PLANNED_SLOTS)
      .map((s) => s.key),
  );
  // Booked or pinned neighbors with a known place ride along as context.
  const context = new Set<string>();
  slots.forEach((slot, i) => {
    if (planned.has(slot.key) || !isFixed(slot) || !slot.items.some((item) => item.place_id)) return;
    if (planned.has(slots[i - 1]?.key ?? "") || planned.has(slots[i + 1]?.key ?? "")) context.add(slot.key);
  });
  const included = slots.filter((s) => planned.has(s.key) || context.has(s.key));
  // Over the 5-slot limit (only with stops between planned slots): drop context from the outside in.
  while (included.length > MAX_SLOTS) {
    const last = included.length - 1;
    const drop = context.has(included[last]!.key) ? last : context.has(included[0]!.key) ? 0 : included.findLastIndex((s) => context.has(s.key));
    included.splice(drop, 1);
  }

  const visited = new Set(included.filter((s) => context.has(s.key)).map((s) => s.items.find((i) => i.place_id)!.place_id!));
  const requestSlots: Slot[] = included.map((slot) => {
    const first = slot.items[0]!;
    const category = PlaceCategory.parse(first.category);
    if (context.has(slot.key)) {
      const item = slot.items.find((i) => i.place_id)!;
      const start = Date.parse(item.booked_starts_at ?? item.starts_at);
      const starts_at = toIso(start);
      const ends_at = toIso(start + Date.parse(item.ends_at) - Date.parse(item.starts_at));
      const attending = (item.attendee_ids ?? []).filter((id) => memberIds.includes(id));
      return {
        key: slot.key,
        starts_at,
        ends_at,
        together: first.together,
        category,
        pinned: { place_id: item.place_id!, member_ids: attending.length > 0 ? attending : memberIds },
        candidates: [pinnedCandidate(item, starts_at, ends_at, input)],
      };
    }
    const shift = shifts.get(first.id);
    const starts_at = shift?.starts_at ?? toIso(Date.parse(slot.starts_at));
    // A re-planned group's options are for its own members; a slot without attendees is everyone's.
    const attending = [...new Set(slot.items.flatMap((i) => i.attendee_ids ?? []))];
    const members = attending.length > 0 ? attending : memberIds;
    const group = {
      dietary: new Set(members.flatMap((id) => byMember.get(id)?.dietary ?? [])),
      interests: new Set(members.flatMap((id) => byMember.get(id)?.interests ?? [])),
    };
    return {
      key: slot.key,
      starts_at,
      ends_at: shift?.ends_at ?? toIso(Date.parse(slot.ends_at)),
      // Dietary rules apply only to food and dessert slots, so the engines need the category.
      category,
      together: slot.items.every((i) => i.together),
      pinned: null,
      candidates: candidatesFor(slot, starts_at, shift?.ends_at ?? toIso(Date.parse(slot.ends_at)), input, group, members.length, visited),
    };
  });

  const needed = new Set(travelPairs(requestSlots).map((p) => `${p.from}:${p.to}`));
  const travel = new Map<string, TravelEdge>();
  for (const edge of input.travel) {
    const key = `${edge.from_place_id}:${edge.to_place_id}`;
    if (needed.has(key)) travel.set(key, { from_place_id: edge.from_place_id, to_place_id: edge.to_place_id, minutes: edge.minutes });
  }

  return {
    request_id: input.requestId,
    mode: input.mode,
    members: input.members.map((m) => ({
      id: m.id,
      budget_cents: byMember.get(m.id)?.budget_cents ?? null,
      dietary: dietary(byMember.get(m.id)?.dietary ?? []),
      interests: [...(byMember.get(m.id)?.interests ?? [])],
    })),
    slots: requestSlots,
    travel: [...travel.values()].sort(
      (a, b) => a.from_place_id.localeCompare(b.from_place_id) || a.to_place_id.localeCompare(b.to_place_id),
    ),
  };
}

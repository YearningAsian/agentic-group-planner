import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { uuidFor } from "../../../scripts/demo/lib/ids";
import { localToUtc } from "../../../scripts/demo/lib/time";
import trip from "../../../scripts/demo/fixtures/saturday-trip.json";
import { createMockRoutingProvider, minutesFor, routeModeFor } from "@/lib/providers/routing";
import {
  type BuildPlanRequestInput,
  buildPlanRequest,
  MAX_CANDIDATES,
  type RequestItem,
  type RequestPlace,
  timeShifts,
} from "./build-plan-request";

const REQUESTS = path.resolve(__dirname, "../../../scripts/demo/fixtures/requests");
/** The committed fixtures plan the Saturday after this one (a Saturday in EDT); `seed.ts` picks the next Saturday. */
const FIXTURE_DATE = "2026-10-03";
const TZ = trip.trip.timezone;
const at = (time: string) => localToUtc(FIXTURE_DATE, time, TZ);
const iso = (time: string) => new Date(at(time)).toISOString();

// The IDs mock-plan.json names: members as `seed:demo` makes them, places by their fixture key.
const memberId = (key: string) => uuidFor("demo", `member:${key}`);
const placeId = (key: string) => uuidFor("demo", `place:${key}`);
const itemId = (key: string) => uuidFor("demo", `item:${key}`);

const places: RequestPlace[] = trip.places.map((p) => ({
  id: placeId(p.key),
  name: p.name,
  category: p.category,
  rating: p.rating,
  tags: p.tags,
  dietary_tags: p.dietary_tags,
  hours: p.hours,
  raw: { price_cents: p.price_cents, duration_min: p.duration_min },
}));

/** Straight-line travel between every pair of fixture places, as mock routing times it. */
async function mockTravel() {
  const routing = createMockRoutingProvider();
  const edges = [];
  for (const from of trip.places) {
    for (const to of trip.places) {
      if (from === to) continue;
      const leg = await routing.route({ from, to, mode: routeModeFor(from, to) });
      edges.push({ from_place_id: placeId(from.key), to_place_id: placeId(to.key), minutes: minutesFor(leg.durationS) });
    }
  }
  return edges;
}

function seededItems(): RequestItem[] {
  return trip.items.map((item) => ({
    id: itemId(item.slot_key),
    slot_key: item.slot_key,
    category: item.category,
    starts_at: at(item.starts),
    ends_at: at(item.ends),
    together: item.together,
    status: "tbd",
    pinned: false,
  }));
}

/** The seeded trip as `plan_day` sees it before any plan: every item tbd. */
async function saturdayInitial(): Promise<BuildPlanRequestInput> {
  return {
    requestId: "saturday-initial",
    mode: "initial",
    timezone: TZ,
    members: trip.members.map((m) => ({ id: memberId(m.key) })),
    constraints: trip.members.map((m) => ({ member_id: memberId(m.key), ...m.constraints })),
    items: seededItems(),
    places,
    travel: await mockTravel(),
  };
}

/**
 * The seeded trip after the fixture plan, with the aquarium booked at its slot time and dinner
 * booked at South City Kitchen for 19:45, 45 minutes after its slot (design §10.2). The afternoon
 * is split, as the plan left it. The shifted afternoon comes out of the builder, not from here.
 */
async function saturdayReplan(): Promise<BuildPlanRequestInput> {
  const everyone = trip.members.map((m) => memberId(m.key));
  const [morning, lunch, afternoon, dinner] = seededItems();
  const booked = (item: RequestItem, place: string, time: string): RequestItem => ({
    ...item,
    status: "booked",
    pinned: true,
    attendee_ids: everyone,
    place_id: placeId(place),
    price_cents: trip.places.find((p) => p.key === place)!.price_cents,
    booked_starts_at: at(time),
  });
  const voting = (item: RequestItem, place: string, members: string[], id = item.id): RequestItem => ({
    ...item,
    id,
    status: "voting",
    attendee_ids: members,
    place_id: placeId(place),
    price_cents: trip.places.find((p) => p.key === place)!.price_cents,
  });
  return {
    ...(await saturdayInitial()),
    requestId: "saturday-replan",
    mode: "replan",
    items: [
      booked(morning!, "georgia-aquarium", "10:00"),
      voting(lunch!, "ponce-city-market", everyone),
      voting(afternoon!, "high-museum", [memberId("person1"), memberId("person4")]),
      voting(afternoon!, "piedmont-park", [memberId("person2"), memberId("person3")], itemId("afternoon:2")),
      booked(dinner!, "south-city-kitchen", "19:45"),
    ],
  };
}

/** A small trip for the time-shift rule: two members and four 1-hour slots. */
function syntheticTrip(items: Partial<RequestItem>[]): BuildPlanRequestInput {
  const members = [{ id: "00000000-0000-4000-8000-00000000000a" }, { id: "00000000-0000-4000-8000-00000000000b" }];
  const place = (n: number, category = "activity"): RequestPlace => ({
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    name: `Place ${n}`,
    category,
    rating: 4,
    tags: [],
    dietary_tags: [],
    hours: null,
    raw: { price_cents: 1000 + n, duration_min: 60 },
  });
  return {
    requestId: "call_synthetic",
    mode: "replan",
    timezone: "UTC",
    members,
    constraints: [],
    items: items.map((item, i) => ({
      id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`,
      slot_key: `slot${i}`,
      category: "activity",
      starts_at: "2026-10-03T10:00:00Z",
      ends_at: "2026-10-03T11:00:00Z",
      together: true,
      status: "voting",
      pinned: false,
      ...item,
    })),
    places: [1, 2, 3].map((n) => place(n)),
    travel: [],
  };
}

describe("buildPlanRequest", () => {
  it("default slots are the earliest 3 open items, so dinner is left out", async () => {
    const request = buildPlanRequest(await saturdayInitial());

    expect(request.slots.map((s) => [s.key, s.category, s.together, s.pinned])).toEqual([
      ["morning", "activity", true, null],
      ["lunch", "food", true, null],
      ["afternoon", "activity", false, null],
    ]);
    expect(request.slots.map((s) => [s.starts_at, s.ends_at])).toEqual([
      [iso("10:00"), iso("12:30")],
      [iso("12:45"), iso("13:45")],
      [iso("14:15"), iso("17:15")],
    ]);
    expect(request.members).toEqual([
      { id: memberId("person1"), budget_cents: 8000, dietary: [], interests: ["art", "history", "food"] },
      { id: memberId("person2"), budget_cents: 8000, dietary: ["vegetarian"], interests: ["outdoors", "animals"] },
      { id: memberId("person3"), budget_cents: 8000, dietary: [], interests: ["animals", "outdoors", "shopping"] },
      { id: memberId("person4"), budget_cents: 8000, dietary: [], interests: ["art", "museums"] },
    ]);
    // Opening hours become the slot day's window, in the trip's time zone.
    const aquarium = request.slots[0]!.candidates.find((c) => c.place_id === placeId("georgia-aquarium"));
    expect(aquarium).toMatchObject({ price_cents: 4200, duration_min: 150, open_from: iso("09:00"), open_until: iso("21:00") });
    // Travel covers every candidate pair between consecutive slots, and nothing else.
    const pairs = new Set(request.travel.map((e) => `${e.from_place_id}:${e.to_place_id}`));
    for (const [a, b] of [
      [0, 1],
      [1, 2],
    ] as const) {
      for (const from of request.slots[a]!.candidates) {
        for (const to of request.slots[b]!.candidates) {
          if (from.place_id !== to.place_id) expect(pairs.has(`${from.place_id}:${to.place_id}`)).toBe(true);
        }
      }
    }
    expect(pairs.size).toBe(request.travel.length);
    expect(request.travel.length).toBe(6 * 5 + 5 * 6);
  });

  it("a booked neighbor becomes a pinned slot with its place as the only candidate", async () => {
    const request = buildPlanRequest(await saturdayReplan());
    const everyone = request.members.map((m) => m.id);

    expect(request.slots.map((s) => s.key)).toEqual(["morning", "lunch", "afternoon", "dinner"]);
    const [morning, , afternoon, dinner] = request.slots;
    expect(morning).toMatchObject({ pinned: { place_id: placeId("georgia-aquarium"), member_ids: everyone }, category: "activity" });
    // Already paid, so it doesn't count against anyone's budget again.
    expect(morning!.candidates).toEqual([
      expect.objectContaining({ place_id: placeId("georgia-aquarium"), price_cents: 0, duration_min: 150 }),
    ]);
    expect(dinner).toMatchObject({
      pinned: { place_id: placeId("south-city-kitchen"), member_ids: everyone },
      starts_at: iso("19:45"),
      ends_at: iso("21:15"),
    });
    expect(dinner!.candidates.map((c) => c.place_id)).toEqual([placeId("south-city-kitchen")]);
    // The split afternoon is one slot, and a pinned stop isn't offered again elsewhere.
    expect(afternoon).toMatchObject({ together: false, pinned: null });
    expect(afternoon!.candidates.map((c) => c.place_id)).not.toContain(placeId("georgia-aquarium"));
    expect(request.slots[1]!.candidates.map((c) => c.place_id)).not.toContain(placeId("south-city-kitchen"));
    // Travel into and out of the pinned stops is in the request.
    expect(request.travel).toContainEqual(expect.objectContaining({ from_place_id: placeId("georgia-aquarium"), to_place_id: placeId("ponce-city-market") }));
    expect(request.travel).toContainEqual(expect.objectContaining({ from_place_id: placeId("high-museum"), to_place_id: placeId("south-city-kitchen") }));
  });

  it("a pinned item confirmed Δ later moves the unbooked slot right before it by Δ, and nothing else", () => {
    const input = syntheticTrip([
      { starts_at: "2026-10-03T10:00:00Z", ends_at: "2026-10-03T11:00:00Z", status: "tbd" },
      // A split slot: both groups move.
      { slot_key: "slot1", starts_at: "2026-10-03T12:00:00Z", ends_at: "2026-10-03T13:00:00Z", together: false },
      { slot_key: "slot1", starts_at: "2026-10-03T12:00:00Z", ends_at: "2026-10-03T13:00:00Z", together: false },
      {
        slot_key: "booked",
        starts_at: "2026-10-03T14:00:00Z",
        ends_at: "2026-10-03T15:00:00Z",
        status: "booked",
        pinned: true,
        place_id: "00000000-0000-4000-8000-000000000103",
        booked_starts_at: "2026-10-03T14:30:00Z",
      },
      { slot_key: "later", starts_at: "2026-10-03T17:00:00Z", ends_at: "2026-10-03T18:00:00Z" },
    ]);
    const [first, splitA, splitB, booked, later] = input.items;

    const shifts = timeShifts(input.items);
    const request = buildPlanRequest(input);

    expect([...shifts.keys()].sort()).toEqual([splitA!.id, splitB!.id].sort());
    expect(shifts.get(splitA!.id)).toEqual({ starts_at: "2026-10-03T12:30:00.000Z", ends_at: "2026-10-03T13:30:00.000Z", delta_min: 30 });
    expect(request.slots.map((s) => [s.key, s.starts_at, s.ends_at])).toEqual([
      ["slot0", "2026-10-03T10:00:00.000Z", "2026-10-03T11:00:00.000Z"],
      ["slot1", "2026-10-03T12:30:00.000Z", "2026-10-03T13:30:00.000Z"],
      ["booked", "2026-10-03T14:30:00.000Z", "2026-10-03T15:30:00.000Z"],
      ["later", "2026-10-03T17:00:00.000Z", "2026-10-03T18:00:00.000Z"],
    ]);
    expect(request.slots[2]!.pinned).toEqual({ place_id: booked!.place_id, member_ids: input.members.map((m) => m.id) });
    // Unchanged inputs: the builder never writes to the items it was given.
    expect([first!.starts_at, later!.starts_at]).toEqual(["2026-10-03T10:00:00Z", "2026-10-03T17:00:00Z"]);

    // Confirmed at its slot time: nothing moves.
    const onTime = syntheticTrip([{}, { slot_key: "booked", status: "booked", pinned: true, starts_at: "2026-10-03T12:00:00Z", ends_at: "2026-10-03T13:00:00Z", booked_starts_at: "2026-10-03T12:00:00Z" }]);
    expect(timeShifts(onTime.items).size).toBe(0);
  });

  it("candidates come from the places cache by category, at most 6 per slot", () => {
    const input = syntheticTrip([{ category: "activity" }]);
    const activity = (n: number, extra: Partial<RequestPlace> = {}): RequestPlace => ({
      id: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`,
      name: `Activity ${n}`,
      category: "activity",
      rating: 4 + n / 20,
      tags: [],
      dietary_tags: [],
      hours: { sat: [["08:00", "20:00"]] },
      raw: { price_cents: 500 * n, duration_min: 60 },
      ...extra,
    });
    input.constraints = [{ member_id: input.members[0]!.id, budget_cents: null, dietary: [], interests: ["art"] }];
    input.places = [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => activity(n)),
      activity(8, { rating: 3.1, tags: ["art"] }),
      activity(9, { rating: 5, raw: { duration_min: 60 } }),
      activity(10, { rating: 5, hours: { sun: [["08:00", "20:00"]] } }),
      { ...activity(11), category: "food", rating: 5 },
    ];

    const [slot] = buildPlanRequest(input).slots;

    expect(slot!.candidates).toHaveLength(MAX_CANDIDATES);
    // The art place leads for the member who likes art, then the best rated; the one with no
    // known price, the one closed on Saturdays, and the food place never appear.
    expect(slot!.candidates.map((c) => c.place_id)).toEqual([8, 7, 6, 5, 4, 3].map((n) => activity(n).id));
    expect(slot!.candidates.every((c) => Number.isInteger(c.price_cents))).toBe(true);
  });

  it("the committed request fixtures equal buildPlanRequest on saturday-trip.json", async () => {
    const built = {
      "saturday-initial.json": buildPlanRequest(await saturdayInitial()),
      "saturday-replan.json": buildPlanRequest(await saturdayReplan()),
    };
    // UPDATE_REQUEST_FIXTURES=1 rewrites them after an intended change to the builder or the seed.
    for (const [file, request] of Object.entries(built)) {
      const target = path.join(REQUESTS, file);
      if (process.env.UPDATE_REQUEST_FIXTURES === "1") writeFileSync(target, `${JSON.stringify(request, null, 2)}\n`);
      expect(JSON.parse(readFileSync(target, "utf8")), file).toEqual(request);
    }
    // design §10.2: dinner booked 45 minutes late moves the afternoon to 15:00–18:00, and only it.
    const replan = built["saturday-replan.json"];
    expect(replan.slots.map((s) => [s.key, s.starts_at, s.ends_at])).toEqual([
      ["morning", iso("10:00"), iso("12:30")],
      ["lunch", iso("12:45"), iso("13:45")],
      ["afternoon", iso("15:00"), iso("18:00")],
      ["dinner", iso("19:45"), iso("21:15")],
    ]);
  });
});

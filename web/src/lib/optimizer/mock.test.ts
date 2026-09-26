import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import trip from "../../../scripts/demo/fixtures/saturday-trip.json";
import type { PlanRequest } from "./client";
import { mockPlan } from "./mock";

type Candidate = PlanRequest["slots"][number]["candidates"][number];

/**
 * The seeded trip as `plan_day` would send it, with fresh IDs the way the database assigns them:
 * the double has to recognize the trip by its shape, not by IDs.
 */
function seededRequest() {
  const members = trip.members.map((m) => ({ id: randomUUID(), key: m.key }));
  const places = trip.places.map((p) => ({ ...p, id: randomUUID() }));
  const candidates = (category: string): Candidate[] =>
    places
      .filter((p) => p.category === category)
      .map((p) => ({
        place_id: p.id,
        price_cents: p.price_cents,
        tags: p.tags,
        dietary_tags: p.dietary_tags as Candidate["dietary_tags"],
        rating: p.rating,
        open_from: null,
        open_until: null,
        duration_min: p.duration_min,
      }));
  const request: PlanRequest = {
    request_id: "call_seeded",
    mode: "initial",
    members: members.map((m) => ({ id: m.id, budget_cents: 8000, dietary: [], interests: [] })),
    slots: trip.items.slice(0, 3).map((item) => ({
      key: item.slot_key,
      starts_at: `2026-10-03T${item.starts}:00-04:00`,
      ends_at: `2026-10-03T${item.ends}:00-04:00`,
      together: item.together,
      pinned: null,
      candidates: candidates(item.category),
    })),
    travel: [],
  };
  const member = (key: string) => members.find((m) => m.key === key)!.id;
  const place = (key: string) => places.find((p) => p.key === key)!.id;
  return { request, member, place };
}

describe("mockPlan", () => {
  it("returns the fixture plan for the seeded trip, with engine mock", () => {
    const { request, member, place } = seededRequest();
    const everyone = ["person1", "person2", "person3", "person4"].map(member);

    const response = mockPlan(request);

    expect(response).toMatchObject({ request_id: "call_seeded", engine: "mock", infeasible_reasons: [] });
    const [best] = response.plans;
    expect(best).toMatchObject({ rank: 1, split: true });
    expect(best!.member_scores.map((s) => s.member_id)).toEqual(everyone);
    // Design §10.2: everyone at the aquarium, everyone at a vegetarian-friendly lunch, and a split afternoon.
    expect(best!.assignments).toEqual([
      { slot_key: "morning", groups: [{ place_id: place("georgia-aquarium"), member_ids: everyone }] },
      { slot_key: "lunch", groups: [{ place_id: place("ponce-city-market"), member_ids: everyone }] },
      {
        slot_key: "afternoon",
        groups: [
          { place_id: place("high-museum"), member_ids: [member("person1"), member("person4")] },
          { place_id: place("piedmont-park"), member_ids: [member("person2"), member("person3")] },
        ],
      },
    ]);
    const afternoon = response.slot_options.find((s) => s.slot_key === "afternoon")!;
    expect(afternoon.groups.map((g) => g.options[0]!.place_id)).toEqual([place("high-museum"), place("piedmont-park")]);
    // Every option is one of its slot's candidates, ranked from 1, two or three per group.
    for (const slot of response.slot_options) {
      const ids = request.slots.find((s) => s.key === slot.slot_key)!.candidates.map((c) => c.place_id);
      for (const group of slot.groups) {
        expect(group.options.map((o) => o.rank)).toEqual(group.options.map((_, i) => i + 1));
        expect(group.options.length).toBeGreaterThanOrEqual(2);
        expect(ids).toEqual(expect.arrayContaining(group.options.map((o) => o.place_id)));
      }
    }
  });

  it("returns everyone together at the first candidate for any other request", () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const [p1, p2, p3, p4, booked] = Array.from({ length: 5 }, () => randomUUID());
    const candidate = (placeId: string): Candidate => ({ place_id: placeId, price_cents: 1000, tags: [], duration_min: 60 });
    const request: PlanRequest = {
      request_id: "call_other",
      mode: "replan",
      members: [{ id: a }, { id: b }],
      slots: [
        {
          key: "brunch",
          starts_at: "2026-10-03T14:00:00Z",
          ends_at: "2026-10-03T15:00:00Z",
          together: false,
          pinned: null,
          candidates: [p1, p2, p3, p4].map(candidate),
        },
        {
          key: "show",
          starts_at: "2026-10-03T16:00:00Z",
          ends_at: "2026-10-03T18:00:00Z",
          together: true,
          pinned: { place_id: booked, member_ids: [a, b] },
          candidates: [candidate(booked)],
        },
      ],
      travel: [],
    };

    const response = mockPlan(request);

    expect(response).toMatchObject({ request_id: "call_other", engine: "mock", status: "feasible", infeasible_reasons: [] });
    expect(response.plans).toHaveLength(1);
    expect(response.plans[0]).toMatchObject({ rank: 1, split: false });
    expect(response.plans[0]!.assignments).toEqual([
      { slot_key: "brunch", groups: [{ place_id: p1, member_ids: [a, b] }] },
      { slot_key: "show", groups: [{ place_id: booked, member_ids: [a, b] }] },
    ]);
    // Options only for the slot being planned: its first three candidates, in order.
    expect(response.slot_options).toEqual([
      {
        slot_key: "brunch",
        groups: [{ member_ids: [a, b], options: [p1, p2, p3].map((id, i) => expect.objectContaining({ place_id: id, rank: i + 1 })) }],
      },
    ]);
  });
});

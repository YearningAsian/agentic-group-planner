import "server-only";
import fixture from "../../../scripts/demo/fixtures/mock-plan.json";
import trip from "../../../scripts/demo/fixtures/saturday-trip.json";
import type { PlannerResponse, PlanRequest } from "./client";

type Candidate = PlanRequest["slots"][number]["candidates"][number];
type SlotOptions = PlannerResponse["slot_options"][number];

/**
 * A place's identity across databases: its per-person price, visit length, and tags. The seeded
 * places differ on all three, and a request carries them, while its IDs are the database's own.
 */
function fingerprint(place: { price_cents: number; duration_min: number; tags?: string[] }): string {
  return `${place.price_cents}|${place.duration_min}|${[...(place.tags ?? [])].sort().join(",")}`;
}

const SEEDED_FINGERPRINTS = new Map(trip.places.map((p) => [p.key, fingerprint(p)]));
const SEEDED_MEMBER_ORDER = trip.members.map((m) => m.key);
const PLAN = fixture.response as PlannerResponse;

/**
 * The fixture plan with its IDs swapped for the request's, or null when the request isn't the
 * seeded trip's initial plan. Members map by order (the request lists them by `sort_order`, as
 * the fixture does); places map by fingerprint among the slot's candidates. An option whose place
 * isn't a candidate here is dropped, but a plan whose own places aren't all there doesn't match.
 */
function seededPlan(request: PlanRequest): PlannerResponse | null {
  const keys = PLAN.slot_options.map((s) => s.slot_key);
  if (request.slots.length !== keys.length || request.slots.some((s, i) => s.key !== keys[i] || s.pinned)) return null;
  if (request.members.length !== SEEDED_MEMBER_ORDER.length) return null;

  const memberIds = new Map(
    Object.entries(fixture.members).map(([id, key]) => [id, request.members[SEEDED_MEMBER_ORDER.indexOf(key)]!.id]),
  );
  const member = (id: string) => memberIds.get(id)!;
  const candidatesBySlot = new Map(request.slots.map((s) => [s.key, s.candidates]));
  const place = (slotKey: string, id: string): string | undefined => {
    const key = (fixture.places as Record<string, string>)[id];
    const wanted = key === undefined ? undefined : SEEDED_FINGERPRINTS.get(key);
    return candidatesBySlot.get(slotKey)?.find((c: Candidate) => fingerprint(c) === wanted)?.place_id;
  };

  const plans = [];
  for (const plan of PLAN.plans) {
    const assignments = [];
    for (const slot of plan.assignments) {
      const groups = [];
      for (const group of slot.groups) {
        const placeId = place(slot.slot_key, group.place_id);
        if (!placeId) return null;
        groups.push({ place_id: placeId, member_ids: group.member_ids.map(member) });
      }
      assignments.push({ slot_key: slot.slot_key, groups });
    }
    plans.push({ ...plan, member_scores: plan.member_scores.map((s) => ({ ...s, member_id: member(s.member_id) })), assignments });
  }

  const slotOptions: SlotOptions[] = [];
  for (const slot of PLAN.slot_options) {
    const groups = [];
    for (const group of slot.groups) {
      const options = group.options
        .map((o) => ({ ...o, place_id: place(slot.slot_key, o.place_id) }))
        .filter((o): o is typeof o & { place_id: string } => o.place_id !== undefined)
        .map((o, i) => ({ ...o, rank: i + 1 }));
      if (options.length === 0) return null;
      groups.push({ member_ids: group.member_ids.map(member), options });
    }
    slotOptions.push({ slot_key: slot.slot_key, groups });
  }

  return { ...PLAN, request_id: request.request_id, plans, slot_options: slotOptions };
}

/** Everyone together at each slot's first candidate; a pinned slot keeps its place and members. */
function everyoneTogether(request: PlanRequest): PlannerResponse {
  const everyone = request.members.map((m) => m.id);
  const open = request.slots.filter((s) => !s.pinned);
  return {
    request_id: request.request_id,
    engine: "mock",
    status: "feasible",
    solve_ms: 0,
    plans: [
      {
        rank: 1,
        total_score: 0.5,
        fairness: 0.5,
        split: false,
        member_scores: everyone.map((member_id) => ({ member_id, score: 0.5, preference: 0.5, cost: 0, travel: 0 })),
        assignments: request.slots.map((s) => ({
          slot_key: s.key,
          groups: [s.pinned ? { ...s.pinned } : { place_id: s.candidates[0]!.place_id, member_ids: everyone }],
        })),
      },
    ],
    slot_options: open.map((s) => ({
      slot_key: s.key,
      groups: [
        {
          member_ids: everyone,
          options: s.candidates.slice(0, 3).map((c, i) => ({
            place_id: c.place_id,
            rank: i + 1,
            score: 0.5 - i / 10,
            preference: 0.5,
            cost: 0,
            travel: 0,
            fairness: 0.5 - i / 10,
          })),
        },
      ],
    })),
    infeasible_reasons: [],
  };
}

/**
 * The optimizer's test double (AI-201): tests inject it where the optimizer client goes. The product
 * never falls back to it (design §2.2); an unreachable optimizer is an error card. It answers the
 * seeded trip's initial plan with the fixture plan from `mock-plan.json` (design §10.2), and anything
 * else with everyone together at each slot's first candidate.
 */
export function mockPlan(request: PlanRequest): PlannerResponse {
  return seededPlan(request) ?? everyoneTogether(request);
}

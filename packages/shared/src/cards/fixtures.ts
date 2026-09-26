import type { ErrorCard } from "./error";
import type { PlanCard } from "./plan";

// Valid card payloads for tests. IDs are fixed so snapshots stay stable.
const member = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const item = "00000000-0000-4000-8000-0000000000a1";
const option = "00000000-0000-4000-8000-0000000000b1";
const place = "00000000-0000-4000-8000-0000000000c1";

export const planCardFixture: PlanCard = {
  card_type: "plan",
  mode: "initial",
  engine: "enumeration",
  solve_ms: 12,
  applied_plan_rank: 1,
  plans: [
    {
      rank: 1,
      total_score: 0.8,
      fairness: 0.7,
      split: false,
      member_scores: [{ member_id: member(1), score: 0.8, preference: 0.9, cost: 0.7, travel: 0.8 }],
    },
  ],
  slots: [
    {
      slot_key: "morning",
      label: "Morning",
      starts_at: "2026-09-26T14:00:00+00:00",
      ends_at: "2026-09-26T16:30:00+00:00",
      groups: [
        {
          item_id: item,
          member_ids: [member(1), member(2)],
          options: [
            {
              option_id: option,
              place_id: place,
              name: "Georgia Aquarium",
              price_cents: 4200,
              score: 0.8,
              breakdown: { preference: 0.9, cost: 0.7, travel: 0.8, fairness: 0.7 },
              reasoning: "Best fit for Person 2's interests (animals, outdoors) · $42",
            },
          ],
        },
      ],
    },
  ],
};

export const errorCardFixture: ErrorCard = {
  card_type: "error",
  code: "provider_unavailable",
  message: "The planner is unavailable right now.",
  tool: "plan_day",
  retryable: true,
  retry_message_id: "00000000-0000-4000-8000-0000000000d1",
};

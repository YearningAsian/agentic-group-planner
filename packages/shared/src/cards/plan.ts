import { z } from "zod";
import { Cents, Timestamp } from "../common";

const Score = z.number();

export const MemberScore = z.object({
  member_id: z.uuid(),
  score: Score,
  preference: Score,
  cost: Score,
  travel: Score,
});

export const PlanSummary = z.object({
  rank: z.number().int().min(1).max(3),
  total_score: Score,
  /** The lowest member score in the plan. */
  fairness: Score,
  split: z.boolean(),
  member_scores: z.array(MemberScore),
});
export type PlanSummary = z.infer<typeof PlanSummary>;

export const OptionSnapshot = z.object({
  option_id: z.uuid(),
  place_id: z.uuid(),
  name: z.string().min(1),
  price_cents: Cents,
  score: Score,
  breakdown: z.object({ preference: Score, cost: Score, travel: Score, fairness: Score }),
  reasoning: z.string(),
});
export type OptionSnapshot = z.infer<typeof OptionSnapshot>;

export const SlotGroup = z.object({
  item_id: z.uuid(),
  member_ids: z.array(z.uuid()).min(1),
  options: z.array(OptionSnapshot).min(1).max(3),
});

/** One group means the slot is merged; two mean it's split. */
export const SlotSummary = z.object({
  slot_key: z.string().min(1),
  label: z.string().min(1),
  starts_at: Timestamp,
  ends_at: Timestamp,
  groups: z.array(SlotGroup).min(1).max(2),
});
export type SlotSummary = z.infer<typeof SlotSummary>;

export const PlanChange = z.object({
  item_id: z.uuid(),
  kind: z.enum(["time_shift", "option_changed", "attendees_changed", "superseded"]),
  before: z.string(),
  after: z.string(),
});
export type PlanChange = z.infer<typeof PlanChange>;

/**
 * The `plan_day` card: a snapshot from proposal time. Live statuses and comments come from the itinerary
 * query, not from here.
 */
export const PlanCard = z
  .object({
    card_type: z.literal("plan"),
    mode: z.enum(["initial", "replan"]),
    engine: z.enum(["cp_sat", "enumeration", "mock"]),
    solve_ms: z.number().int().min(0),
    applied_plan_rank: z.literal(1),
    plans: z.array(PlanSummary).min(1).max(3),
    slots: z.array(SlotSummary).min(1),
    changes: z.array(PlanChange).optional(),
    infeasible: z.array(z.string()).optional(),
    summary_line: z.string().max(140).optional(),
  })
  .refine((card) => card.mode === "initial" || card.changes !== undefined, {
    message: "a replan card lists its changes",
    path: ["changes"],
  });
export type PlanCard = z.infer<typeof PlanCard>;

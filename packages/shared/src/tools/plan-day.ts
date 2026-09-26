import { z } from "zod";
import { Cents } from "../common";
import { Dietary } from "../enums";
import { handleOf } from "../handles";

export const ConstraintUpdate = z.object({
  member_handle: z.union([handleOf("M"), z.literal("all")]),
  budget_cents: Cents.optional(),
  dietary: z.array(Dietary).optional(),
  interests: z.array(z.string().min(1).max(40)).max(10).optional(),
});
export type ConstraintUpdate = z.infer<typeof ConstraintUpdate>;

export const PlanDayInput = z.object({
  mode: z.enum(["initial", "replan"]),
  item_handles: z.array(handleOf("I")).min(1).max(3).optional(),
  pinned_item_handles: z.array(handleOf("I")).optional(),
  constraint_updates: z.array(ConstraintUpdate).optional(),
  options_per_slot: z.number().int().min(2).max(3).default(3),
  note: z.string().max(300).optional(),
});
export type PlanDayInput = z.infer<typeof PlanDayInput>;

import { z } from "zod";
import { Dietary } from "../enums";

const Interest = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N} ]+$/u, "interests are words and spaces only");

/**
 * What the model saves about the person who asked. Never someone else's preferences: the handler
 * writes only the requester's `person_preferences` row (plan AI-217).
 */
export const RememberPreferenceInput = z
  .object({
    /** Dietary needs to add (unioned with what is already remembered). */
    dietary: z.array(Dietary).max(7).optional(),
    /** Interests to add (unioned; each ≤ 40 chars). */
    interests: z.array(Interest).max(5).optional(),
    /** One short note in the person's own words, e.g. "hates early starts". */
    note: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => (v.dietary?.length ?? 0) > 0 || (v.interests?.length ?? 0) > 0 || v.note !== undefined, {
    message: "Say at least one dietary need, interest, or note to remember.",
  });
export type RememberPreferenceInput = z.infer<typeof RememberPreferenceInput>;

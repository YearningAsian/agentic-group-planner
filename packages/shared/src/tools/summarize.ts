import { z } from "zod";
import { handleOf } from "../handles";

/** `full`: the whole day. `personal`: one member's schedule. `next_stop`: the stop coming up next. */
export const SummaryScope = z.enum(["full", "personal", "next_stop"]);
export type SummaryScope = z.infer<typeof SummaryScope>;

/**
 * The model picks what to summarize and whose; it never supplies a number. The server computes
 * every time, count, and amount (design §2.1).
 */
export const SummarizeInput = z.object({
  scope: SummaryScope,
  /** `personal` and `next_stop`: whose schedule. Defaults to the member who asked. */
  member_handle: handleOf("M").optional(),
});
export type SummarizeInput = z.infer<typeof SummarizeInput>;

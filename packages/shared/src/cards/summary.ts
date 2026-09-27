import { z } from "zod";
import { Cents, Timestamp } from "../common";
import { ItemStatus } from "../enums";
import type { ShareStatus } from "../money/share-status";
import { SummaryScope } from "../tools/summarize";

/** A share's status on the summary card; the same values `shareStatus` returns. */
export const SummaryShareStatus = z.enum(["paid", "authorized", "pending", "awaiting_member", "fronted", "none"]);
export type SummaryShareStatus = z.infer<typeof SummaryShareStatus>;
// The card and the badges must agree on the status values.
const statusesAgree: [ShareStatus, SummaryShareStatus] extends [SummaryShareStatus, ShareStatus] ? true : never = true;
void statusesAgree;

export const SummaryTimelineEntry = z.object({
  item_id: z.uuid(),
  starts_at: Timestamp,
  label: z.string().min(1),
  /** The chosen option's place; null until the item is decided. */
  place_name: z.string().min(1).nullable(),
  attendee_ids: z.array(z.uuid()),
});
export type SummaryTimelineEntry = z.infer<typeof SummaryTimelineEntry>;

export const SummaryMemberShare = z.object({
  member_id: z.uuid(),
  /** The member's shares on live mandates, summed; declined shares count as none. */
  share_cents: Cents,
  status: SummaryShareStatus,
});
export type SummaryMemberShare = z.infer<typeof SummaryMemberShare>;

export const SummaryOpenItem = z.object({
  item_id: z.uuid(),
  label: z.string().min(1),
  status: ItemStatus,
});

/** Card `summary` (design §2.1): every number on it is computed by the server. */
export const SummaryCard = z
  .object({
    card_type: z.literal("summary"),
    scope: SummaryScope,
    /** `personal` and `next_stop`: whose schedule this is. */
    member_id: z.uuid().optional(),
    timeline: z.array(SummaryTimelineEntry),
    money: z.object({
      /** Paid, approved, and fronted shares in scope. */
      committed_cents: Cents,
      per_member: z.array(SummaryMemberShare),
    }),
    open_items: z.array(SummaryOpenItem),
    /** Built deterministically on the server. */
    logistics: z.array(z.string().min(1).max(200)).max(5),
  })
  .refine((card) => card.scope !== "personal" || card.member_id !== undefined, {
    path: ["member_id"],
    message: "a personal summary names its member",
  });
export type SummaryCard = z.infer<typeof SummaryCard>;

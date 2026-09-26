import { z } from "zod";
import { Cents, Timestamp } from "../common";

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

/** One attendee's share of the quote. */
export const ApprovalShare = z
  .object({
    member_id: z.uuid(),
    display_name: z.string().min(1),
    share_cents: Cents,
    /** `shareCapCents(share_cents, cap_percent)`: the share at the cap percent, plus its fees. */
    cap_cents: Cents,
    /** Set when the organizer fronts a placeholder's share until they join. */
    covered_by_member_id: z.uuid().nullable(),
  })
  .refine((s) => s.cap_cents >= s.share_cents, { message: "a share's cap is at least the share", path: ["cap_cents"] });
export type ApprovalShare = z.infer<typeof ApprovalShare>;

/**
 * One payer's hold (one PaymentIntent), itemized by `holdFees` on the server. The card renders
 * these numbers and never computes them, so every member sees the same amounts the server charges.
 */
export const ApprovalHold = z
  .object({
    payer_member_id: z.uuid(),
    /** The shares this hold may pay: the payer's own, plus any placeholder shares they front. */
    share_member_ids: z.array(z.uuid()).min(1),
    share_cents: Cents,
    processor_fee_cents: Cents,
    /** Required even at $0, so the card always itemizes it. */
    platform_fee_cents: Cents,
    /** What the payer's card is charged at the quote. */
    total_cents: Cents,
    /** The hold's authorized maximum: the sum of its shares' caps. */
    cap_cents: Cents,
  })
  .refine((h) => h.total_cents === h.share_cents + h.processor_fee_cents + h.platform_fee_cents, {
    message: "a hold's total is its shares plus its fees",
    path: ["total_cents"],
  })
  .refine((h) => h.cap_cents >= h.total_cents, { message: "a hold's cap covers its total", path: ["cap_cents"] });
export type ApprovalHold = z.infer<typeof ApprovalHold>;

/**
 * The `propose_purchase` card: a snapshot from when the mandate was created. Live mandate and
 * share statuses come from the mandates query, not from here.
 */
export const ApprovalCard = z
  .object({
    card_type: z.literal("approval"),
    mandate_id: z.uuid(),
    item_id: z.uuid(),
    /** "Georgia Aquarium · 4 tickets" */
    title: z.string().min(1),
    /** "Demo Tickets (mock merchant)" */
    merchant: z.string().min(1),
    /** The merchant's quote for the whole party. */
    quote_cents: Cents,
    /** The sum of the share caps. */
    cap_cents: Cents,
    /** One per member who may pay, placeholders included, so each viewer finds their own. */
    holds: z.array(ApprovalHold).min(1),
    currency: z.literal("usd"),
    expires_at: Timestamp,
    shares: z.array(ApprovalShare).min(1),
    note: z.string().max(200).optional(),
  })
  .refine((c) => c.quote_cents === sum(c.shares.map((s) => s.share_cents)), {
    message: "the shares split the whole quote",
    path: ["quote_cents"],
  })
  .refine((c) => c.cap_cents === sum(c.shares.map((s) => s.cap_cents)), {
    message: "the total cap is the sum of the share caps",
    path: ["cap_cents"],
  });
export type ApprovalCard = z.infer<typeof ApprovalCard>;

import "server-only";
import { randomUUID } from "node:crypto";
import { ApprovalCard, type ApprovalHold, ApprovalShare, holdFees } from "@agp/shared";
import { z } from "zod";
import { capFor, splitEvenly } from "@/lib/money";
import { bookingKindOf, type BookingProvider, getBookingProvider } from "@/lib/providers/booking";
import { AppError } from "@/lib/reliability";
import type { RunContext } from "@/lib/tools/define-tool";
import { mandateSummary } from "../lib/mandate-summary";
import { loadLeadGuest, MISSING_GUEST_MESSAGE } from "./lead-guest";
import { readError, rpcError } from "./rpc-error";

/** How long the group has to approve before the mandate expires (design §2.1). */
const APPROVAL_WINDOW_MS = 24 * 60 * 60_000;

export interface CreateMandateInput {
  ctx: Pick<RunContext, "tripId" | "runId" | "toolCallId" | "actorMemberId" | "admin">;
  itemId: string;
  optionId: string;
  /** 100–125; defaults to the trip's price threshold. */
  capPercent?: number;
  /** Shown on the approval card; at most 200 characters. */
  note?: string;
  /** `mandate:{run_id}:{tool_call_id}` (design §7.1); the write function checks the shape. */
  idempotencyKey: string;
  /** The merchant; defaults to the adapter for the item's kind. */
  booking?: BookingProvider;
}

export interface CreateMandateResult {
  mandateId: string;
  cardMessageId: string;
  /** The card's shares, in the members' lane order. */
  shares: ApprovalShare[];
  /** The approval card as stored: on a replay, the first call's card. */
  card: ApprovalCard;
}

interface Attendee {
  id: string;
  displayName: string;
  joined: boolean;
  sortOrder: number;
}

type ShareRow = {
  share_member_id: string;
  payer_member_id: string | null;
  kind: "own" | "fronted";
  share_cents: number;
  cap_cents: number;
  status: "pending" | "awaiting_member";
};

const RpcResult = z.object({
  mandate_id: z.uuid(),
  card_message_id: z.uuid(),
  shares: z.array(ApprovalShare),
  replayed: z.boolean(),
});

/** One hold per member who may pay: each joined attendee, each placeholder (for when they join), and the organizer's fronting. */
function holdsFor(attendees: Attendee[], organizer: Attendee, amounts: Map<string, number>, capPercent: number): ApprovalHold[] {
  const payers = new Map<string, { sortOrder: number; memberIds: string[] }>();
  const pays = (payer: Attendee, shareMemberId: string) => {
    const entry = payers.get(payer.id) ?? { sortOrder: payer.sortOrder, memberIds: [] };
    entry.memberIds.push(shareMemberId);
    payers.set(payer.id, entry);
  };
  for (const attendee of attendees) {
    pays(attendee, attendee.id);
    if (!attendee.joined) pays(organizer, attendee.id);
  }
  return [...payers.entries()]
    .sort(([, a], [, b]) => a.sortOrder - b.sortOrder)
    .map(([payerId, { memberIds }]) => {
      const fees = holdFees({ sharesCents: memberIds.map((id) => amounts.get(id)!), capPercent });
      return {
        payer_member_id: payerId,
        share_member_ids: memberIds,
        share_cents: fees.shareCents,
        processor_fee_cents: fees.processorFeeCents,
        platform_fee_cents: fees.platformFeeCents,
        total_cents: fees.totalCents,
        cap_cents: fees.capCents,
      };
    });
}

/**
 * Asks the group to pay for a decided item (`propose_purchase`, design §2.1). The server quotes
 * the merchant, splits the quote evenly across the item's attendees (the organizer absorbs
 * leftover cents), caps each share with its fees, and itemizes every payer's hold with
 * `holdFees`. A placeholder's share waits for them (`awaiting_member`) and the organizer fronts it.
 * The mandate, its share rows, and the approval card are written in one transaction
 * (`create_mandate`), keyed by `idempotencyKey`, so calling this twice for the same tool call
 * returns the same mandate and card. The write is on behalf of `ctx.actorMemberId`.
 */
export async function createMandate(input: CreateMandateInput): Promise<CreateMandateResult> {
  const { ctx } = input;
  const { admin } = ctx;

  const [tripResult, organizerResult, itemResult, optionResult, attendeeResult] = await Promise.all([
    admin.from("trips").select("price_threshold_percent").eq("id", ctx.tripId).single(),
    admin
      .from("trip_members")
      .select("id, display_name, status, sort_order, profile_id")
      .eq("trip_id", ctx.tripId)
      .eq("role", "organizer")
      .single(),
    admin.from("itinerary_items").select("status, starts_at, category").eq("id", input.itemId).eq("trip_id", ctx.tripId).maybeSingle(),
    admin
      .from("item_options")
      .select("place_id, price_cents, places(name)")
      .eq("id", input.optionId)
      .eq("item_id", input.itemId)
      .maybeSingle(),
    admin.from("item_attendees").select("trip_members(id, display_name, status, sort_order)").eq("item_id", input.itemId),
  ]);
  for (const result of [tripResult, organizerResult, itemResult, optionResult, attendeeResult]) {
    if (result.error) throw readError(result.error);
  }
  const trip = tripResult.data!;
  const item = itemResult.data;
  const option = optionResult.data;
  if (!item) throw new AppError("not_permitted", "That item belongs to another trip.");
  if (item.status === "booked") throw new AppError("conflict", "This item is already booked.");
  if (item.status !== "decided") {
    throw new AppError("invalid_input", "Only a decided item can be paid for; the group confirms it in the comments first.");
  }
  if (!option) throw new AppError("invalid_input", "That option isn't one of the item's options.");
  if (option.price_cents <= 0) throw new AppError("invalid_input", "This option is free, so there's nothing to approve.");

  const toAttendee = (m: { id: string; display_name: string; status: string; sort_order: number }): Attendee => ({
    id: m.id,
    displayName: m.display_name,
    joined: m.status === "joined",
    sortOrder: m.sort_order,
  });
  const organizer = toAttendee(organizerResult.data!);
  const attendees = attendeeResult
    .data!.flatMap((a) => (a.trip_members ? [toAttendee(a.trip_members)] : []))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (attendees.length === 0) throw new AppError("invalid_input", "Nobody is attending this item yet.");

  const kind = bookingKindOf(item.category);
  const booking = input.booking ?? getBookingProvider(kind);
  // Refused here, not at finalize, so nobody authorizes a hold for a booking that can't be made.
  if (booking.needsGuest && !(await loadLeadGuest(admin, organizerResult.data!))) {
    throw new AppError("domain_rule", MISSING_GUEST_MESSAGE);
  }
  const quote = await booking.quote({
    kind,
    placeId: option.place_id,
    optionId: input.optionId,
    partySize: attendees.length,
    startsAt: item.starts_at,
  });
  if (quote.currency !== "usd") throw new AppError("domain_rule", "Only purchases in US dollars are supported.");

  const capPercent = input.capPercent ?? trip.price_threshold_percent;
  // The organizer absorbs leftover cents; when they aren't attending, the first attendee does.
  const split = splitEvenly(quote.totalCents, attendees.length, Math.max(0, attendees.findIndex((a) => a.id === organizer.id)));
  const amounts = new Map(attendees.map((a, i) => [a.id, split[i]!]));

  const rows: ShareRow[] = attendees.flatMap((a): ShareRow[] => {
    const amount = { share_cents: amounts.get(a.id)!, cap_cents: capFor(amounts.get(a.id)!, capPercent) };
    if (a.joined) return [{ share_member_id: a.id, payer_member_id: a.id, kind: "own", status: "pending", ...amount }];
    return [
      { share_member_id: a.id, payer_member_id: null, kind: "own", status: "awaiting_member", ...amount },
      { share_member_id: a.id, payer_member_id: organizer.id, kind: "fronted", status: "pending", ...amount },
    ];
  });

  const mandateId = randomUUID();
  const unit = kind === "stays" ? "guest" : "ticket";
  const title = `${option.places?.name ?? (kind === "stays" ? "Hotel" : "Tickets")} · ${attendees.length} ${unit}${attendees.length === 1 ? "" : "s"}`;
  const card = ApprovalCard.parse({
    card_type: "approval",
    mandate_id: mandateId,
    item_id: input.itemId,
    title,
    merchant: booking.merchantName,
    quote_cents: quote.totalCents,
    cap_cents: rows.filter((r) => r.kind === "own").reduce((sum, r) => sum + r.cap_cents, 0),
    holds: holdsFor(attendees, organizer, amounts, capPercent),
    currency: "usd",
    expires_at: new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString(),
    shares: attendees.map((a) => ({
      member_id: a.id,
      display_name: a.displayName,
      share_cents: amounts.get(a.id)!,
      cap_cents: capFor(amounts.get(a.id)!, capPercent),
      covered_by_member_id: a.joined ? null : organizer.id,
    })),
    ...(input.note ? { note: input.note } : {}),
  });

  const { data, error } = await admin.rpc("create_mandate", {
    payload: {
      trip_id: ctx.tripId,
      actor_member_id: ctx.actorMemberId,
      run_id: ctx.runId,
      tool_call_id: ctx.toolCallId,
      mandate: {
        id: mandateId,
        item_id: input.itemId,
        option_id: input.optionId,
        merchant: card.merchant,
        title,
        quote_id: quote.quoteId,
        quote_cents: card.quote_cents,
        cap_cents: card.cap_cents,
        currency: card.currency,
        expires_at: card.expires_at,
        idempotency_key: input.idempotencyKey,
      },
      shares: rows,
      card,
      result_summary: mandateSummary(card),
    },
  });
  if (error) throw rpcError(error);
  const result = RpcResult.parse(data);
  let stored = card;
  if (result.replayed) {
    // The first call wrote its own mandate ID and expiry into the card; return that card.
    const message = await admin.from("messages").select("card_payload").eq("id", result.card_message_id).single();
    if (message.error) throw readError(message.error, "the approval card");
    stored = ApprovalCard.parse(message.data.card_payload);
  }
  return { mandateId: result.mandate_id, cardMessageId: result.card_message_id, shares: result.shares, card: stored };
}

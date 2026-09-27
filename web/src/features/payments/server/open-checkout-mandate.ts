import "server-only";
import { randomUUID } from "node:crypto";
import { approvalDeadline, bookingKindOf, bookingOptionId, type BookingProvider, createMockMerchant } from "@/lib/providers/booking";
import { AppError } from "@/lib/reliability";
import { capFor, splitEvenly } from "@/lib/money";
import { type AdminClient, getAdminClient } from "@/lib/supabase/admin";
import { readError } from "./rpc-error";

const SAVED_TRIP = "A saved trip with a decided option is required before checkout.";
const LIVE = ["open", "partially_declined", "authorized"];

export interface OpenCheckoutInput {
  tripId: string;
  itemId: string;
  optionId: string;
  profileId: string;
}

export interface CheckoutHold {
  memberId: string;
  name: string;
  capCents: number;
  status: string;
}

export interface OpenCheckoutMandate {
  mandateId: string;
  tripId: string;
  currency: string;
  holds: CheckoutHold[];
}

export interface OpenCheckoutDeps {
  admin?: AdminClient;
  booking?: BookingProvider;
  now?: number;
}

type Joined = { id: string; displayName: string; sortOrder: number };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/**
 * Opens a group-checkout mandate for a decided item: one pending own-hold per joined attendee.
 * A live mandate for the item is reused. Amounts come from the mock merchant, not the client.
 */
export async function openCheckoutMandate(input: OpenCheckoutInput, deps: OpenCheckoutDeps = {}): Promise<OpenCheckoutMandate> {
  const admin = deps.admin ?? getAdminClient();
  const now = deps.now ?? Date.now();

  const [tripResult, organizerResult, itemResult, optionResult, attendeeResult] = await Promise.all([
    admin.from("trips").select("price_threshold_percent, timezone").eq("id", input.tripId).maybeSingle(),
    admin
      .from("trip_members")
      .select("id, display_name, sort_order")
      .eq("trip_id", input.tripId)
      .eq("role", "organizer")
      .eq("status", "joined")
      .eq("profile_id", input.profileId)
      .maybeSingle(),
    admin.from("itinerary_items").select("status, starts_at, ends_at, category").eq("id", input.itemId).eq("trip_id", input.tripId).maybeSingle(),
    admin
      .from("item_options")
      .select("place_id, price_cents, places(name, provider, raw)")
      .eq("id", input.optionId)
      .eq("item_id", input.itemId)
      .maybeSingle(),
    admin.from("item_attendees").select("trip_members(id, display_name, status, sort_order)").eq("item_id", input.itemId),
  ]);
  for (const result of [tripResult, organizerResult, itemResult, optionResult, attendeeResult]) {
    if (result.error) throw readError(result.error, "the purchase");
  }
  const trip = tripResult.data;
  const item = itemResult.data;
  const option = optionResult.data;
  if (!trip || !item || !option) throw new AppError("invalid_input", SAVED_TRIP);
  if (!organizerResult.data) throw new AppError("not_permitted", "Only the organizer can open checkout.");
  if (item.status === "booked") throw new AppError("conflict", "This item is already booked.");
  if (item.status !== "decided") {
    throw new AppError("invalid_input", "Only a decided item can be paid for; the group confirms it in the comments first.");
  }
  if (option.price_cents <= 0) throw new AppError("invalid_input", "This option is free, so there's nothing to pay.");

  const joined: Joined[] = attendeeResult
    .data!.flatMap((row) => (row.trip_members && row.trip_members.status === "joined" ? [row.trip_members] : []))
    .map((member) => ({ id: member.id, displayName: member.display_name, sortOrder: member.sort_order }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (joined.length === 0) throw new AppError("invalid_input", "Nobody is attending this item yet.");

  const organizer = organizerResult.data;
  let mandate = await liveMandate(admin, input.itemId);
  if (mandate?.status === "authorized") throw new AppError("conflict", "This purchase is already being booked.");

  let holds = mandate ? await loadHolds(admin, mandate.id) : [];
  const missing = joined.filter((member) => !holds.some((hold) => hold.share_member_id === member.id));
  if (!mandate || missing.length > 0) {
    const kind = bookingKindOf(item.category);
    const booking = deps.booking ?? createMockMerchant(kind === "stays" ? { kind } : {});
    const quotedOptionId = bookingOptionId({
      bookingProvider: booking.id,
      optionId: input.optionId,
      place: option.places,
      itemId: input.itemId,
      tripId: input.tripId,
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      guests: joined.length,
      timezone: trip.timezone,
      now,
    });
    const quote = await booking.quote({
      kind,
      placeId: option.place_id,
      optionId: quotedOptionId,
      partySize: joined.length,
      startsAt: item.starts_at,
    });
    if (quote.currency !== "usd") throw new AppError("domain_rule", "Only purchases in US dollars are supported.");
    const organizerIndex = joined.findIndex((member) => member.id === organizer.id);
    const shares = splitEvenly(quote.totalCents, joined.length, organizerIndex === -1 ? 0 : organizerIndex);
    const amounts = joined.map((member, index) => ({
      member,
      shareCents: shares[index]!,
      capCents: capFor(shares[index]!, trip.price_threshold_percent),
    }));
    if (!mandate) {
      const placeName = option.places?.name ?? (kind === "stays" ? "Hotel" : "Tickets");
      const unit = kind === "stays" ? "guest" : "ticket";
      const title = `${placeName} · ${joined.length} ${unit}${joined.length === 1 ? "" : "s"}`;
      mandate = await insertMandate(admin, {
        tripId: input.tripId,
        itemId: input.itemId,
        optionId: input.optionId,
        merchant: booking.merchantName,
        title,
        quoteId: quote.quoteId,
        quoteCents: quote.totalCents,
        capCents: amounts.reduce((sum, row) => sum + row.capCents, 0),
        expiresAt: approvalDeadline({ now }),
      });
      if (mandate.status === "authorized") throw new AppError("conflict", "This purchase is already being booked.");
    }
    const toWrite = amounts.filter((row) => missing.some((member) => member.id === row.member.id) || !holds.some((hold) => hold.share_member_id === row.member.id));
    if (toWrite.length > 0) {
      const saved = await admin.from("payment_holds").upsert(
        toWrite.map((row) => ({
          trip_id: input.tripId,
          mandate_id: mandate!.id,
          payer_member_id: row.member.id,
          share_member_id: row.member.id,
          kind: "own",
          share_cents: row.shareCents,
          cap_cents: row.capCents,
          status: "pending",
          idempotency_key: `share:${mandate!.id}:${row.member.id}:own`,
        })),
        { onConflict: "idempotency_key", ignoreDuplicates: true },
      );
      if (saved.error) throw readError(saved.error, "the holds");
      holds = await loadHolds(admin, mandate.id);
    }
  }

  const names = new Map(joined.map((member) => [member.id, member.displayName]));
  return {
    mandateId: mandate.id,
    tripId: input.tripId,
    currency: mandate.currency,
    holds: holds
      .filter((hold) => names.has(hold.share_member_id))
      .map((hold) => ({
        memberId: hold.share_member_id,
        name: names.get(hold.share_member_id) ?? "Traveler",
        capCents: hold.cap_cents,
        status: hold.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function liveMandate(admin: AdminClient, itemId: string) {
  const { data, error } = await admin
    .from("mandates")
    .select("id, status, currency")
    .eq("item_id", itemId)
    .in("status", LIVE)
    .maybeSingle();
  if (error) throw readError(error, "the purchase");
  return data;
}

async function loadHolds(admin: AdminClient, mandateId: string) {
  const { data, error } = await admin
    .from("payment_holds")
    .select("share_member_id, cap_cents, status")
    .eq("mandate_id", mandateId)
    .eq("kind", "own");
  if (error) throw readError(error, "the holds");
  return data;
}

async function insertMandate(
  admin: AdminClient,
  row: {
    tripId: string;
    itemId: string;
    optionId: string;
    merchant: string;
    title: string;
    quoteId: string;
    quoteCents: number;
    capCents: number;
    expiresAt: string;
  },
) {
  const inserted = await admin
    .from("mandates")
    .insert({
      id: randomUUID(),
      trip_id: row.tripId,
      item_id: row.itemId,
      option_id: row.optionId,
      merchant: row.merchant,
      title: row.title,
      quote_id: row.quoteId,
      quote_cents: row.quoteCents,
      cap_cents: row.capCents,
      currency: "usd",
      status: "open",
      expires_at: row.expiresAt,
      idempotency_key: `group-checkout:${row.itemId}`,
    })
    .select("id, status, currency")
    .maybeSingle();
  if (inserted.error && isUniqueViolation(inserted.error)) {
    const existing = await liveMandate(admin, row.itemId);
    if (!existing) throw readError(inserted.error, "the purchase");
    return existing;
  }
  if (inserted.error) throw readError(inserted.error, "the purchase");
  if (!inserted.data) throw new AppError("internal", "Couldn't open checkout.", { retryable: true });
  return inserted.data;
}

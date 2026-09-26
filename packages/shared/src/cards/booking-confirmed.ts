import { z } from "zod";
import { Cents, Timestamp } from "../common";
import { BookingProvider, PayerType } from "../enums";

/** Written by the server once a booking is confirmed; not a tool card. */
export const BookingConfirmedCard = z
  .object({
    card_type: z.literal("booking_confirmed"),
    booking_id: z.uuid(),
    item_id: z.uuid(),
    provider: BookingProvider,
    title: z.string().min(1),
    starts_at: Timestamp,
    party_size: z.number().int().min(1),
    /** Null only for a pay-at-venue reservation, where nothing is charged through the app. */
    total_cents: Cents.nullable(),
    payer: PayerType,
    confirmation_code: z.string().min(1).nullable(),
  })
  .refine((c) => c.total_cents !== null || c.payer === "pay_at_venue", {
    message: "only a pay-at-venue booking has no total",
    path: ["total_cents"],
  });
export type BookingConfirmedCard = z.infer<typeof BookingConfirmedCard>;

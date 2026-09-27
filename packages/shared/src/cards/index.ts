import { z } from "zod";
import type { CardType } from "../enums";
import { ApprovalCard } from "./approval";
import { BookingConfirmedCard } from "./booking-confirmed";
import { ErrorCard } from "./error";
import { ItineraryChangeCard } from "./itinerary-change";
import { MemberJoinedCard } from "./member-joined";
import { PlaceListCard } from "./place-list";
import { PlanCard } from "./plan";
import { PriceChangeCard } from "./price-change";
import { SummaryCard } from "./summary";

export * from "./approval";
export * from "./booking-confirmed";
export * from "./error";
export * from "./itinerary-change";
export * from "./member-joined";
export * from "./place-list";
export * from "./plan";
export * from "./price-change";
export * from "./summary";

/** Each card's payload schema, keyed by card type. */
export const cardSchemas = {
  place_list: PlaceListCard,
  plan: PlanCard,
  itinerary_change: ItineraryChangeCard,
  summary: SummaryCard,
  approval: ApprovalCard,
  booking_confirmed: BookingConfirmedCard,
  price_change: PriceChangeCard,
  member_joined: MemberJoinedCard,
  error: ErrorCard,
} as const satisfies Record<CardType, z.ZodType>;

/** A card message's payload, discriminated on `card_type`. */
export const CardPayload = z.discriminatedUnion("card_type", [
  PlaceListCard,
  PlanCard,
  ItineraryChangeCard,
  SummaryCard,
  ApprovalCard,
  BookingConfirmedCard,
  PriceChangeCard,
  MemberJoinedCard,
  ErrorCard,
]);
export type CardPayload = z.infer<typeof CardPayload>;

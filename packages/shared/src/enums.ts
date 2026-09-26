import { z } from "zod";

/**
 * Every enum in the data model. The database stores them as text with CHECK constraints listing
 * the same values, so a new value means a migration and a change here, together.
 */
export const TripStatus = z.enum(["planning", "active", "completed"]);
export const MemberRole = z.enum(["organizer", "member"]);
export const MemberStatus = z.enum(["placeholder", "invited", "joined"]);
export const Dietary = z.enum(["vegetarian", "vegan", "gluten_free", "halal", "kosher", "nut_free", "dairy_free"]);
export const PlaceCategory = z.enum(["food", "activity", "dessert", "nightlife", "lodging", "other"]);
export const ItemStatus = z.enum(["tbd", "proposing", "voting", "decided", "booked", "cancelled", "superseded"]);
export const OptionSource = z.enum(["cp_sat", "enumeration", "mock", "manual"]);
export const RouteMode = z.enum(["walking", "driving"]);
export const MandateStatus = z.enum(["open", "partially_declined", "authorized", "captured", "cancelled", "failed"]);
export const HoldStatus = z.enum([
  "awaiting_member",
  "pending",
  "authorized",
  "captured",
  "refunded",
  "released",
  "declined",
  "failed",
  "expired",
]);
export const HoldKind = z.enum(["own", "fronted"]);
export const BookingProvider = z.enum(["mock_merchant", "duffel_stays", "stays_mock"]);
export const BookingStatus = z.enum(["pending", "confirmed", "failed", "cancelled"]);
export const PayerType = z.enum(["split", "organizer", "pay_at_venue"]);
export const PriceAction = z.enum(["auto_captured", "auto_captured_lower", "reapproval_requested", "notified"]);
export const SenderType = z.enum(["member", "agent", "system"]);
export const MessageKind = z.enum(["text", "card"]);
export const CardType = z.enum([
  "place_list",
  "plan",
  "itinerary_change",
  "summary",
  "approval",
  "booking_confirmed",
  "price_change",
  "member_joined",
  "error",
]);
export const RunTrigger = z.enum(["mention", "price_change", "demo"]);
export const RunStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export const ToolName = z.enum(["search_places", "plan_day", "update_item", "summarize", "propose_purchase"]);
export const ToolStatus = z.enum(["started", "succeeded", "failed"]);
export const WebhookProvider = z.enum(["stripe"]);
export const WebhookStatus = z.enum(["received", "processed", "ignored", "failed"]);

export type TripStatus = z.infer<typeof TripStatus>;
export type MemberRole = z.infer<typeof MemberRole>;
export type MemberStatus = z.infer<typeof MemberStatus>;
export type Dietary = z.infer<typeof Dietary>;
export type PlaceCategory = z.infer<typeof PlaceCategory>;
export type ItemStatus = z.infer<typeof ItemStatus>;
export type OptionSource = z.infer<typeof OptionSource>;
export type RouteMode = z.infer<typeof RouteMode>;
export type MandateStatus = z.infer<typeof MandateStatus>;
export type HoldStatus = z.infer<typeof HoldStatus>;
export type HoldKind = z.infer<typeof HoldKind>;
export type BookingProvider = z.infer<typeof BookingProvider>;
export type BookingStatus = z.infer<typeof BookingStatus>;
export type PayerType = z.infer<typeof PayerType>;
export type PriceAction = z.infer<typeof PriceAction>;
export type SenderType = z.infer<typeof SenderType>;
export type MessageKind = z.infer<typeof MessageKind>;
export type CardType = z.infer<typeof CardType>;
export type RunTrigger = z.infer<typeof RunTrigger>;
export type RunStatus = z.infer<typeof RunStatus>;
export type ToolName = z.infer<typeof ToolName>;
export type ToolStatus = z.infer<typeof ToolStatus>;
export type WebhookProvider = z.infer<typeof WebhookProvider>;
export type WebhookStatus = z.infer<typeof WebhookStatus>;

/** The enums keyed by their database name, for tests and for code that maps columns to schemas. */
export const enums = {
  trip_status: TripStatus,
  member_role: MemberRole,
  member_status: MemberStatus,
  dietary: Dietary,
  place_category: PlaceCategory,
  item_status: ItemStatus,
  option_source: OptionSource,
  route_mode: RouteMode,
  mandate_status: MandateStatus,
  hold_status: HoldStatus,
  hold_kind: HoldKind,
  booking_provider: BookingProvider,
  booking_status: BookingStatus,
  payer_type: PayerType,
  price_action: PriceAction,
  sender_type: SenderType,
  message_kind: MessageKind,
  card_type: CardType,
  run_trigger: RunTrigger,
  run_status: RunStatus,
  tool_name: ToolName,
  tool_status: ToolStatus,
  webhook_provider: WebhookProvider,
  webhook_status: WebhookStatus,
} as const;

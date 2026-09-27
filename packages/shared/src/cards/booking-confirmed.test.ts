import { describe, expect, it } from "vitest";
import { BookingConfirmedCard } from "./booking-confirmed";

const card = {
  card_type: "booking_confirmed",
  booking_id: "00000000-0000-4000-8000-0000000000f1",
  item_id: "00000000-0000-4000-8000-0000000000a1",
  provider: "mock_merchant",
  title: "Georgia Aquarium · 4 tickets",
  starts_at: "2026-09-26T14:00:00+00:00",
  party_size: 4,
  total_cents: 16800,
  payer: "split",
  confirmation_code: "GA4K2P",
};

describe("booking_confirmed card", () => {
  it("booking_confirmed allows a null total for pay at venue", () => {
    expect(BookingConfirmedCard.parse(card)).toEqual(card);
    const atVenue = { ...card, total_cents: null, payer: "pay_at_venue", confirmation_code: null };
    expect(BookingConfirmedCard.safeParse(atVenue).success).toBe(true);
    // Anything the group pays through the app has a total.
    expect(BookingConfirmedCard.safeParse({ ...card, total_cents: null }).success).toBe(false);
    expect(BookingConfirmedCard.safeParse({ ...card, provider: "voice_reservation" }).success).toBe(false);
    expect(BookingConfirmedCard.safeParse({ ...card, party_size: 0 }).success).toBe(false);
  });
});

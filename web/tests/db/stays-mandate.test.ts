import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveHold, finalizeMandate } from "@/features/payments/server";
import { type BookingProvider, getBookingProvider } from "@/lib/providers/booking";
import { addMandate, mandateRow, paymentsKit, type MandateScenario } from "../payments/kit";
import { adminClient, cleanup, createTrip, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];

async function lodgingMandate(
  opts: { booking?: BookingProvider; organizer?: TestUser; onTrip?: (tripId: string) => void } = {},
): Promise<MandateScenario> {
  const { booking, organizer = payers[0], onTrip } = opts;
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: organizer.userId },
      { displayName: "Person 2", profileId: payers[1].userId },
      { displayName: "Person 3", profileId: payers[2].userId },
      { displayName: "Person 4", inviteToken: `invite-${randomUUID()}` },
    ],
  });
  onTrip?.(tripId);
  const slot = { key: "hotel", startsAt: "2026-09-26T22:00:00Z", endsAt: "2026-09-27T15:00:00Z" };
  return addMandate(batch, { tripId, person: memberIds as MandateScenario["person"] }, slot, "lodging", booking);
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

const MISSING_GUEST = "Booking a hotel needs the organizer's email and phone number on their account.";

async function approveAll(s: MandateScenario) {
  for (const memberId of s.person.slice(0, 3)) {
    await approveHold({ mandateId: s.mandateId, memberId }, { finalize: async () => {} });
  }
}

/** Sets or clears the phone in a user's metadata; auth merges the rest, and null removes a key. */
async function setPhone(userId: string, phone: string | null) {
  const updated = await admin.auth.admin.updateUserById(userId, { user_metadata: { phone } });
  if (updated.error) throw updated.error;
  return updated.data.user;
}

async function select<T>(table: "bookings" | "payment_holds", columns: string, mandateId: string): Promise<T[]> {
  const { data, error } = await admin.from(table).select(columns).eq("mandate_id", mandateId);
  if (error) throw error;
  return data as T[];
}

describe("a lodging item books through the stays adapter", () => {
  it("the mandate names the hotel merchant and counts guests", async () => {
    const s = await lodgingMandate();
    expect(await mandateRow(s.mandateId)).toMatchObject({ merchant: "Demo Hotels (mock merchant)", title: "Midtown Inn · 4 guests" });
  });

  it("finalize picks the stays adapter itself and records its provider on the booking and its card", async () => {
    const s = await lodgingMandate();
    await approveAll(s);

    expect(await finalizeMandate(s.mandateId)).toEqual({ status: "captured" });

    expect(await select<{ provider: string }>("bookings", "provider", s.mandateId)).toEqual([{ provider: "stays_mock" }]);
    const { data: cards } = await admin.from("messages").select("card_payload").eq("trip_id", s.tripId).eq("card_type", "booking_confirmed");
    expect(cards!.map((c) => (c.card_payload as { provider: string }).provider)).toEqual(["stays_mock"]);
  });

  it("finalize quotes and books kind stays", async () => {
    const s = await lodgingMandate();
    await approveAll(s);
    const stays = getBookingProvider("stays");
    const booking = { ...stays, quote: vi.fn(stays.quote.bind(stays)), book: vi.fn(stays.book.bind(stays)) };

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "captured" });
    expect(booking.quote).toHaveBeenCalledWith(expect.objectContaining({ kind: "stays", partySize: 4 }));
    expect(booking.book).toHaveBeenCalledWith(expect.objectContaining({ kind: "stays", idempotencyKey: `booking:${s.mandateId}` }));
  });

  it("a hotel that needs a lead guest is refused before any hold when the organizer has no phone number", async () => {
    const stays = getBookingProvider("stays");
    let tripId = "";
    const refused = lodgingMandate({ booking: { ...stays, needsGuest: true }, onTrip: (id) => (tripId = id) });
    await expect(refused).rejects.toMatchObject({ code: "domain_rule", message: MISSING_GUEST });
    const { data: mandates, error } = await admin.from("mandates").select("id").eq("trip_id", tripId);
    if (error) throw error;
    expect(mandates).toEqual([]);
    const { data: holds } = await admin.from("payment_holds").select("id").eq("trip_id", tripId);
    expect(holds).toEqual([]);
  });

  it("a hotel that needs a lead guest books with the organizer's name, email, and phone", async () => {
    const organizer = await kit.createPayer(batch, "Ada Lovelace");
    const user = await setPhone(organizer.userId, "+14045550100");
    const stays = getBookingProvider("stays");
    const booking = { ...stays, needsGuest: true, book: vi.fn(stays.book.bind(stays)) };
    const s = await lodgingMandate({ booking, organizer });
    await approveAll(s);

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "captured" });
    expect(booking.book).toHaveBeenCalledWith(
      expect.objectContaining({ guest: { givenName: "Person", familyName: "1", email: user.email, phoneNumber: "+14045550100" } }),
    );
  });

  it("a guest who disappears after approval leaves the adapter to fail the booking, and every hold is released", async () => {
    const organizer = await kit.createPayer(batch, "Grace Hopper");
    await setPhone(organizer.userId, "+14045550101");
    const stays = getBookingProvider("stays");
    // Like Duffel: with no guest and no earlier booking under the key, the booking fails.
    const book = vi.fn(async (input: Parameters<typeof stays.book>[0]) =>
      input.guest ? stays.book(input) : { status: "failed" as const, providerRef: null, failureReason: "missing_guest" },
    );
    const booking = { ...stays, needsGuest: true, book };
    const s = await lodgingMandate({ booking, organizer });
    await approveAll(s);
    await setPhone(organizer.userId, null);

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "cancelled" });
    expect(book).toHaveBeenCalledWith(expect.not.objectContaining({ guest: expect.anything() }));
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "booking_failed" });
    const holds = await select<{ status: string }>("payment_holds", "status", s.mandateId);
    expect(holds.map((h) => h.status)).toEqual(Array(holds.length).fill("released"));
    expect(await select("bookings", "id", s.mandateId)).toEqual([]);
  });

  it("a mandate approved for one merchant is cancelled, not booked elsewhere, if the adapter changed before any quote", async () => {
    const s = await lodgingMandate();
    await approveAll(s);
    const tickets = getBookingProvider("tickets");
    const booking = { ...tickets, quote: vi.fn(tickets.quote.bind(tickets)) };

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "cancelled" });
    expect(booking.quote).not.toHaveBeenCalled();
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "booking_failed" });
  });
});
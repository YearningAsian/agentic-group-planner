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

describe("a lodging item books through the stays adapter", () => {
  it("the mandate names the hotel merchant and counts guests", async () => {
    const s = await lodgingMandate();
    expect(await mandateRow(s.mandateId)).toMatchObject({ merchant: "Demo Hotels (mock merchant)", title: "Midtown Inn · 4 guests" });
  });

  it("a hotel that needs a lead guest is refused before any hold when the organizer has no phone number", async () => {
    const stays = getBookingProvider("stays");
    let tripId = "";
    const refused = lodgingMandate({ booking: { ...stays, needsGuest: true }, onTrip: (id) => (tripId = id) });
    await expect(refused).rejects.toMatchObject({ code: "domain_rule" });
    const { data, error } = await admin.from("mandates").select("id").eq("trip_id", tripId);
    if (error) throw error;
    expect(data).toEqual([]);
  });

  it("finalize quotes and books kind stays, and records the stays provider on the booking and its card", async () => {
    const s = await lodgingMandate();
    for (const memberId of s.person.slice(0, 3)) {
      await approveHold({ mandateId: s.mandateId, memberId }, { finalize: async () => {} });
    }
    const stays = getBookingProvider("stays");
    const booking = { ...stays, quote: vi.fn(stays.quote.bind(stays)), book: vi.fn(stays.book.bind(stays)) };

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "captured" });

    expect(booking.quote).toHaveBeenCalledWith(expect.objectContaining({ kind: "stays", partySize: 4 }));
    expect(booking.book).toHaveBeenCalledWith(expect.objectContaining({ kind: "stays", idempotencyKey: `booking:${s.mandateId}` }));
    const { data: rows, error } = await admin.from("bookings").select("provider").eq("mandate_id", s.mandateId);
    if (error) throw error;
    expect(rows).toEqual([{ provider: "stays_mock" }]);
    const { data: cards } = await admin.from("messages").select("card_payload").eq("trip_id", s.tripId).eq("card_type", "booking_confirmed");
    expect(cards!.map((c) => (c.card_payload as { provider: string }).provider)).toEqual(["stays_mock"]);
  });

  it("a hotel that needs a lead guest books with the organizer's name, email, and phone", async () => {
    const organizer = await kit.createPayer(batch, "Ada Lovelace");
    const { data: user, error } = await admin.auth.admin.updateUserById(organizer.userId, {
      user_metadata: { seed_batch: batch, display_name: "Ada Lovelace", phone: "+14045550100" },
    });
    if (error) throw error;
    const stays = getBookingProvider("stays");
    const booking = { ...stays, needsGuest: true, book: vi.fn(stays.book.bind(stays)) };
    const s = await lodgingMandate({ booking, organizer });
    for (const memberId of s.person.slice(0, 3)) {
      await approveHold({ mandateId: s.mandateId, memberId }, { finalize: async () => {} });
    }

    expect(await finalizeMandate(s.mandateId, { booking })).toEqual({ status: "captured" });
    expect(booking.book).toHaveBeenCalledWith(
      expect.objectContaining({ guest: { givenName: "Person", familyName: "1", email: user.user.email, phoneNumber: "+14045550100" } }),
    );
  });
});

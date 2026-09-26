import { BookingConfirmedCard } from "@agp/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveHold, finalizeMandate } from "@/features/payments/server";
import { getBookingProvider } from "@/lib/providers/booking";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { mandateRow, mandateScenario, paymentsKit, shareRows, type MandateScenario } from "../payments/kit";
import { adminClient, cleanup, createTrip, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];

/** The real provider, with capture counted. */
function counted() {
  const real = getPaymentsProvider();
  const capture = vi.fn(real.capture.bind(real));
  const payments: PaymentsProvider = { ...real, name: real.name, capture, parseWebhook: real.parseWebhook.bind(real) };
  return { payments, capture };
}

/** Persons 1–3 approved, and the mandate won open → authorized, but nobody has finalized it yet. */
async function authorizedMandate(): Promise<MandateScenario> {
  const s = await mandateScenario(batch, payers);
  for (const memberId of s.person.slice(0, 3)) {
    await approveHold({ mandateId: s.mandateId, memberId }, { finalize: async () => {} });
  }
  expect((await mandateRow(s.mandateId)).status).toBe("authorized");
  return s;
}

async function bookings(mandateId: string) {
  const { data, error } = await admin.from("bookings").select("*").eq("mandate_id", mandateId);
  if (error) throw error;
  return data;
}

async function confirmedCards(tripId: string) {
  const { data, error } = await admin.from("messages").select("*").eq("trip_id", tripId).eq("card_type", "booking_confirmed");
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("finalizeMandate", () => {
  it("two concurrent finalizers produce one booking and one capture per PaymentIntent", async () => {
    const s = await authorizedMandate();
    const { payments, capture } = counted();

    const results = await Promise.all([finalizeMandate(s.mandateId, { payments }), finalizeMandate(s.mandateId, { payments })]);

    expect(results.map((r) => r.status)).toContain("captured");
    expect(await bookings(s.mandateId)).toHaveLength(1);
    const intents = capture.mock.calls.map(([input]) => input.paymentIntentId);
    expect(intents).toHaveLength(3);
    expect(new Set(intents).size).toBe(3);
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
    // A later call finds the work done.
    expect(await finalizeMandate(s.mandateId, { payments })).toEqual({ status: "captured" });
    expect(capture).toHaveBeenCalledTimes(3);
  });

  it("each PaymentIntent is captured once, with amount_to_capture equal to holdFees' total for the rows it pays", async () => {
    const s = await authorizedMandate();
    const { payments, capture } = counted();
    await finalizeMandate(s.mandateId, { payments });

    const rows = await shareRows(s.mandateId);
    const [person1, person2, person3, person4] = s.person;
    const intentOf = (key: string) => rows.get(key)!.stripe_payment_intent_id;
    expect(capture.mock.calls.map(([input]) => input).sort((a, b) => b.amountCents - a.amountCents)).toEqual([
      { paymentIntentId: intentOf(`${person1}:own`), amountCents: 8682, idempotencyKey: `pi-capture:${s.mandateId}:${person1}` },
      expect.objectContaining({ amountCents: 4357 }),
      expect.objectContaining({ amountCents: 4357 }),
    ]);
    expect(capture).toHaveBeenCalledWith({ paymentIntentId: intentOf(`${person2}:own`), amountCents: 4357, idempotencyKey: `pi-capture:${s.mandateId}:${person2}` });
    expect(capture).toHaveBeenCalledWith({ paymentIntentId: intentOf(`${person3}:own`), amountCents: 4357, idempotencyKey: `pi-capture:${s.mandateId}:${person3}` });

    // The fronted row pays Person 4's share; their own row still waits for them to join.
    expect(rows.get(`${person4}:fronted`)).toMatchObject({ status: "captured", pays_share: true, captured_cents: 4325 });
    expect(rows.get(`${person1}:own`)).toMatchObject({ status: "captured", pays_share: true, captured_cents: 4357 });
    expect(rows.get(`${person4}:own`)).toMatchObject({ status: "awaiting_member", pays_share: null });
    expect((await mandateRow(s.mandateId)).final_cents).toBe(8682 + 4357 * 2);
  });

  it("a book() failure releases every hold and cancels the mandate with booking_failed", async () => {
    const s = await authorizedMandate();
    const merchant = getBookingProvider("tickets");
    const booking = { ...merchant, book: async () => ({ status: "failed" as const, providerRef: null, failureReason: "sold_out" }) };
    const { payments, capture } = counted();

    expect(await finalizeMandate(s.mandateId, { payments, booking })).toEqual({ status: "cancelled" });

    expect(capture).not.toHaveBeenCalled();
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "booking_failed" });
    const rows = await shareRows(s.mandateId);
    expect([...rows.values()].map((r) => r.status)).toEqual(Array(5).fill("released"));
    for (const memberId of s.person.slice(0, 3)) {
      const intent = rows.get(`${memberId}:own`)!.stripe_payment_intent_id!;
      expect((await kit.eventsFor(intent)).map((e) => e.type)).toContain("payment_intent.canceled");
    }
    expect(await bookings(s.mandateId)).toEqual([]);
    const { data: item } = await admin.from("itinerary_items").select("status").eq("id", s.itemId).single();
    expect(item!.status).toBe("decided");
  });

  it("a changed merchant price cancels the unbooked mandate and releases every authorization", async () => {
    const s = await authorizedMandate();
    const merchant = getBookingProvider("tickets");
    const booking = {
      ...merchant,
      quote: async (input: Parameters<typeof merchant.quote>[0]) => ({ ...(await merchant.quote(input)), totalCents: 17_000 }),
      book: vi.fn(merchant.book.bind(merchant)),
    };
    const { payments, capture } = counted();
    const release = vi.fn(payments.release.bind(payments));

    expect(await finalizeMandate(s.mandateId, { payments: { ...payments, release }, booking })).toEqual({ status: "cancelled" });
    expect(booking.book).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(3);
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "price_changed" });
    expect([...((await shareRows(s.mandateId)).values())].map((r) => r.status)).toEqual(Array(5).fill("released"));
    expect(await bookings(s.mandateId)).toEqual([]);
  });

  it("a merchant currency change also cancels before booking or capture", async () => {
    const s = await authorizedMandate();
    const merchant = getBookingProvider("tickets");
    const booking = {
      ...merchant,
      quote: async (input: Parameters<typeof merchant.quote>[0]) => ({ ...(await merchant.quote(input)), currency: "eur" }),
      book: vi.fn(merchant.book.bind(merchant)),
    };
    const { payments, capture } = counted();

    expect(await finalizeMandate(s.mandateId, { payments, booking })).toEqual({ status: "cancelled" });
    expect(booking.book).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "price_changed" });
  });

  it("keeps the cancellation decision if releasing a hold fails and retries the release", async () => {
    const s = await authorizedMandate();
    const merchant = getBookingProvider("tickets");
    const booking = {
      ...merchant,
      quote: vi.fn(async (input: Parameters<typeof merchant.quote>[0]) => ({ ...(await merchant.quote(input)), totalCents: 17_000 })),
      book: vi.fn(merchant.book.bind(merchant)),
    };
    const real = getPaymentsProvider();
    let failed = false;
    const payments: PaymentsProvider = {
      ...real,
      parseWebhook: real.parseWebhook.bind(real),
      release: async (input) => {
        if (!failed) {
          failed = true;
          throw new Error("temporary release failure");
        }
        return real.release(input);
      },
    };

    await expect(finalizeMandate(s.mandateId, { payments, booking })).rejects.toThrow("temporary release failure");
    // Until every old authorization is released, the live-mandate index must block a replacement.
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "authorized", cancel_reason: "price_changed" });
    expect(await finalizeMandate(s.mandateId, { payments, booking })).toEqual({ status: "cancelled" });
    expect(booking.quote).toHaveBeenCalledTimes(1);
    expect(booking.book).not.toHaveBeenCalled();
    expect([...((await shareRows(s.mandateId)).values())].map((r) => r.status)).toEqual(Array(5).fill("released"));
  });

  it("a retry uses its persisted booking quote after booking and a partial capture", async () => {
    const s = await authorizedMandate();
    const merchant = getBookingProvider("tickets");
    const quote = vi.fn(merchant.quote.bind(merchant));
    const book = vi.fn(merchant.book.bind(merchant));
    const booking = { ...merchant, quote, book };
    const real = getPaymentsProvider();
    let captureCalls = 0;
    const payments: PaymentsProvider = {
      ...real,
      parseWebhook: real.parseWebhook.bind(real),
      capture: async (input) => {
        captureCalls++;
        if (captureCalls === 2) throw new Error("temporary capture failure");
        return real.capture(input);
      },
    };

    await expect(finalizeMandate(s.mandateId, { payments, booking })).rejects.toThrow("temporary capture failure");
    expect((await mandateRow(s.mandateId)).status).toBe("authorized");
    const restartedBooking = {
      ...merchant,
      quote: vi.fn(async () => { throw new Error("an expired quote cannot be refreshed after a capture"); }),
      book: vi.fn(async () => { throw new Error("an expired quote cannot be booked again"); }),
    };
    expect(await finalizeMandate(s.mandateId, { payments: real, booking: restartedBooking })).toEqual({ status: "captured" });
    expect(quote).toHaveBeenCalledTimes(1);
    expect(book).toHaveBeenCalledTimes(1);
    expect(restartedBooking.quote).not.toHaveBeenCalled();
    expect(restartedBooking.book).not.toHaveBeenCalled();
    expect(await bookings(s.mandateId)).toHaveLength(1);
    expect((await mandateRow(s.mandateId)).final_cents).toBe(8682 + 4357 * 2);
  });

  it("the item ends booked and pinned, with exactly one booking_confirmed card", async () => {
    const s = await mandateScenario(batch, payers);
    // The approval that satisfies the last share finalizes the mandate.
    const results = [];
    for (const memberId of s.person.slice(0, 3)) results.push(await approveHold({ mandateId: s.mandateId, memberId }));
    expect(results.map((r) => r.satisfied)).toEqual([false, false, true]);

    const { data: item } = await admin.from("itinerary_items").select("status, pinned").eq("id", s.itemId).single();
    expect(item).toEqual({ status: "booked", pinned: true });
    const [booking] = await bookings(s.mandateId);
    expect(booking).toMatchObject({
      status: "confirmed",
      provider: "mock_merchant",
      total_cents: 16800,
      payer: "split",
      idempotency_key: `booking:${s.mandateId}`,
    });
    const cards = await confirmedCards(s.tripId);
    expect(cards).toHaveLength(1);
    expect(BookingConfirmedCard.parse(cards[0]!.card_payload)).toMatchObject({
      booking_id: booking!.id,
      item_id: s.itemId,
      title: "Georgia Aquarium · 4 tickets",
      party_size: 4,
      total_cents: 16800,
      confirmation_code: booking!.confirmation_code,
    });
    expect(await finalizeMandate(s.mandateId)).toEqual({ status: "captured" });
    expect(await confirmedCards(s.tripId)).toHaveLength(1);
  });

  it("complete_mandate rejects a non-member actor with not_permitted", async () => {
    const s = await authorizedMandate();
    const other = await createTrip(batch, { members: [{ displayName: "Person 9", profileId: payers[1].userId }] });
    const payload = { trip_id: s.tripId, actor_member_id: other.memberIds[0], mandate_id: s.mandateId, captures: [], releases: [] };
    const { error } = await admin.rpc("complete_mandate", { payload });
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/not_permitted/);
    // Nor can a signed-in client call it at all.
    const asMember = await payers[1].client.rpc("complete_mandate", { payload: { ...payload, actor_member_id: s.person[1] } });
    expect(asMember.error?.code).toBe("42501");
    expect((await mandateRow(s.mandateId)).status).toBe("authorized");
    expect(await bookings(s.mandateId)).toEqual([]);
  });
});

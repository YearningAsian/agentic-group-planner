import { DuffelError } from "@duffel/api";
import { describe, expect, it, vi } from "vitest";
import { createDuffelStaysProvider, type DuffelStaysClient } from "./stays-real";

const T0 = Date.parse("2026-09-26T13:00:00.000Z");
const guest = { givenName: "Person", familyName: "One", email: "person1@example.test", phoneNumber: "+15555550100" };
const quoteInput = { kind: "stays" as const, placeId: "p1", optionId: "rat_1", partySize: 2, startsAt: "2026-10-03T15:00:00.000Z" };
const bookInput = {
  kind: "stays" as const,
  quoteId: "quo_1",
  partySize: 2,
  startsAt: quoteInput.startsAt,
  contactName: "Person One",
  guest,
  idempotencyKey: "book:mandate-1",
};

function duffelError(status: number, code: string): InstanceType<typeof DuffelError> {
  return new DuffelError({
    meta: { status, request_id: "req_1" },
    errors: [{ code, message: code, title: code, type: "invalid_request_error", documentation_url: "" }],
    headers: new Headers() as never,
    status,
  });
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "bok_1",
    status: "confirmed",
    reference: "HX1234",
    metadata: { agp_idempotency_key: "book:mandate-1" },
    ...overrides,
  };
}

function fakeClient(overrides: Partial<{ [K in keyof DuffelStaysClient]: Partial<DuffelStaysClient[K]> }> = {}) {
  const client = {
    quotes: {
      create: vi.fn(async () => ({
        data: { id: "quo_1", total_amount: "412.30", total_currency: "USD", guests: [{ type: "adult" }, { type: "adult" }] },
      })),
      ...overrides.quotes,
    },
    bookings: {
      create: vi.fn(async () => ({ data: booking() })),
      list: vi.fn(async () => ({ data: [] as unknown[] })),
      get: vi.fn(async () => ({ data: booking() })),
      cancel: vi.fn(async () => ({ data: booking({ status: "cancelled" }) })),
      ...overrides.bookings,
    },
  };
  return client;
}

function provider(client: ReturnType<typeof fakeClient>) {
  return createDuffelStaysProvider({ client: client as unknown as DuffelStaysClient, now: () => T0 });
}

describe("Duffel Stays provider", () => {
  it("quotes a rate: the decimal total becomes integer cents, and our own 10-minute bound sets the expiry", async () => {
    const client = fakeClient();
    await expect(provider(client).quote(quoteInput)).resolves.toEqual({
      quoteId: "quo_1",
      totalCents: 41230,
      currency: "usd",
      expiresAt: "2026-09-26T13:10:00.000Z",
    });
    expect(client.quotes.create).toHaveBeenCalledWith("rat_1");
  });

  it("refuses a quote in another currency, or for a different party size", async () => {
    const gbp = fakeClient({
      quotes: { create: vi.fn(async () => ({ data: { id: "q", total_amount: "1.00", total_currency: "GBP", guests: [{}, {}] } })) },
    } as never);
    await expect(provider(gbp).quote(quoteInput)).rejects.toMatchObject({ code: "invalid_input", retryable: false });
    await expect(provider(fakeClient()).quote({ ...quoteInput, partySize: 3 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("an unavailable rate is a conflict the agent can explain, not a retry", async () => {
    const client = fakeClient({ quotes: { create: vi.fn(async () => Promise.reject(duffelError(422, "rate_unavailable"))) } } as never);
    await expect(provider(client).quote(quoteInput)).rejects.toMatchObject({ code: "conflict", retryable: false });
    expect(client.quotes.create).toHaveBeenCalledTimes(1);
  });

  it("books the quote with the lead guest and tags it with our idempotency key", async () => {
    const client = fakeClient();
    await expect(provider(client).book(bookInput)).resolves.toEqual({
      status: "confirmed",
      providerRef: "bok_1",
      confirmationCode: "HX1234",
    });
    expect(client.bookings.create).toHaveBeenCalledWith({
      quote_id: "quo_1",
      guests: [{ given_name: "Person", family_name: "One" }],
      email: guest.email,
      phone_number: guest.phoneNumber,
      metadata: { agp_idempotency_key: "book:mandate-1" },
    });
  });

  it("a retried book() returns the booking already made under the same key, without booking again", async () => {
    const client = fakeClient({ bookings: { list: vi.fn(async () => ({ data: [booking({ metadata: null }), booking()] })) } } as never);
    await expect(provider(client).book(bookInput)).resolves.toMatchObject({ status: "confirmed", providerRef: "bok_1" });
    expect(client.bookings.create).not.toHaveBeenCalled();
  });

  it("after an ambiguous failure it looks again: a booking that landed is confirmed, otherwise the error is retryable", async () => {
    const landed = fakeClient({
      bookings: {
        create: vi.fn(async () => Promise.reject(duffelError(502, "bad_gateway"))),
        list: vi.fn().mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [booking()] }),
      },
    } as never);
    await expect(provider(landed).book(bookInput)).resolves.toMatchObject({ status: "confirmed", providerRef: "bok_1" });
    expect(landed.bookings.create).toHaveBeenCalledTimes(1);

    const lost = fakeClient({ bookings: { create: vi.fn(async () => Promise.reject(duffelError(503, "unavailable"))) } } as never);
    await expect(provider(lost).book(bookInput)).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(lost.bookings.create).toHaveBeenCalledTimes(1);
  });

  it("a rejected booking is a failed result with Duffel's reason", async () => {
    const client = fakeClient({ bookings: { create: vi.fn(async () => Promise.reject(duffelError(422, "quote_expired"))) } } as never);
    await expect(provider(client).book(bookInput)).resolves.toEqual({
      status: "failed",
      providerRef: null,
      failureReason: "quote_expired",
    });
  });

  it("needs a quote and a lead guest to book", async () => {
    const client = fakeClient();
    await expect(provider(client).book({ ...bookInput, guest: undefined })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider(client).book({ ...bookInput, quoteId: undefined })).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.bookings.create).not.toHaveBeenCalled();
  });

  it("cancels, and treats a booking that is already cancelled as done", async () => {
    const client = fakeClient();
    await expect(provider(client).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).resolves.toEqual({ status: "cancelled" });
    expect(client.bookings.cancel).toHaveBeenCalledWith("bok_1");

    const again = fakeClient({
      bookings: {
        cancel: vi.fn(async () => Promise.reject(duffelError(422, "already_cancelled"))),
        get: vi.fn(async () => ({ data: booking({ status: "cancelled" }) })),
      },
    } as never);
    await expect(provider(again).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).resolves.toEqual({ status: "cancelled" });

    const refused = fakeClient({ bookings: { cancel: vi.fn(async () => Promise.reject(duffelError(422, "not_cancellable"))) } } as never);
    await expect(provider(refused).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("sells stays only", async () => {
    await expect(provider(fakeClient()).quote({ ...quoteInput, kind: "tickets" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

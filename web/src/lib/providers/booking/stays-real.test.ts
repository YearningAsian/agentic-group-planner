import { DuffelError } from "@duffel/api";
import { describe, expect, it, vi } from "vitest";
import { createDuffelStaysProvider, type DuffelStaysClient } from "./stays-real";

const T0 = Date.parse("2026-09-26T13:00:00.000Z");
const KEY = "book:mandate-1";
const guest = { givenName: "Person", familyName: "One", email: "person1@example.test", phoneNumber: "+15555550100" };
const quoteInput = { kind: "stays" as const, placeId: "p1", optionId: "rat_1", partySize: 2, startsAt: "2026-10-03T15:00:00.000Z" };
const bookInput = {
  kind: "stays" as const,
  quoteId: "quo_1",
  partySize: 2,
  startsAt: quoteInput.startsAt,
  contactName: "Person One",
  guest,
  idempotencyKey: KEY,
};

function duffelError(status: number, code?: string): InstanceType<typeof DuffelError> {
  return new DuffelError({
    meta: { status, request_id: "req_1" },
    // The SDK leaves `errors` undefined when the body isn't JSON.
    errors: (code ? [{ code, message: code, title: code, type: "invalid_request_error", documentation_url: "" }] : undefined) as never,
    headers: new Headers() as never,
    status,
  });
}

function booking(id: string, key: string | null, overrides: Record<string, unknown> = {}) {
  return { id, status: "confirmed", reference: `REF-${id}`, metadata: key ? { agp_idempotency_key: key } : null, ...overrides };
}

/** Each call lists the next page set; a list is an async generator of one booking per item. */
function pages(...lists: ReturnType<typeof booking>[][]) {
  let call = 0;
  return vi.fn(() => {
    const list = lists[Math.min(call++, lists.length - 1)] ?? [];
    return (async function* () {
      for (const b of list) yield { data: b };
    })();
  });
}

function fakeClient(overrides: { quote?: unknown; create?: unknown; list?: unknown; get?: unknown; cancel?: unknown } = {}) {
  return {
    quotes: {
      create:
        overrides.quote ??
        vi.fn(async () => ({
          data: {
            id: "quo_1",
            total_amount: "412.30",
            total_currency: "USD",
            due_at_accommodation_amount: null,
            guests: [{ type: "adult" }, { type: "adult" }],
          },
        })),
    },
    bookings: {
      create: overrides.create ?? vi.fn(async () => ({ data: booking("bok_new", KEY) })),
      listWithGenerator: overrides.list ?? pages([]),
      get: overrides.get ?? vi.fn(async () => ({ data: booking("bok_1", KEY) })),
      cancel: overrides.cancel ?? vi.fn(async () => ({ data: booking("bok_1", KEY, { status: "cancelled" }) })),
    },
  } as const;
}

function provider(client: ReturnType<typeof fakeClient>) {
  return createDuffelStaysProvider({ client: client as unknown as DuffelStaysClient, now: () => T0, lookupDelaysMs: [0, 0, 0] });
}

const rejects = (status: number, code?: string) => vi.fn(async () => Promise.reject(duffelError(status, code)));

describe("Duffel Stays provider: quote", () => {
  it("the decimal total becomes integer cents, and our own 10-minute bound sets the expiry", async () => {
    const client = fakeClient();
    await expect(provider(client).quote(quoteInput)).resolves.toEqual({
      quoteId: "quo_1",
      totalCents: 41230,
      currency: "usd",
      expiresAt: "2026-09-26T13:10:00.000Z",
    });
    expect(client.quotes.create).toHaveBeenCalledWith("rat_1");
  });

  it("refuses another currency, a different party size, or fees owed at the hotel", async () => {
    const quoted = (data: Record<string, unknown>) =>
      fakeClient({
        quote: vi.fn(async () => ({
          data: { id: "q", total_amount: "1.00", total_currency: "USD", due_at_accommodation_amount: null, guests: [{}, {}], ...data },
        })),
      });
    await expect(provider(quoted({ total_currency: "GBP" })).quote(quoteInput)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider(fakeClient()).quote({ ...quoteInput, partySize: 3 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider(quoted({ due_at_accommodation_amount: "60.00" })).quote(quoteInput)).rejects.toMatchObject({ code: "conflict" });
    await expect(provider(quoted({ due_at_accommodation_amount: "0.00" })).quote(quoteInput)).resolves.toMatchObject({ totalCents: 100 });
  });

  it("an unavailable rate is a conflict, even when the error body isn't JSON", async () => {
    for (const client of [fakeClient({ quote: rejects(422, "rate_unavailable") }), fakeClient({ quote: rejects(404) })]) {
      await expect(provider(client).quote(quoteInput)).rejects.toMatchObject({
        code: "conflict",
        message: "That room rate is no longer available.",
        retryable: false,
      });
    }
  });

  it("refused credentials are a server problem, not an unavailable rate", async () => {
    await expect(provider(fakeClient({ quote: rejects(401, "unauthorized") })).quote(quoteInput)).rejects.toMatchObject({
      code: "internal",
      retryable: false,
    });
  });

  it("a 429 or 500 is retried once, then reported as retryable", async () => {
    for (const status of [429, 500]) {
      const client = fakeClient({ quote: rejects(status, "busy") });
      await expect(provider(client).quote(quoteInput)).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
      expect(client.quotes.create).toHaveBeenCalledTimes(2);
    }
  });

  it("sells stays only", async () => {
    await expect(provider(fakeClient()).quote({ ...quoteInput, kind: "tickets" })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("Duffel Stays provider: book", () => {
  it("books the quote with the lead guest and tags it with our idempotency key", async () => {
    const client = fakeClient();
    await expect(provider(client).book(bookInput)).resolves.toEqual({
      status: "confirmed",
      providerRef: "bok_new",
      confirmationCode: "REF-bok_new",
    });
    expect(client.bookings.create).toHaveBeenCalledWith({
      quote_id: "quo_1",
      guests: [{ given_name: "Person", family_name: "One" }],
      email: guest.email,
      phone_number: guest.phoneNumber,
      metadata: { agp_idempotency_key: KEY },
    });
  });

  it("a retry finds the earlier booking by key on any page, ignoring others, and doesn't book again", async () => {
    const others = Array.from({ length: 250 }, (_, i) => booking(`bok_other_${i}`, i % 2 ? "book:other" : null));
    const client = fakeClient({ list: pages([...others, booking("bok_mine", KEY)]) });
    await expect(provider(client).book(bookInput)).resolves.toMatchObject({ status: "confirmed", providerRef: "bok_mine" });
    expect(client.bookings.create).not.toHaveBeenCalled();
  });

  it("a booking found cancelled is a failed result", async () => {
    const client = fakeClient({ list: pages([booking("bok_old", KEY, { status: "cancelled" })]) });
    await expect(provider(client).book(bookInput)).resolves.toEqual({ status: "failed", providerRef: "bok_old", failureReason: "cancelled" });
  });

  it("after a 5xx or timeout it keeps looking: a booking that landed late is confirmed", async () => {
    const client = fakeClient({
      create: rejects(502, "bad_gateway"),
      list: pages([], [], [], [booking("bok_late", KEY)]),
    });
    await expect(provider(client).book(bookInput)).resolves.toMatchObject({ status: "confirmed", providerRef: "bok_late" });
    expect(client.bookings.create).toHaveBeenCalledTimes(1);
  });

  it("if the booking never appears, the error stays retryable and nothing is booked twice", async () => {
    const client = fakeClient({ create: rejects(503, "unavailable") });
    await expect(provider(client).book(bookInput)).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    expect(client.bookings.create).toHaveBeenCalledTimes(1);
    expect(client.bookings.listWithGenerator).toHaveBeenCalledTimes(4);
  });

  it("a rejected create is failed with Duffel's reason, unless an earlier attempt booked the quote", async () => {
    const rejected = fakeClient({ create: rejects(422, "quote_expired") });
    await expect(provider(rejected).book(bookInput)).resolves.toEqual({ status: "failed", providerRef: null, failureReason: "quote_expired" });

    const spent = fakeClient({ create: rejects(422, "quote_already_booked"), list: pages([], [booking("bok_first", KEY)]) });
    await expect(provider(spent).book(bookInput)).resolves.toMatchObject({ status: "confirmed", providerRef: "bok_first" });

    const noBody = fakeClient({ create: rejects(413) });
    await expect(provider(noBody).book(bookInput)).resolves.toMatchObject({ status: "failed", failureReason: "rejected" });
  });

  it("refused credentials throw instead of failing the booking, so the mandate isn't cancelled", async () => {
    const client = fakeClient({ create: rejects(401, "unauthorized") });
    await expect(provider(client).book(bookInput)).rejects.toMatchObject({ code: "internal", retryable: false });
    expect(client.bookings.listWithGenerator).toHaveBeenCalledTimes(1);
  });

  it("needs a quote and a lead guest to book", async () => {
    const client = fakeClient();
    await expect(provider(client).book({ ...bookInput, guest: undefined })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider(client).book({ ...bookInput, quoteId: undefined })).rejects.toMatchObject({ code: "invalid_input" });
    expect(client.bookings.create).not.toHaveBeenCalled();
  });
});

describe("Duffel Stays provider: cancel", () => {
  it("cancels, and treats a booking that is already cancelled as done", async () => {
    const client = fakeClient();
    await expect(provider(client).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).resolves.toEqual({ status: "cancelled" });
    expect(client.bookings.cancel).toHaveBeenCalledWith("bok_1");

    const again = fakeClient({
      cancel: rejects(422, "already_cancelled"),
      get: vi.fn(async () => ({ data: booking("bok_1", KEY, { status: "cancelled" }) })),
    });
    await expect(provider(again).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).resolves.toEqual({ status: "cancelled" });

    const refused = fakeClient({ cancel: rejects(422, "not_cancellable") });
    await expect(provider(refused).cancel({ providerRef: "bok_1", idempotencyKey: "c1" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("without a token there is no client to build", () => {
    expect(() => createDuffelStaysProvider({})).toThrow(expect.objectContaining({ code: "internal" }));
  });
});

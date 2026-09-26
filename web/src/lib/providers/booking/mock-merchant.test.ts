import { describe, expect, it, vi } from "vitest";
import { NotBuiltError } from "@/lib/not-built";
import { getBookingProvider, selectStaysProvider } from "./index";
import { createMockMerchant } from "./mock-merchant";

const placeId = "00000000-0000-4000-8000-0000000000c1";
const aquarium = "00000000-0000-4000-8000-0000000000b1";
const museum = "00000000-0000-4000-8000-0000000000b2";
const startsAt = "2026-09-26T14:00:00.000Z";
const T0 = Date.parse("2026-09-26T13:00:00.000Z");

function merchant() {
  let now = T0;
  const priceOf = vi.fn(async ({ optionId }: { optionId: string }) => (optionId === aquarium ? 4200 : 2500));
  const m = createMockMerchant({ priceOf, now: () => now });
  const quote = (optionId = aquarium, partySize = 4) => m.quote({ kind: "tickets", placeId, optionId, partySize, startsAt });
  const book = (quoteId: string, idempotencyKey: string) =>
    m.book({ kind: "tickets", quoteId, partySize: 4, startsAt, contactName: "Person 1", idempotencyKey });
  return { m, priceOf, quote, book, advance: (ms: number) => (now += ms) };
}

describe("mock merchant", () => {
  it("a quote is price_cents × party size and expires in 15 minutes", async () => {
    const { quote, priceOf } = merchant();
    const q = await quote();
    expect(q).toMatchObject({ totalCents: 16800, currency: "usd", expiresAt: "2026-09-26T13:15:00.000Z" });
    expect(q.quoteId).toMatch(/^q_mock_/);
    expect(priceOf).toHaveBeenCalledWith({ optionId: aquarium, placeId });
    expect((await quote(aquarium, 3)).totalCents).toBe(12600);
    await expect(quote(aquarium, 0)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("book with the same idempotency key returns the same providerRef", async () => {
    const { quote, book } = merchant();
    const q = await quote();
    const first = await book(q.quoteId, "booking:mandate-1");
    expect(first.status).toBe("confirmed");
    expect(first.providerRef).toMatch(/^mock_bk_/);
    expect(first.confirmationCode).toMatch(/^[A-Z0-9]{6}$/);
    expect(await book(q.quoteId, "booking:mandate-1")).toEqual(first);
    // Another process with the same key agrees, because the reference derives from the key.
    const elsewhere = merchant();
    expect((await elsewhere.book((await elsewhere.quote()).quoteId, "booking:mandate-1")).providerRef).toBe(first.providerRef);
    expect((await book(q.quoteId, "booking:mandate-2")).providerRef).not.toBe(first.providerRef);
  });

  it("book fails on an expired or unknown quote", async () => {
    const { quote, book, advance } = merchant();
    const q = await quote();
    advance(15 * 60_000 + 1);
    expect(await book(q.quoteId, "booking:late")).toEqual({ status: "failed", providerRef: null, failureReason: "quote_expired" });
    expect(await book("q_mock_nope", "booking:unknown")).toEqual({ status: "failed", providerRef: null, failureReason: "unknown_quote" });
  });

  it("simulatePriceChange changes only the next quote", async () => {
    const { m, quote } = merchant();
    const q1 = await quote();
    expect(await m.simulatePriceChange({ quoteId: q1.quoteId, newTotalCents: 17600 })).toEqual({ quoteId: q1.quoteId });
    // Other options keep their price.
    expect((await quote(museum)).totalCents).toBe(10000);
    expect((await quote()).totalCents).toBe(17600);
    expect((await quote()).totalCents).toBe(16800);
    await expect(m.simulatePriceChange({ quoteId: "q_mock_nope", newTotalCents: 1 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("getBookingProvider returns the mock merchant for tickets, and has no restaurant provider", () => {
    expect(getBookingProvider("tickets")).toBe(getBookingProvider("tickets"));
    expect(() => getBookingProvider("restaurant")).toThrow(NotBuiltError);
  });

  it("selectStaysProvider picks the hotel mock or Duffel from STAYS_PROVIDER", async () => {
    const mock = selectStaysProvider({ STAYS_PROVIDER: "mock" });
    await expect(mock.quote({ kind: "tickets", placeId, optionId: aquarium, partySize: 1, startsAt })).rejects.toMatchObject({
      message: "The mock merchant sells stays only.",
    });
    expect(() => selectStaysProvider({ STAYS_PROVIDER: "real" })).toThrow(/DUFFEL_ACCESS_TOKEN/);
    expect(selectStaysProvider({ STAYS_PROVIDER: "real", DUFFEL_ACCESS_TOKEN: "duffel_test_x" }).quote).toBeTypeOf("function");
  });
});

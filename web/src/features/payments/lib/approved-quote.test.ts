import { describe, expect, it } from "vitest";
import { quoteChangeReason } from "./approved-quote";

const approved = { approvedCents: 16_800, capCents: 19_200, currency: "usd", currentCents: 16_800, currentCurrency: "usd" };

describe("quoteChangeReason", () => {
  it("accepts only the exact approved price and currency", () => {
    expect(quoteChangeReason(approved)).toBeNull();
    expect(quoteChangeReason({ ...approved, currentCents: 17_000 })).toBe("price_changed");
    expect(quoteChangeReason({ ...approved, currentCents: 16_000 })).toBe("price_changed");
    expect(quoteChangeReason({ ...approved, currentCurrency: "eur" })).toBe("price_changed");
  });

  it("does not treat the fee-inclusive mandate cap as approval of a different base price", () => {
    expect(quoteChangeReason({ ...approved, currentCents: 17_000 })).toBe("price_changed");
    expect(quoteChangeReason({ ...approved, currentCents: 19_201 })).toBe("price_above_cap");
  });

  it("rejects a malformed merchant price", () => {
    expect(() => quoteChangeReason({ ...approved, currentCents: Number.NaN })).toThrow(/invalid price/i);
    expect(() => quoteChangeReason({ ...approved, currentCents: -1 })).toThrow(/invalid price/i);
  });
});

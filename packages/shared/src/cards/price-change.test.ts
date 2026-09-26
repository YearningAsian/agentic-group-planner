import { describe, expect, it } from "vitest";
import { PriceChangeCard } from "./price-change";

const card = {
  card_type: "price_change",
  price_change_id: "00000000-0000-4000-8000-0000000000f2",
  mandate_id: "00000000-0000-4000-8000-0000000000e1",
  old_cents: 16800,
  new_cents: 17600,
  action: "auto_captured",
  new_mandate_id: null,
};

describe("price_change card", () => {
  it("names a new mandate exactly when it asks the group to approve again", () => {
    expect(PriceChangeCard.parse(card)).toEqual(card);
    const reapproval = { ...card, new_cents: 22000, action: "reapproval_requested" };
    expect(PriceChangeCard.safeParse(reapproval).success).toBe(false);
    expect(PriceChangeCard.safeParse({ ...reapproval, new_mandate_id: "00000000-0000-4000-8000-0000000000e2" }).success).toBe(true);
    expect(PriceChangeCard.safeParse({ ...card, new_mandate_id: "00000000-0000-4000-8000-0000000000e2" }).success).toBe(false);
  });
});

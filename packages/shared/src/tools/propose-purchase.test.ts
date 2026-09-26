import { describe, expect, it } from "vitest";
import { ProposePurchaseInput } from "./propose-purchase";

describe("propose_purchase input", () => {
  it("propose_purchase has no amount field and strips unknown keys", () => {
    // The server quotes and splits; nothing the model sends can name an amount.
    expect(Object.keys(ProposePurchaseInput.shape).sort()).toEqual(["cap_percent", "item_handle", "note", "option_handle"]);

    const parsed = ProposePurchaseInput.parse({ item_handle: "I2", amount_cents: 1, total_cents: 1, share_cents: 1 });
    expect(parsed).toEqual({ item_handle: "I2" });

    expect(ProposePurchaseInput.safeParse({ item_handle: "O2" }).success).toBe(false);
    expect(ProposePurchaseInput.safeParse({ item_handle: "I2", option_handle: "I3" }).success).toBe(false);
    expect(ProposePurchaseInput.safeParse({ item_handle: "I2", note: "x".repeat(201) }).success).toBe(false);
  });

  it("cap_percent must be 100–125", () => {
    const withCap = (cap_percent: unknown) => ProposePurchaseInput.safeParse({ item_handle: "I1", cap_percent }).success;
    expect(withCap(99)).toBe(false);
    expect(withCap(126)).toBe(false);
    expect(withCap(110.5)).toBe(false);
    expect(withCap(100)).toBe(true);
    expect(withCap(125)).toBe(true);
    // Left out, the server uses the trip's price threshold.
    expect(ProposePurchaseInput.parse({ item_handle: "I1" }).cap_percent).toBeUndefined();
  });
});

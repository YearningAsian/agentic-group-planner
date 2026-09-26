import { describe, expect, it } from "vitest";
import { FEE_SCHEDULE, frontedShareRefundCents, holdFees, shareCapCents } from "./fees";

/** The worst case for us: the processor rounds its percentage up. */
const processorFeeOn = (totalCents: number) =>
  Math.ceil((totalCents * FEE_SCHEDULE.processorPercentBps) / 10_000) + FEE_SCHEDULE.processorFixedCents;

describe("holdFees", () => {
  it("a $42 share: processor fee $1.57, platform fee $0, total $43.57, cap $48 at 110%", () => {
    expect(holdFees({ sharesCents: [4200], capPercent: 110 })).toEqual({
      shareCents: 4200,
      processorFeeCents: 157,
      platformFeeCents: 0,
      totalCents: 4357,
      capCents: 4800,
    });
  });

  it("itemizes the platform fee even when it's $0", () => {
    const fees = holdFees({ sharesCents: [1000], capPercent: 100 });
    expect(fees).toHaveProperty("platformFeeCents", 0);
  });

  it("a hold paying two shares (the organizer fronting Person 4) pays one fixed fee; its cap is the sum of the share caps", () => {
    const fees = holdFees({ sharesCents: [4200, 4200], capPercent: 110 });
    expect(fees.totalCents).toBe(8682);
    expect(fees.processorFeeCents).toBe(282);
    expect(fees.capCents).toBe(shareCapCents(4200, 110) * 2);
    expect(fees.capCents).toBe(9600);
  });

  it("after the processor's fee, the platform always nets at least the shares", () => {
    for (let share = 1; share <= 50_000; share += 7) {
      const { totalCents, platformFeeCents } = holdFees({ sharesCents: [share], capPercent: 100 });
      expect(totalCents - processorFeeOn(totalCents) - platformFeeCents).toBeGreaterThanOrEqual(share);
      // …and the total is the smallest one that does.
      expect(totalCents - 1 - processorFeeOn(totalCents - 1) - platformFeeCents).toBeLessThan(share);
    }
  });

  it("the cap covers the capped price plus its fees, and is never below the total", () => {
    for (const capPercent of [100, 110, 125]) {
      for (let share = 50; share <= 30_000; share += 173) {
        const cap = shareCapCents(share, capPercent);
        const cappedPrice = Math.ceil((share * capPercent) / 100);
        expect(cap % 100).toBe(0);
        expect(cap - processorFeeOn(cap)).toBeGreaterThanOrEqual(cappedPrice);
        expect(cap).toBeGreaterThanOrEqual(holdFees({ sharesCents: [share], capPercent }).totalCents);
      }
    }
  });

  it("rejects fractional or negative cents, no shares, and a cap percent outside 100–125", () => {
    expect(() => holdFees({ sharesCents: [42.5], capPercent: 110 })).toThrow(/integer cents/);
    expect(() => holdFees({ sharesCents: [-1], capPercent: 110 })).toThrow(/integer cents/);
    expect(() => holdFees({ sharesCents: [], capPercent: 110 })).toThrow(/at least one share/);
    expect(() => holdFees({ sharesCents: [4200], capPercent: 99 })).toThrow(/100–125/);
    expect(() => holdFees({ sharesCents: [4200], capPercent: 126 })).toThrow(/100–125/);
  });
});

describe("frontedShareRefundCents", () => {
  it("refunds the fronted share plus the fee it added, so the organizer ends up paying what any member pays", () => {
    const refund = frontedShareRefundCents({ ownSharesCents: [4200], frontedShareCents: 4200 });
    expect(refund).toBe(8682 - 4357);
    expect(holdFees({ sharesCents: [4200, 4200], capPercent: 110 }).totalCents - refund).toBe(
      holdFees({ sharesCents: [4200], capPercent: 110 }).totalCents,
    );
  });
});

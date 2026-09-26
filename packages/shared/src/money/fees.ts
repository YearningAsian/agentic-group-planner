/**
 * The one place fee math lives. Every approval card itemizes these numbers, the server charges
 * them, and the fronting refund comes from them, so members always see what they're charged.
 */

/** Stripe's standard US card pricing (2.9% + 30¢), and no platform fee yet. Basis points: 290 = 2.9%. */
export const FEE_SCHEDULE = {
  processorPercentBps: 290,
  processorFixedCents: 30,
  platformPercentBps: 0,
  platformFixedCents: 0,
} as const;

export type FeeSchedule = { [K in keyof typeof FEE_SCHEDULE]: number };

export interface HoldFees {
  /** The shares this hold pays, summed. */
  shareCents: number;
  processorFeeCents: number;
  /** Always present, even at $0, so every card itemizes it. */
  platformFeeCents: number;
  /** What the payer's card is charged at the quote. */
  totalCents: number;
  /** The hold's authorized maximum: the sum of its shares' caps. */
  capCents: number;
}

const ceilDiv = (numerator: number, denominator: number) => Math.ceil(numerator / denominator);

function assertCents(values: number[]): void {
  if (values.some((v) => !Number.isSafeInteger(v) || v < 0)) throw new RangeError("amounts must be integer cents ≥ 0");
}

function assertCapPercent(capPercent: number): void {
  if (!Number.isInteger(capPercent) || capPercent < 100 || capPercent > 125) {
    throw new RangeError("capPercent must be an integer in 100–125");
  }
}

function platformFeeOn(baseCents: number, s: FeeSchedule): number {
  return baseCents === 0 ? 0 : ceilDiv(baseCents * s.platformPercentBps, 10_000) + s.platformFixedCents;
}

/**
 * The smallest total that still leaves `baseCents` plus the platform fee after the processor's
 * fee, assuming the processor rounds its percentage up (the worst case for us).
 */
function grossUp(baseCents: number, s: FeeSchedule): number {
  if (baseCents === 0) return 0;
  const needed = baseCents + platformFeeOn(baseCents, s);
  let total = ceilDiv((needed + s.processorFixedCents) * 10_000, 10_000 - s.processorPercentBps);
  const keeps = (t: number) => t - ceilDiv(t * s.processorPercentBps, 10_000) - s.processorFixedCents;
  while (keeps(total) < needed) total += 1;
  while (total > 0 && keeps(total - 1) >= needed) total -= 1;
  return total;
}

/**
 * One share's cap: its price at `capPercent`, plus the fees on that price, rounded up to a whole
 * dollar. A hold's cap is the sum of its shares' caps.
 */
export function shareCapCents(shareCents: number, capPercent: number, schedule: FeeSchedule = FEE_SCHEDULE): number {
  assertCents([shareCents]);
  assertCapPercent(capPercent);
  return ceilDiv(grossUp(ceilDiv(shareCents * capPercent, 100), schedule), 100) * 100;
}

/** The itemized fees for one hold (one PaymentIntent) paying `sharesCents` at the quote. */
export function holdFees(input: { sharesCents: number[]; capPercent: number; schedule?: FeeSchedule }): HoldFees {
  const schedule = input.schedule ?? FEE_SCHEDULE;
  if (input.sharesCents.length === 0) throw new RangeError("a hold pays at least one share");
  assertCents(input.sharesCents);
  assertCapPercent(input.capPercent);

  const shareCents = input.sharesCents.reduce((sum, v) => sum + v, 0);
  const platformFeeCents = platformFeeOn(shareCents, schedule);
  const totalCents = grossUp(shareCents, schedule);
  return {
    shareCents,
    processorFeeCents: totalCents - shareCents - platformFeeCents,
    platformFeeCents,
    totalCents,
    capCents: input.sharesCents.reduce((sum, v) => sum + shareCapCents(v, input.capPercent, schedule), 0),
  };
}

/**
 * What the organizer gets back when a placeholder pays the share they fronted: the share plus
 * the fee it added to the organizer's hold. The processor keeps its fee on refunded amounts, so
 * the platform absorbs that difference.
 */
export function frontedShareRefundCents(input: {
  ownSharesCents: number[];
  frontedShareCents: number;
  schedule?: FeeSchedule;
}): number {
  const schedule = input.schedule ?? FEE_SCHEDULE;
  assertCents([...input.ownSharesCents, input.frontedShareCents]);
  const own = input.ownSharesCents.reduce((sum, v) => sum + v, 0);
  return grossUp(own + input.frontedShareCents, schedule) - grossUp(own, schedule);
}

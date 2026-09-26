/**
 * Stripe's side of the sandbox smoke's purchase (plan CO-303, CO-304). Pure checks over what the
 * smoke read from Stripe and from the share rows, so they're unit-tested and say exactly what's off.
 */

/** A PaymentIntent as the smoke reads it from Stripe. */
export interface IntentView {
  id: string;
  status: string;
  /** Authorized (held) amount. */
  amount: number;
  amountReceived: number;
  metadata: Record<string, string>;
}

/** A payer's main-hold share row, as `shareRows` returns it. */
export interface PayerRow {
  cap_cents: number;
  captured_cents: number | null;
  pays_share: boolean | null;
  stripe_payment_intent_id: string | null;
}

/**
 * Each payer has exactly one PaymentIntent for the mandate, captured; its metadata names the
 * mandate, the payer, and the trip; it held the sum of the payer's caps; and it received exactly
 * what the rows it pays recorded as captured.
 */
export function payerIntentProblems(input: {
  tripId: string;
  mandateId: string;
  payers: { memberId: string; intents: IntentView[]; rows: PayerRow[] }[];
}): string[] {
  const problems: string[] = [];
  for (const { memberId, intents, rows } of input.payers) {
    if (intents.length !== 1) {
      problems.push(`${memberId} has ${intents.length} PaymentIntents for the mandate, not 1`);
      continue;
    }
    const pi = intents[0]!;
    const expected = { mandate_id: input.mandateId, payer_member_id: memberId, trip_id: input.tripId };
    for (const [key, value] of Object.entries(expected)) {
      if (pi.metadata[key] !== value) problems.push(`${memberId}'s PaymentIntent ${pi.id} has metadata ${key}=${pi.metadata[key]}`);
    }
    const caps = rows.reduce((sum, row) => sum + row.cap_cents, 0);
    if (pi.amount !== caps) problems.push(`${memberId}'s PaymentIntent ${pi.id} holds ${pi.amount}¢, not its caps ${caps}¢`);
    const captured = rows
      .filter((row) => row.pays_share && row.stripe_payment_intent_id === pi.id)
      .reduce((sum, row) => sum + (row.captured_cents ?? 0), 0);
    if (pi.amountReceived !== captured) problems.push(`${memberId}'s PaymentIntent ${pi.id} received ${pi.amountReceived}¢, not its rows' ${captured}¢`);
    if (pi.status !== "succeeded") problems.push(`${memberId}'s PaymentIntent ${pi.id} is ${pi.status}, not succeeded`);
  }
  return problems;
}

/**
 * After Person 4 claims and pays (design §4.2): their own PaymentIntent captured their share, and
 * the organizer's PaymentIntent has exactly one partial refund, for the fronted row's amount.
 */
export function frontingRefundProblems(input: {
  person4Intent: IntentView;
  own: { captured_cents: number | null };
  fronted: { refunded_cents: number | null };
  organizerRefunds: number[];
}): string[] {
  const problems: string[] = [];
  if (input.person4Intent.amountReceived !== input.own.captured_cents) {
    problems.push(`Person 4's PaymentIntent received ${input.person4Intent.amountReceived}¢, not their row's ${input.own.captured_cents}¢`);
  }
  if (input.organizerRefunds.length !== 1) {
    problems.push(`the organizer's PaymentIntent has ${input.organizerRefunds.length} refunds, not 1`);
  } else if (input.organizerRefunds[0] !== input.fronted.refunded_cents) {
    problems.push(`the organizer's refund is ${input.organizerRefunds[0]}¢, not the fronted row's ${input.fronted.refunded_cents}¢`);
  }
  return problems;
}

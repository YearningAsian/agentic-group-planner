import { describe, expect, it } from "vitest";
import { frontingRefundProblems, type IntentView, payerIntentProblems } from "./sandbox-smoke-stripe";

const trip = "trip-1";
const mandate = "mandate-1";

function intent(over: Partial<IntentView> = {}): IntentView {
  return {
    id: "pi_1",
    status: "succeeded",
    amount: 9600,
    amountReceived: 8682,
    metadata: { mandate_id: mandate, payer_member_id: "m1", trip_id: trip },
    ...over,
  };
}

const organizerRows = [
  { cap_cents: 4800, captured_cents: 4341, pays_share: true, stripe_payment_intent_id: "pi_1" },
  { cap_cents: 4800, captured_cents: 4341, pays_share: true, stripe_payment_intent_id: "pi_1" },
];

describe("payerIntentProblems", () => {
  it("finds nothing when each payer has one captured PaymentIntent that matches its rows and metadata", () => {
    expect(payerIntentProblems({ tripId: trip, mandateId: mandate, payers: [{ memberId: "m1", intents: [intent()], rows: organizerRows }] })).toEqual([]);
  });

  it("flags a second PaymentIntent, wrong metadata, a hold that isn't the caps, and a capture that isn't the rows", () => {
    const problems = payerIntentProblems({
      tripId: trip,
      mandateId: mandate,
      payers: [
        { memberId: "m1", intents: [intent(), intent({ id: "pi_2" })], rows: organizerRows },
        { memberId: "m2", intents: [intent({ metadata: { mandate_id: mandate, payer_member_id: "m1", trip_id: trip } })], rows: organizerRows },
        { memberId: "m1", intents: [intent({ amount: 9000 })], rows: organizerRows },
        { memberId: "m1", intents: [intent({ amountReceived: 9600 })], rows: organizerRows },
        { memberId: "m1", intents: [intent({ status: "requires_capture" })], rows: organizerRows },
      ],
    });
    expect(problems).toEqual([
      "m1 has 2 PaymentIntents for the mandate, not 1",
      "m2's PaymentIntent pi_1 has metadata payer_member_id=m1",
      "m1's PaymentIntent pi_1 holds 9000¢, not its caps 9600¢",
      "m1's PaymentIntent pi_1 received 9600¢, not its rows' 8682¢",
      "m1's PaymentIntent pi_1 is requires_capture, not succeeded",
    ]);
  });
});

describe("frontingRefundProblems", () => {
  const fronted = { refunded_cents: 4325 };
  const own = { captured_cents: 4357 };

  it("finds nothing when Person 4's hold captured their share and the organizer got exactly one matching refund", () => {
    expect(frontingRefundProblems({ person4Intent: intent({ amountReceived: 4357 }), own, fronted, organizerRefunds: [4325] })).toEqual([]);
  });

  it("flags a missing or doubled refund, a wrong amount, and a capture that doesn't match Person 4's row", () => {
    expect(frontingRefundProblems({ person4Intent: intent({ amountReceived: 4357 }), own, fronted, organizerRefunds: [] })).toEqual([
      "the organizer's PaymentIntent has 0 refunds, not 1",
    ]);
    expect(frontingRefundProblems({ person4Intent: intent({ amountReceived: 4357 }), own, fronted, organizerRefunds: [4325, 4325] })).toEqual([
      "the organizer's PaymentIntent has 2 refunds, not 1",
    ]);
    expect(frontingRefundProblems({ person4Intent: intent({ amountReceived: 4000 }), own, fronted, organizerRefunds: [4200] })).toEqual([
      "Person 4's PaymentIntent received 4000¢, not their row's 4357¢",
      "the organizer's refund is 4200¢, not the fronted row's 4325¢",
    ]);
  });
});

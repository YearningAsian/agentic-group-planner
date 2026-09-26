import { frontedShareRefundCents } from "@agp/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveHold, onPlaceholderClaimed, settleFrontedShare } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { addMandate, claimPlaceholder, mandateRow, mandateScenario, paymentsKit, shareRows, type MandateScenario } from "../payments/kit";
import { cleanup, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
let payers: [TestUser, TestUser, TestUser];

/** The real provider, with every call that moves money counted. */
function counted() {
  const real = getPaymentsProvider();
  const spies = {
    authorize: vi.fn(real.authorize.bind(real)),
    capture: vi.fn(real.capture.bind(real)),
    refund: vi.fn(real.refund.bind(real)),
  };
  const payments: PaymentsProvider = { ...real, name: real.name, parseWebhook: real.parseWebhook.bind(real), ...spies };
  return { payments, ...spies };
}

const captureOf = (spy: ReturnType<typeof counted>["capture"], intent: string) =>
  spy.mock.calls.filter(([input]) => input.paymentIntentId === intent).map(([input]) => input.amountCents);

async function approveAll(s: MandateScenario, members: string[], payments: PaymentsProvider) {
  for (const memberId of members) await approveHold({ mandateId: s.mandateId, memberId }, { payments });
}

async function refundsOn(intent: string) {
  return (await kit.eventsFor(intent)).filter((e) => e.type === "charge.refunded");
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("fronting a placeholder's share", () => {
  it("claim before capture: Person 4's PaymentIntent captures 4357, Person 1's captures 4357 of 9600, the fronted row is released, and nothing is refunded", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3, person4] = s.person;
    await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));
    const { payments, authorize, capture, refund } = counted();

    await approveAll(s, [person4, person1, person2, person3], payments);

    const rows = await shareRows(s.mandateId);
    const pi1 = rows.get(`${person1}:own`)!.stripe_payment_intent_id!;
    const pi4 = rows.get(`${person4}:own`)!.stripe_payment_intent_id!;
    expect(authorize.mock.calls.find(([input]) => input.idempotencyKey.endsWith(person1))![0].amountCents).toBe(9600);
    expect(captureOf(capture, pi1)).toEqual([4357]);
    expect(captureOf(capture, pi4)).toEqual([4357]);
    expect(rows.get(`${person4}:own`)).toMatchObject({ status: "captured", pays_share: true });
    expect(rows.get(`${person4}:fronted`)).toMatchObject({ status: "released", pays_share: false });
    expect(refund).not.toHaveBeenCalled();
    expect(await refundsOn(pi1)).toEqual([]);
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
  });

  it("claim after capture: Person 1's PaymentIntent captured 8682; Person 4's approval captures 4357, then refunds Person 1 4325 (frontedShareRefundCents) once, with key cover-refund:{mandate_id}:{member_id}", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3, person4] = s.person;
    const { payments, capture, refund } = counted();
    await approveAll(s, [person1, person2, person3], payments);
    const pi1 = (await shareRows(s.mandateId)).get(`${person1}:own`)!.stripe_payment_intent_id!;
    expect(captureOf(capture, pi1)).toEqual([8682]);

    await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));
    await approveHold({ mandateId: s.mandateId, memberId: person4 }, { payments });

    const rows = await shareRows(s.mandateId);
    const pi4 = rows.get(`${person4}:own`)!.stripe_payment_intent_id!;
    expect(captureOf(capture, pi4)).toEqual([4357]);
    const refundCents = frontedShareRefundCents({ ownSharesCents: [4200], frontedShareCents: 4200 });
    expect(refundCents).toBe(4325);
    expect(refund).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledWith({
      paymentIntentId: pi1,
      amountCents: 4325,
      idempotencyKey: `cover-refund:${s.mandateId}:${person4}`,
      metadata: { mandate_id: s.mandateId, share_member_id: person4 },
    });
    // Person 4's capture happened before the refund, so the organizer is never out of pocket.
    expect(capture.mock.invocationCallOrder.at(-1)!).toBeLessThan(refund.mock.invocationCallOrder[0]!);
    expect(rows.get(`${person4}:own`)).toMatchObject({ status: "captured", captured_cents: 4357 });
    expect(rows.get(`${person4}:fronted`)).toMatchObject({ status: "refunded", refunded_cents: 4325 });
    expect(await refundsOn(pi1)).toHaveLength(1);
  });

  it("never claims: Person 1's PaymentIntent captured 8682, Person 4's own row stays awaiting_member, and nothing is refunded", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3, person4] = s.person;
    const { payments, capture, refund } = counted();
    await approveAll(s, [person1, person2, person3], payments);

    const rows = await shareRows(s.mandateId);
    expect(captureOf(capture, rows.get(`${person1}:own`)!.stripe_payment_intent_id!)).toEqual([8682]);
    expect(rows.get(`${person4}:own`)).toMatchObject({ status: "awaiting_member", payer_member_id: null });
    expect(rows.get(`${person4}:fronted`)!.status).toBe("captured");
    expect(await settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }, { payments })).toEqual({ refundedCents: 0 });
    expect(refund).not.toHaveBeenCalled();
  });

  it("claims then declines after capture: the fronted row stays captured, and nothing is refunded", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3, person4] = s.person;
    const { payments, refund } = counted();
    await approveAll(s, [person1, person2, person3], payments);
    await claimPlaceholder(s, await kit.createPayer(batch, "Person 4", "declined"));

    const result = await approveHold({ mandateId: s.mandateId, memberId: person4 }, { payments });

    expect(result.holds).toEqual([{ hold_id: expect.any(String), status: "declined" }]);
    const rows = await shareRows(s.mandateId);
    expect(rows.get(`${person4}:fronted`)!.status).toBe("captured");
    expect(refund).not.toHaveBeenCalled();
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
  });

  it("running the settlement twice refunds once", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3, person4] = s.person;
    const { payments, refund } = counted();
    await approveAll(s, [person1, person2, person3], payments);
    await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));
    await approveHold({ mandateId: s.mandateId, memberId: person4 }, { payments });

    expect(await settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }, { payments })).toEqual({ refundedCents: 0 });
    expect(await settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }, { payments })).toEqual({ refundedCents: 0 });

    expect(refund).toHaveBeenCalledTimes(1);
    const pi1 = (await shareRows(s.mandateId)).get(`${person1}:own`)!.stripe_payment_intent_id!;
    expect(await refundsOn(pi1)).toHaveLength(1);
  });

  it("claiming moves only that member's awaiting_member rows to pending and returns their mandate ids", async () => {
    const s = await mandateScenario(batch, payers);
    const lunch = await addMandate(batch, s, { key: "lunch", startsAt: "2026-09-26T17:00:00Z", endsAt: "2026-09-26T18:30:00Z" });
    const elsewhere = await mandateScenario(batch, payers);
    const before = await shareRows(s.mandateId);

    const { pendingMandateIds } = await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));

    expect(pendingMandateIds.sort()).toEqual([s.mandateId, lunch.mandateId].sort());
    const person4 = s.person[3];
    for (const mandateId of [s.mandateId, lunch.mandateId]) {
      expect((await shareRows(mandateId)).get(`${person4}:own`)).toMatchObject({ status: "pending", payer_member_id: person4 });
    }
    // Every other row, and the other trip's Person 4, stay as they were.
    const after = await shareRows(s.mandateId);
    for (const [key, row] of before) if (key !== `${person4}:own`) expect(after.get(key)).toEqual(row);
    expect((await shareRows(elsewhere.mandateId)).get(`${elsewhere.person[3]}:own`)!.status).toBe("awaiting_member");
    // Claiming again finds nothing left to move, and only a joined member can claim.
    expect(await onPlaceholderClaimed(person4)).toEqual({ pendingMandateIds: [] });
    await expect(onPlaceholderClaimed(elsewhere.person[3])).rejects.toMatchObject({ code: "not_permitted" });
  });
});

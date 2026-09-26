import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveHold, expireMandates } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { mandateRow, mandateScenario, paymentsKit, shareRows } from "../payments/kit";
import { adminClient, cleanup, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];

async function backdate(mandateId: string) {
  const { error } = await admin.from("mandates").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", mandateId);
  if (error) throw error;
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("expireMandates", () => {
  it("an open mandate past expires_at is cancelled with reason expired, and its holds are released", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    const pi1 = (await shareRows(s.mandateId)).get(`${s.person[0]}:own`)!.stripe_payment_intent_id!;
    await backdate(s.mandateId);

    const first = await expireMandates();

    expect(first.expired).toContain(s.mandateId);
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "expired" });
    const statuses = [...(await shareRows(s.mandateId)).values()].map((r) => r.status);
    expect(statuses.every((st) => st === "released")).toBe(true);
    expect((await kit.eventsFor(pi1)).map((e) => e.type)).toContain("payment_intent.canceled");

    const again = await expireMandates();
    expect(again.expired).not.toContain(s.mandateId);
  });

  it("two runs at once cancel the mandate once and release each PaymentIntent once", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    const pi1 = (await shareRows(s.mandateId)).get(`${s.person[0]}:own`)!.stripe_payment_intent_id!;
    await backdate(s.mandateId);

    const [a, b] = await Promise.all([expireMandates(), expireMandates()]);

    expect([...a.expired, ...b.expired].filter((id) => id === s.mandateId)).toHaveLength(1);
    const statuses = [...(await shareRows(s.mandateId)).values()].map((r) => r.status);
    expect(statuses.every((st) => st === "released")).toBe(true);
    expect((await kit.eventsFor(pi1)).filter((e) => e.type === "payment_intent.canceled")).toHaveLength(1);
  });

  it("a release that fails on one mandate still releases the others, and the next run retries it", async () => {
    const stuck = await mandateScenario(batch, payers);
    const other = await mandateScenario(batch, payers);
    for (const s of [stuck, other]) await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    const stuckPi = (await shareRows(stuck.mandateId)).get(`${stuck.person[0]}:own`)!.stripe_payment_intent_id!;
    await backdate(stuck.mandateId);
    await backdate(other.mandateId);
    const real = getPaymentsProvider();
    const failing: PaymentsProvider = {
      ...real,
      release: async (input) => {
        if (input.paymentIntentId === stuckPi) throw new AppError("provider_unavailable", "Stripe did not release the hold.");
        return real.release(input);
      },
    };

    const first = await expireMandates({ payments: failing });

    expect(first.expired).toEqual(expect.arrayContaining([stuck.mandateId, other.mandateId]));
    expect(first.failed).toContain(stuck.mandateId);
    expect(first.failed).not.toContain(other.mandateId);
    expect([...(await shareRows(other.mandateId)).values()].every((r) => r.status === "released")).toBe(true);
    expect((await shareRows(stuck.mandateId)).get(`${stuck.person[0]}:own`)!.status).toBe("authorized");

    const second = await expireMandates();

    expect(second.failed).not.toContain(stuck.mandateId);
    expect([...(await shareRows(stuck.mandateId)).values()].every((r) => r.status === "released")).toBe(true);
  });

  it("a mandate that hasn't expired is left open", async () => {
    const s = await mandateScenario(batch, payers);
    await expireMandates();
    expect((await mandateRow(s.mandateId)).status).toBe("open");
  });

  it("approving after expiry is refused", async () => {
    const s = await mandateScenario(batch, payers);
    await backdate(s.mandateId);
    await expireMandates();
    await expect(approveHold({ mandateId: s.mandateId, memberId: s.person[1] })).rejects.toMatchObject({
      code: "conflict",
      message: "The time to approve this purchase has run out.",
    });
  });
});

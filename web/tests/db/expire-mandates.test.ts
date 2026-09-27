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
    expect([...a.failed, ...b.failed]).not.toContain(s.mandateId);
    const statuses = [...(await shareRows(s.mandateId)).values()].map((r) => r.status);
    expect(statuses.every((st) => st === "released")).toBe(true);
    expect((await kit.eventsFor(pi1)).filter((e) => e.type === "payment_intent.canceled")).toHaveLength(1);
  });

  it("a release that fails on one mandate still releases the others, and the next run retries it", async () => {
    // Mandates are processed in id order, so the failing one goes first and would stop a loop that didn't isolate it.
    const sorted = [await mandateScenario(batch, payers), await mandateScenario(batch, payers)].sort((x, y) =>
      x.mandateId.localeCompare(y.mandateId),
    );
    const stuck = sorted[0]!;
    const other = sorted[1]!;
    for (const s of [stuck, other]) await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    const stuckPi = (await shareRows(stuck.mandateId)).get(`${stuck.person[0]}:own`)!.stripe_payment_intent_id!;
    await backdate(stuck.mandateId);
    await backdate(other.mandateId);
    const real = getPaymentsProvider();
    const failing: PaymentsProvider = {
      ...real,
      release: async (input) => {
        // A decline-shaped failure, not an outage, so the run carries on to the next mandate.
        if (input.paymentIntentId === stuckPi) throw new AppError("invalid_input", "This PaymentIntent can't be released.");
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
    expect((await kit.eventsFor(stuckPi)).map((e) => e.type)).toContain("payment_intent.canceled");
  });

  it("a provider outage stops the run at the first failure; the rest wait for the next run", async () => {
    const both = [await mandateScenario(batch, payers), await mandateScenario(batch, payers)];
    for (const s of both) {
      await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
      await backdate(s.mandateId);
    }
    const real = getPaymentsProvider();
    let releases = 0;
    const down: PaymentsProvider = {
      ...real,
      release: async () => {
        releases += 1;
        throw new AppError("provider_unavailable", "Stripe is unavailable.");
      },
    };

    const first = await expireMandates({ payments: down });

    expect(releases).toBe(1);
    expect(first.failed).toEqual(expect.arrayContaining(both.map((s) => s.mandateId)));

    const second = await expireMandates();

    expect(second.failed).toEqual([]);
    for (const s of both) expect([...(await shareRows(s.mandateId)).values()].every((r) => r.status === "released")).toBe(true);
  });

  it("it also finishes releasing the holds of a mandate the organizer cancelled", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    const pi1 = (await shareRows(s.mandateId)).get(`${s.person[0]}:own`)!.stripe_payment_intent_id!;
    // A cancel whose release failed: the mandate is cancelled, the hold still authorized.
    const { error } = await admin.from("mandates").update({ status: "cancelled", cancel_reason: "organizer" }).eq("id", s.mandateId);
    if (error) throw error;

    const run = await expireMandates();

    expect(run.expired).not.toContain(s.mandateId);
    expect(run.failed).not.toContain(s.mandateId);
    expect([...(await shareRows(s.mandateId)).values()].every((r) => r.status === "released")).toBe(true);
    expect((await kit.eventsFor(pi1)).map((e) => e.type)).toContain("payment_intent.canceled");
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

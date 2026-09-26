import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveHold, expireMandates } from "@/features/payments/server";
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

  it("a mandate that hasn't expired is left open", async () => {
    const s = await mandateScenario(batch, payers);
    await expireMandates();
    expect((await mandateRow(s.mandateId)).status).toBe("open");
  });

  it("approving after expiry is refused", async () => {
    const s = await mandateScenario(batch, payers);
    await backdate(s.mandateId);
    await expireMandates();
    await expect(approveHold({ mandateId: s.mandateId, memberId: s.person[1] })).rejects.toMatchObject({ code: "conflict" });
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveHold, approverFor } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { mandateRow, mandateScenario, paymentsKit, shareRows } from "../payments/kit";
import { cleanup, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
let payers: [TestUser, TestUser, TestUser];

/** The real provider, with authorize counted. */
function counted(): { payments: PaymentsProvider; authorize: ReturnType<typeof vi.fn> } {
  const real = getPaymentsProvider();
  const authorize = vi.fn(real.authorize.bind(real));
  return { payments: { ...real, name: real.name, authorize, parseWebhook: real.parseWebhook.bind(real) }, authorize };
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("approveHold", () => {
  it("a member's approval authorizes one PaymentIntent for their cap, with key pi-auth:{mandate_id}:{payer_member_id}", async () => {
    const s = await mandateScenario(batch, payers);
    const { payments, authorize } = counted();
    const person2 = s.person[1];

    const result = await approveHold({ mandateId: s.mandateId, memberId: person2 }, { payments });

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 4800,
        currency: "usd",
        idempotencyKey: `pi-auth:${s.mandateId}:${person2}`,
        metadata: { mandate_id: s.mandateId, payer_member_id: person2, trip_id: s.tripId },
      }),
    );
    const rows = await shareRows(s.mandateId);
    const own = rows.get(`${person2}:own`)!;
    expect(own).toMatchObject({ status: "authorized", stripe_payment_intent_id: expect.stringMatching(/^pi_/) });
    expect(own.authorized_at).not.toBeNull();
    expect(result).toEqual({ holds: [{ hold_id: own.id, status: "authorized" }], satisfied: false });
    // Nobody else's rows moved.
    expect(rows.get(`${s.person[2]}:own`)!.status).toBe("pending");
    expect((await mandateRow(s.mandateId)).status).toBe("open");
  });

  it("the organizer's approval authorizes one PaymentIntent up to 9600 and moves both their own and fronted rows to authorized", async () => {
    const s = await mandateScenario(batch, payers);
    const { payments, authorize } = counted();
    const [person1, , , person4] = s.person;

    const result = await approveHold({ mandateId: s.mandateId, memberId: person1 }, { payments });

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 9600, idempotencyKey: `pi-auth:${s.mandateId}:${person1}` }),
    );
    const rows = await shareRows(s.mandateId);
    const own = rows.get(`${person1}:own`)!;
    const fronted = rows.get(`${person4}:fronted`)!;
    expect([own.status, fronted.status]).toEqual(["authorized", "authorized"]);
    // One hold: both rows share the organizer's PaymentIntent.
    expect(fronted.stripe_payment_intent_id).toBe(own.stripe_payment_intent_id);
    expect(rows.get(`${person4}:own`)!.status).toBe("awaiting_member");
    expect(result.holds.map((h) => h.status)).toEqual(["authorized", "authorized"]);
  });

  it("two concurrent approvals call authorize once", async () => {
    const s = await mandateScenario(batch, payers);
    const { payments, authorize } = counted();
    const person3 = s.person[2];

    const results = await Promise.all([
      approveHold({ mandateId: s.mandateId, memberId: person3 }, { payments }),
      approveHold({ mandateId: s.mandateId, memberId: person3 }, { payments }),
    ]);

    expect(authorize).toHaveBeenCalledTimes(1);
    expect((await shareRows(s.mandateId)).get(`${person3}:own`)!.status).toBe("authorized");
    // The loser reports the row as it stood; approving again afterwards changes nothing.
    expect(results.every((r) => ["pending", "authorized"].includes(r.holds[0]!.status))).toBe(true);
    const again = await approveHold({ mandateId: s.mandateId, memberId: person3 }, { payments });
    expect(again.holds[0]!.status).toBe("authorized");
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("a declined card moves the hold to declined and the mandate to partially_declined", async () => {
    const declining = await kit.createPayer(batch, "Person 3", "declined");
    const s = await mandateScenario(batch, [payers[0], payers[1], declining]);
    const person3 = s.person[2];

    const result = await approveHold({ mandateId: s.mandateId, memberId: person3 });

    expect(result.holds[0]!.status).toBe("declined");
    const own = (await shareRows(s.mandateId)).get(`${person3}:own`)!;
    expect(own).toMatchObject({ status: "declined", decline_code: "generic_decline" });
    expect((await mandateRow(s.mandateId)).status).toBe("partially_declined");
  });

  it("only a joined member of the mandate's trip can approve", async () => {
    const s = await mandateScenario(batch, payers);
    const other = await mandateScenario(batch, payers);
    expect(await approverFor({ mandateId: s.mandateId, profileId: payers[1].userId })).toBe(s.person[1]);
    await expect(approveHold({ mandateId: s.mandateId, memberId: other.person[1] })).rejects.toMatchObject({ code: "not_permitted" });
    // A placeholder has no hold to approve until they claim their lane.
    await expect(approveHold({ mandateId: s.mandateId, memberId: s.person[3] })).rejects.toMatchObject({ code: "not_permitted" });
    const outsider = await kit.createPayer(batch, "Person 9");
    await expect(approverFor({ mandateId: s.mandateId, profileId: outsider.userId })).rejects.toMatchObject({ code: "not_permitted" });
  });
});

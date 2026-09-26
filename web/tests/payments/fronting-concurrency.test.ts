import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveHold, settleFrontedShare } from "@/features/payments/server";
import { getBookingProvider } from "@/lib/providers/booking";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { adminClient, cleanup, testBatch, type TestUser } from "../db/helpers";
import { claimPlaceholder, mandateRow, mandateScenario, paymentsKit, type ProviderEvent, shareRows, type MandateScenario } from "./kit";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];
const delivered: string[] = [];

async function deliver(event: ProviderEvent) {
  delivered.push(event.id);
  expect((await kit.deliver(event)).status).toBe(200);
}

async function ledger(eventId: string) {
  const { data, error } = await admin.from("webhook_events").select("status, attempts").eq("provider", "stripe").eq("event_id", eventId);
  if (error) throw error;
  return data;
}

const refundEventType = kit.provider === "real" ? "refund.created" : "charge.refunded";
const refundsOn = async (intent: string, waitForOne = false) =>
  (await kit.eventsFor(intent, waitForOne ? [refundEventType] : [])).filter((e) => e.type === refundEventType);

/** Captured without Person 4; Person 4 then claims and authorizes, but nobody has settled yet. */
async function readyToSettle(): Promise<MandateScenario & { pi1: string }> {
  const s = await mandateScenario(batch, payers);
  for (const memberId of s.person.slice(0, 3)) await approveHold({ mandateId: s.mandateId, memberId });
  await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));
  await approveHold({ mandateId: s.mandateId, memberId: s.person[3] }, { settle: async () => {} });
  const rows = await shareRows(s.mandateId);
  expect(rows.get(`${s.person[3]}:own`)!.status).toBe("authorized");
  expect(rows.get(`${s.person[3]}:fronted`)!.status).toBe("captured");
  return { ...s, pi1: rows.get(`${s.person[0]}:own`)!.stripe_payment_intent_id! };
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(async () => {
  if (delivered.length > 0) await admin.from("webhook_events").delete().in("event_id", delivered);
  await cleanup(batch);
});

describe("fronting concurrency", () => {
  it("Person 4 approving in parallel with the last finalizing approval: exactly one row pays Person 4's share, and nothing is refunded", async () => {
    /** Persons 1 and 2 approved and Person 4 claimed; Person 3's approval will finalize. */
    const nearlySatisfied = async () => {
      const s = await mandateScenario(batch, payers);
      await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));
      for (const memberId of s.person.slice(0, 2)) await approveHold({ mandateId: s.mandateId, memberId });
      return s;
    };
    const oneRowPays = async (s: MandateScenario, label: string) => {
      expect((await mandateRow(s.mandateId)).status, label).toBe("captured");
      const rows = await shareRows(s.mandateId);
      const person4Rows = [rows.get(`${s.person[3]}:own`)!, rows.get(`${s.person[3]}:fronted`)!];
      expect(person4Rows.filter((r) => r.status === "captured"), label).toHaveLength(1);
      // A hold that lost the race isn't left authorized.
      expect(person4Rows.map((r) => r.status), label).not.toContain("authorized");
      expect(await refundsOn(rows.get(`${s.person[0]}:own`)!.stripe_payment_intent_id!), label).toEqual([]);
      return person4Rows;
    };
    const until = async (condition: () => Promise<boolean>) => {
      for (let i = 0; i < 200 && !(await condition()); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    };
    const real = getPaymentsProvider();

    // Free-running races: whichever order they land in.
    for (let round = 0; round < 3; round++) {
      const s = await nearlySatisfied();
      const outcomes = await Promise.allSettled([
        approveHold({ mandateId: s.mandateId, memberId: s.person[2] }),
        approveHold({ mandateId: s.mandateId, memberId: s.person[3] }),
      ]);
      expect(outcomes[0].status).toBe("fulfilled");
      if (outcomes[1].status === "rejected") expect(outcomes[1].reason).toMatchObject({ code: "conflict", retryable: true });
      await oneRowPays(s, `free round ${round}`);
    }

    // Person 4's authorization is still in flight when the finalizer plans: the plan leaves their
    // hold out, so it's released, and the organizer's fronted row pays.
    {
      const s = await nearlySatisfied();
      const ownRow = async () => (await shareRows(s.mandateId)).get(`${s.person[3]}:own`)!;
      const slow: PaymentsProvider = {
        ...real,
        name: real.name,
        parseWebhook: real.parseWebhook.bind(real),
        authorize: async (input) => {
          const result = await real.authorize(input);
          await until(async () => (await ownRow()).pays_share !== null);
          return result;
        },
      };
      const person4 = approveHold({ mandateId: s.mandateId, memberId: s.person[3] }, { payments: slow });
      await until(async () => (await ownRow()).lease_expires_at !== null);
      await approveHold({ mandateId: s.mandateId, memberId: s.person[2] });
      await person4;
      const [own, fronted] = await oneRowPays(s, "in flight during planning");
      expect([own!.status, fronted!.status]).toEqual(["released", "captured"]);
      expect((await kit.eventsFor(own!.stripe_payment_intent_id!)).map((e) => e.type)).toContain("payment_intent.canceled");
    }

    // Person 4 approves while the finalizer is booking: they're told to try again, and the
    // organizer's fronted row pays.
    {
      const s = await nearlySatisfied();
      const merchant = getBookingProvider("tickets");
      let person4Tried = false;
      const booking = {
        ...merchant,
        quote: async (input: Parameters<typeof merchant.quote>[0]) => {
          await until(async () => person4Tried);
          return merchant.quote(input);
        },
      };
      const finalizing = approveHold({ mandateId: s.mandateId, memberId: s.person[2] }, { booking });
      await until(async () => (await mandateRow(s.mandateId)).status === "authorized");
      await expect(approveHold({ mandateId: s.mandateId, memberId: s.person[3] })).rejects.toMatchObject({ code: "conflict", retryable: true });
      person4Tried = true;
      await finalizing;
      const [own] = await oneRowPays(s, "approving while finalizing");
      expect(own!.status).toBe("pending");
    }
  });

  it("two parallel settlements refund Person 1 once", async () => {
    const s = await readyToSettle();
    const person4 = s.person[3];
    const results = await Promise.all([
      settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }),
      settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }),
    ]);

    expect(results.map((r) => r.refundedCents).sort((a, b) => a - b)).toEqual([0, 4325]);
    expect(await refundsOn(s.pi1, true)).toHaveLength(1);
    if (kit.stripe) expect(await kit.stripe.refundsFor(s.pi1)).toEqual([{ id: expect.any(String), amountCents: 4325 }]);
    const rows = await shareRows(s.mandateId);
    expect(rows.get(`${person4}:own`)!.status).toBe("captured");
    expect(rows.get(`${person4}:fronted`)).toMatchObject({ status: "refunded", refunded_cents: 4325 });
  });

  it("a duplicate refund event changes nothing", async () => {
    const s = await readyToSettle();
    await settleFrontedShare({ mandateId: s.mandateId, memberId: s.person[3] });
    const before = await shareRows(s.mandateId);
    const [refunded] = await refundsOn(s.pi1, true);

    await deliver(refunded!);
    await deliver(refunded!);

    expect(await ledger(refunded!.id)).toEqual([{ status: "processed", attempts: 1 }]);
    expect(await shareRows(s.mandateId)).toEqual(before);
  });

  it("a refund event handled before the settlement's own update marks the fronted row refunded once", async () => {
    const s = await readyToSettle();
    const person4 = s.person[3];
    const real = getPaymentsProvider();
    let seenByWebhook: { status: string; refunded_cents: number | null; updated_at: string } | undefined;
    const racing: PaymentsProvider = {
      ...real,
      name: real.name,
      parseWebhook: real.parseWebhook.bind(real),
      refund: async (input) => {
        const result = await real.refund(input);
        for (const event of await refundsOn(input.paymentIntentId, true)) await deliver(event);
        seenByWebhook = (await shareRows(s.mandateId)).get(`${person4}:fronted`)!;
        return result;
      },
    };

    expect(await settleFrontedShare({ mandateId: s.mandateId, memberId: person4 }, { payments: racing })).toEqual({ refundedCents: 4325 });

    expect(seenByWebhook).toMatchObject({ status: "refunded", refunded_cents: 4325 });
    const fronted = (await shareRows(s.mandateId)).get(`${person4}:fronted`)!;
    expect(fronted).toMatchObject({ status: "refunded", refunded_cents: 4325 });
    // The settlement's own conditional update found nothing to change.
    expect(fronted.updated_at).toBe(seenByWebhook!.updated_at);
    expect(await refundsOn(s.pi1, true)).toHaveLength(1);
    if (kit.stripe) expect(await kit.stripe.refundsFor(s.pi1)).toEqual([{ id: expect.any(String), amountCents: 4325 }]);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveHold } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { adminClient, cleanup, testBatch, type TestUser } from "../db/helpers";
import { mandateScenario, paymentsKit, shareRows } from "./kit";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];

async function ledger(eventId: string) {
  const { data, error } = await admin.from("webhook_events").select("status, attempts").eq("provider", "stripe").eq("event_id", eventId);
  if (error) throw error;
  return data;
}

const deliveredIds: string[] = [];

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(async () => {
  if (deliveredIds.length > 0) await admin.from("webhook_events").delete().in("event_id", deliveredIds);
  await cleanup(batch);
});

describe("approval concurrency", () => {
  it("parallel approvals by the same member create one PaymentIntent and authorize it once", async () => {
    const s = await mandateScenario(batch, payers);
    const person2 = s.person[1];
    await Promise.all(Array.from({ length: 5 }, () => approveHold({ mandateId: s.mandateId, memberId: person2 })));

    const own = (await shareRows(s.mandateId)).get(`${person2}:own`)!;
    expect(own.status).toBe("authorized");
    const events = await kit.eventsFor(own.stripe_payment_intent_id!);
    expect(events.filter((e) => e.type === "payment_intent.amount_capturable_updated")).toHaveLength(1);
  });

  it("a duplicate amount_capturable_updated is recorded once and changes nothing", async () => {
    const s = await mandateScenario(batch, payers);
    const person2 = s.person[1];
    await approveHold({ mandateId: s.mandateId, memberId: person2 });
    const before = (await shareRows(s.mandateId)).get(`${person2}:own`)!;
    const [event] = (await kit.eventsFor(before.stripe_payment_intent_id!)).filter((e) => e.type === "payment_intent.amount_capturable_updated");
    deliveredIds.push(event!.id);

    expect((await kit.deliver(event!)).status).toBe(200);
    expect((await kit.deliver(event!)).status).toBe(200);

    expect(await ledger(event!.id)).toEqual([{ status: "processed", attempts: 1 }]);
    const after = (await shareRows(s.mandateId)).get(`${person2}:own`)!;
    expect(after).toEqual(before);
  });

  it("amount_capturable_updated handled before the synchronous response leaves the payer's rows authorized once", async () => {
    const s = await mandateScenario(batch, payers);
    const person1 = s.person[0];
    const real = getPaymentsProvider();
    let webhookAuthorizedAt: string | null = null;
    // The provider's webhook overtakes the synchronous path: it lands before approveHold writes.
    const racing: PaymentsProvider = {
      ...real,
      name: real.name,
      parseWebhook: real.parseWebhook.bind(real),
      authorize: async (input) => {
        const result = await real.authorize(input);
        for (const event of await kit.eventsFor(result.paymentIntentId)) {
          deliveredIds.push(event.id);
          expect((await kit.deliver(event)).status).toBe(200);
        }
        const rows = await shareRows(s.mandateId);
        webhookAuthorizedAt = rows.get(`${person1}:own`)!.authorized_at;
        expect(rows.get(`${s.person[3]}:fronted`)!.status).toBe("authorized");
        return result;
      },
    };

    const result = await approveHold({ mandateId: s.mandateId, memberId: person1 }, { payments: racing });

    expect(webhookAuthorizedAt).not.toBeNull();
    expect(result.holds.map((h) => h.status)).toEqual(["authorized", "authorized"]);
    const rows = await shareRows(s.mandateId);
    const own = rows.get(`${person1}:own`)!;
    // The synchronous update found nothing pending, so the webhook's transition is the only one.
    expect(own.authorized_at).toBe(webhookAuthorizedAt);
    expect(rows.get(`${s.person[3]}:fronted`)!.stripe_payment_intent_id).toBe(own.stripe_payment_intent_id);
    const events = await kit.eventsFor(own.stripe_payment_intent_id!);
    expect(events.filter((e) => e.type === "payment_intent.amount_capturable_updated")).toHaveLength(1);
  });

  it("a webhook with a bad signature returns 400 and records nothing", async () => {
    const eventId = `evt_bad_${randomUUID()}`;
    const body = JSON.stringify({ id: eventId, type: "payment_intent.succeeded", data: { object: { id: "pi_x", object: "payment_intent" } } });
    const response = await kit.deliverRaw(body, "t=1,v1=deadbeef");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_input");
    expect(await ledger(eventId)).toEqual([]);
    expect((await kit.deliverRaw(body, "")).status).toBe(400);
  });
});

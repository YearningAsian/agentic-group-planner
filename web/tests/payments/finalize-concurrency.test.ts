import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveHold } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { adminClient, cleanup, testBatch, type TestUser } from "../db/helpers";
import { claimPlaceholder, mandateRow, mandateScenario, paymentsKit, type ProviderEvent, shareRows } from "./kit";

const batch = testBatch();
const kit = paymentsKit();
const admin = adminClient();
let payers: [TestUser, TestUser, TestUser];
const delivered: string[] = [];

async function deliver(event: ProviderEvent) {
  delivered.push(event.id);
  const response = await kit.deliver(event);
  expect(response.status).toBe(200);
}

async function ledger(eventId: string) {
  const { data, error } = await admin.from("webhook_events").select("status, attempts").eq("provider", "stripe").eq("event_id", eventId);
  if (error) throw error;
  return data;
}

async function bookingCount(mandateId: string) {
  const { count, error } = await admin.from("bookings").select("*", { count: "exact", head: true }).eq("mandate_id", mandateId);
  if (error) throw error;
  return count;
}

/** Every PaymentIntent on the mandate, and how many times the provider says each was captured. */
async function capturesByIntent(mandateId: string) {
  const intents = new Set([...(await shareRows(mandateId)).values()].map((r) => r.stripe_payment_intent_id).filter((id): id is string => !!id));
  const counts: Record<string, number> = {};
  for (const intent of intents) {
    counts[intent] = (await kit.eventsFor(intent)).filter((e) => e.type === "payment_intent.succeeded").length;
  }
  return counts;
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

describe("finalize concurrency", () => {
  it("approvals from all three members in parallel produce one booking and one capture per PaymentIntent", async () => {
    const s = await mandateScenario(batch, payers);
    const results = await Promise.all(s.person.slice(0, 3).map((memberId) => approveHold({ mandateId: s.mandateId, memberId })));

    expect(results.some((r) => r.satisfied)).toBe(true);
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
    expect(await bookingCount(s.mandateId)).toBe(1);
    const captures = await capturesByIntent(s.mandateId);
    expect(Object.values(captures)).toEqual([1, 1, 1]);
  });

  it("a duplicate payment_intent.succeeded changes nothing", async () => {
    const s = await mandateScenario(batch, payers);
    for (const memberId of s.person.slice(0, 3)) await approveHold({ mandateId: s.mandateId, memberId });
    const before = await shareRows(s.mandateId);
    const intent = before.get(`${s.person[0]}:own`)!.stripe_payment_intent_id!;
    const succeeded = (await kit.eventsFor(intent)).find((e) => e.type === "payment_intent.succeeded")!;

    await deliver(succeeded);
    await deliver(succeeded);

    expect(await ledger(succeeded.id)).toEqual([{ status: "processed", attempts: 1 }]);
    expect(await shareRows(s.mandateId)).toEqual(before);
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
  });

  it("payment_intent.succeeded handled before complete_mandate commits: rows end captured or released per pays_share, and the mandate is still booked once", async () => {
    const s = await mandateScenario(batch, payers);
    const person4 = await kit.createPayer(batch, "Person 4");
    await claimPlaceholder(s, person4);
    const real = getPaymentsProvider();
    // Each capture's webhook lands before the synchronous path records anything.
    const racing: PaymentsProvider = {
      ...real,
      name: real.name,
      parseWebhook: real.parseWebhook.bind(real),
      capture: async (input) => {
        const result = await real.capture(input);
        for (const event of (await kit.eventsFor(input.paymentIntentId)).filter((e) => e.type === "payment_intent.succeeded")) {
          await deliver(event);
        }
        return result;
      },
    };

    // Person 4 approves first, so their own row pays and the organizer's fronted row doesn't.
    for (const memberId of [s.person[3], s.person[0], s.person[1], s.person[2]]) {
      await approveHold({ mandateId: s.mandateId, memberId }, { payments: racing });
    }

    const rows = await shareRows(s.mandateId);
    for (const row of rows.values()) {
      expect(row.status, `${row.kind} row of ${row.share_member_id}`).toBe(row.pays_share ? "captured" : "released");
    }
    expect(rows.get(`${s.person[3]}:own`)).toMatchObject({ status: "captured", pays_share: true, captured_cents: 4357 });
    expect(rows.get(`${s.person[3]}:fronted`)).toMatchObject({ status: "released", pays_share: false });
    expect(rows.get(`${s.person[0]}:own`)).toMatchObject({ status: "captured", captured_cents: 4357 });
    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "captured", final_cents: 4357 * 4 });
    expect(await bookingCount(s.mandateId)).toBe(1);
  });

  it("a late amount_capturable_updated arriving after capture leaves the rows captured", async () => {
    const s = await mandateScenario(batch, payers);
    for (const memberId of s.person.slice(0, 3)) await approveHold({ mandateId: s.mandateId, memberId });
    const before = await shareRows(s.mandateId);
    const intent = before.get(`${s.person[1]}:own`)!.stripe_payment_intent_id!;
    const authorized = (await kit.eventsFor(intent)).find((e) => e.type === "payment_intent.amount_capturable_updated")!;

    await deliver(authorized);

    expect(await ledger(authorized.id)).toEqual([{ status: "processed", attempts: 1 }]);
    const after = await shareRows(s.mandateId);
    expect(after.get(`${s.person[1]}:own`)!.status).toBe("captured");
    expect(after).toEqual(before);
  });
});

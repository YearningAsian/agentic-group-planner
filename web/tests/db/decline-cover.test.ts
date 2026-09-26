import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approveHold, cancelByOrganizer, coverShortfall, declineHold } from "@/features/payments/server";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { AppError } from "@/lib/reliability";
import { claimPlaceholder, mandateRow, mandateScenario, paymentsKit, shareRows } from "../payments/kit";
import { adminClient, cleanup, createTrip, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const kit = paymentsKit();
let payers: [TestUser, TestUser, TestUser];

/** The real provider, with authorize and capture counted. */
function counted() {
  const real = getPaymentsProvider();
  const authorize = vi.fn(real.authorize.bind(real));
  const capture = vi.fn(real.capture.bind(real));
  const payments: PaymentsProvider = { ...real, name: real.name, authorize, capture, parseWebhook: real.parseWebhook.bind(real) };
  return { payments, authorize, capture };
}

beforeAll(async () => {
  payers = [
    await kit.createPayer(batch, "Person 1"),
    await kit.createPayer(batch, "Person 2"),
    await kit.createPayer(batch, "Person 3"),
  ];
});

afterAll(() => cleanup(batch));

describe("declineHold", () => {
  it("a decline moves the mandate to partially_declined", async () => {
    const s = await mandateScenario(batch, payers);

    const result = await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });

    expect(result).toEqual({ hold_status: "declined", mandate_status: "partially_declined" });
    const own = (await shareRows(s.mandateId)).get(`${s.person[1]}:own`)!;
    expect(own).toMatchObject({ status: "declined", stripe_payment_intent_id: null });
    expect((await mandateRow(s.mandateId)).status).toBe("partially_declined");
    // Declining again changes nothing more.
    expect(await declineHold({ mandateId: s.mandateId, memberId: s.person[1] })).toEqual(result);
  });

  it("a member who already approved can't decline", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[2] });

    await expect(declineHold({ mandateId: s.mandateId, memberId: s.person[2] })).rejects.toMatchObject({ code: "conflict" });
    expect((await shareRows(s.mandateId)).get(`${s.person[2]}:own`)!.status).toBe("authorized");
  });

  it("a placeholder who claims and declines leaves the mandate open, since the organizer's fronted row still pays", async () => {
    const s = await mandateScenario(batch, payers);
    await claimPlaceholder(s, await kit.createPayer(batch, "Person 4"));

    const result = await declineHold({ mandateId: s.mandateId, memberId: s.person[3] });

    expect(result).toEqual({ hold_status: "declined", mandate_status: "open" });
    expect((await shareRows(s.mandateId)).get(`${s.person[3]}:fronted`)!.status).toBe("pending");
  });

  it("the organizer can't decline; they cancel instead", async () => {
    const s = await mandateScenario(batch, payers);
    await expect(declineHold({ mandateId: s.mandateId, memberId: s.person[0] })).rejects.toMatchObject({ code: "domain_rule" });
    expect((await mandateRow(s.mandateId)).status).toBe("open");
  });
});

describe("coverShortfall", () => {
  it("the organizer covering the shortfall adds a fronted row to their hold, and the mandate proceeds", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3] = s.person;
    await approveHold({ mandateId: s.mandateId, memberId: person1 });
    await approveHold({ mandateId: s.mandateId, memberId: person3 });
    await declineHold({ mandateId: s.mandateId, memberId: person2 });
    const { payments, authorize, capture } = counted();

    const result = await coverShortfall({ mandateId: s.mandateId, memberId: person1 }, { payments });

    expect(result).toEqual({ mandate_status: "captured" });
    // An authorized hold can't grow, so the cover is its own PaymentIntent, capped like the share.
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 4800, idempotencyKey: `pi-auth:${s.mandateId}:${person1}:cover:${person2}` }),
    );
    const rows = await shareRows(s.mandateId);
    const cover = rows.get(`${person2}:fronted`)!;
    expect(cover).toMatchObject({ payer_member_id: person1, status: "captured", captured_cents: 4357 });
    expect(rows.get(`${person2}:own`)!.status).toBe("declined");
    // Each hold is captured once, under its own key: the organizer's main hold, Person 3's, and the cover.
    const keys = capture.mock.calls.map(([input]) => input.idempotencyKey).sort();
    expect(keys).toEqual(
      [`pi-capture:${s.mandateId}:${person1}`, `pi-capture:${s.mandateId}:${person1}:cover:${person2}`, `pi-capture:${s.mandateId}:${person3}`].sort(),
    );
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
  });

  it("covering before the others approve waits for them, then the last approval finalizes", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2, person3] = s.person;
    await declineHold({ mandateId: s.mandateId, memberId: person2 });

    expect(await coverShortfall({ mandateId: s.mandateId, memberId: person1 })).toEqual({ mandate_status: "partially_declined" });
    await approveHold({ mandateId: s.mandateId, memberId: person3 });
    const { payments, authorize } = counted();
    const last = await approveHold({ mandateId: s.mandateId, memberId: person1 }, { payments });

    expect(last.satisfied).toBe(true);
    // The organizer's main hold still covers only their own share and Person 4's.
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 9600, idempotencyKey: `pi-auth:${s.mandateId}:${person1}` }));
    expect((await mandateRow(s.mandateId)).status).toBe("captured");
  });

  it("two covers at once authorize the cover once", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[2] });
    await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });
    const { payments, authorize } = counted();

    await Promise.allSettled([
      coverShortfall({ mandateId: s.mandateId, memberId: s.person[0] }, { payments }),
      coverShortfall({ mandateId: s.mandateId, memberId: s.person[0] }, { payments }),
    ]);

    const coverCalls = authorize.mock.calls.filter(([input]) => input.idempotencyKey.includes(":cover:"));
    expect(coverCalls).toHaveLength(1);
    expect((await shareRows(s.mandateId)).get(`${s.person[1]}:fronted`)!.status).toBe("authorized");
  });

  it("a webhook for the organizer's main hold never moves a pending cover row", async () => {
    const s = await mandateScenario(batch, payers);
    const [person1, person2] = s.person;
    await declineHold({ mandateId: s.mandateId, memberId: person2 });
    // The cover's authorization fails in transit, so its row stays pending.
    const real = getPaymentsProvider();
    const flaky: PaymentsProvider = {
      ...real,
      name: real.name,
      parseWebhook: real.parseWebhook.bind(real),
      authorize: async (input) => {
        if (input.idempotencyKey.includes(":cover:")) throw new AppError("provider_unavailable", "Stripe is unavailable.");
        return real.authorize(input);
      },
    };
    await expect(coverShortfall({ mandateId: s.mandateId, memberId: person1 }, { payments: flaky })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    await approveHold({ mandateId: s.mandateId, memberId: person1 });
    const mainPi = (await shareRows(s.mandateId)).get(`${person1}:own`)!.stripe_payment_intent_id!;

    for (const event of await kit.eventsFor(mainPi)) expect((await kit.deliver(event)).status).toBe(200);

    expect((await shareRows(s.mandateId)).get(`${person2}:fronted`)).toMatchObject({ status: "pending", stripe_payment_intent_id: null });
  });

  it("a declined cover card leaves the mandate partially_declined", async () => {
    const organizer = await kit.createPayer(batch, "Person 1");
    const s = await mandateScenario(batch, [organizer, payers[1], payers[2]]);
    await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });
    await kit.setCard(organizer.userId, "declined");

    await expect(coverShortfall({ mandateId: s.mandateId, memberId: s.person[0] })).rejects.toMatchObject({ code: "domain_rule" });

    expect((await shareRows(s.mandateId)).get(`${s.person[1]}:fronted`)!.status).toBe("declined");
    expect((await mandateRow(s.mandateId)).status).toBe("partially_declined");
  });

  it("only the organizer can cover, and only a shortfall", async () => {
    const s = await mandateScenario(batch, payers);
    await expect(coverShortfall({ mandateId: s.mandateId, memberId: s.person[0] })).rejects.toMatchObject({ code: "conflict" });
    await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });
    await expect(coverShortfall({ mandateId: s.mandateId, memberId: s.person[2] })).rejects.toMatchObject({ code: "not_permitted" });
    expect((await shareRows(s.mandateId)).has(`${s.person[1]}:fronted`)).toBe(false);
  });

  it("cover_shortfall rejects a non-member actor with not_permitted", async () => {
    const s = await mandateScenario(batch, payers);
    await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });
    const other = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: payers[0].userId }] });

    const { error } = await adminClient().rpc("cover_shortfall", {
      payload: { trip_id: s.tripId, actor_member_id: other.memberIds[0], mandate_id: s.mandateId },
    });

    expect(error?.message).toMatch(/^not_permitted/);
    expect((await shareRows(s.mandateId)).has(`${s.person[1]}:fronted`)).toBe(false);
  });
});

describe("cancelByOrganizer", () => {
  it("the organizer cancelling releases every hold", async () => {
    const s = await mandateScenario(batch, payers);
    await approveHold({ mandateId: s.mandateId, memberId: s.person[0] });
    await approveHold({ mandateId: s.mandateId, memberId: s.person[2] });
    await declineHold({ mandateId: s.mandateId, memberId: s.person[1] });
    const organizerPi = (await shareRows(s.mandateId)).get(`${s.person[0]}:own`)!.stripe_payment_intent_id!;

    expect(await cancelByOrganizer({ mandateId: s.mandateId, memberId: s.person[0] })).toEqual({ mandate_status: "cancelled" });

    expect(await mandateRow(s.mandateId)).toMatchObject({ status: "cancelled", cancel_reason: "organizer" });
    const statuses = [...(await shareRows(s.mandateId)).values()].map((r) => r.status).sort();
    expect(statuses.every((st) => st === "released" || st === "declined")).toBe(true);
    expect((await kit.eventsFor(organizerPi)).map((e) => e.type)).toContain("payment_intent.canceled");
    // Cancelling again changes nothing.
    expect(await cancelByOrganizer({ mandateId: s.mandateId, memberId: s.person[0] })).toEqual({ mandate_status: "cancelled" });
  });

  it("only the organizer can cancel", async () => {
    const s = await mandateScenario(batch, payers);
    await expect(cancelByOrganizer({ mandateId: s.mandateId, memberId: s.person[1] })).rejects.toMatchObject({ code: "not_permitted" });
    expect((await mandateRow(s.mandateId)).status).toBe("open");
  });
});

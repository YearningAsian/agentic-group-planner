import { describe, expect, it } from "vitest";
import { selectPaymentsProvider } from "./index";
import { createMockPaymentsProvider, signMockWebhook } from "./mock";
import type { AuthorizeInput } from "./types";

const mandateId = "00000000-0000-4000-8000-0000000000e1";

async function setup(card: "visa" | "declined" = "visa") {
  const payments = createMockPaymentsProvider({ acceptWebhooks: true });
  const { customerId } = await payments.ensureCustomer({ profileId: "profile-1", name: "Person 1" });
  const { paymentMethodId } = await payments.attachTestCard({ customerId, card });
  const authorizeInput = (overrides: Partial<AuthorizeInput> = {}): AuthorizeInput => ({
    customerId,
    paymentMethodId,
    amountCents: 9600,
    currency: "usd",
    metadata: { mandate_id: mandateId, payer_member_id: "member-1" },
    idempotencyKey: `pi-auth:${mandateId}:member-1`,
    ...overrides,
  });
  return { payments, customerId, paymentMethodId, authorizeInput };
}

describe("mock payments provider", () => {
  it("authorize returns authorized with a pi_mock_ id", async () => {
    const { payments, authorizeInput } = await setup();
    const result = await payments.authorize(authorizeInput());
    expect(result.status).toBe("authorized");
    expect(result.paymentIntentId).toMatch(/^pi_mock_[0-9a-f]{24}$/);
    expect(result.declineCode).toBeUndefined();
    expect(payments.name).toBe("mock");
  });

  it("pm_mock_declined returns declined with a decline code", async () => {
    const { payments, paymentMethodId, authorizeInput } = await setup("declined");
    expect(paymentMethodId).toBe("pm_mock_declined");
    const result = await payments.authorize(authorizeInput());
    expect(result).toMatchObject({ status: "declined", declineCode: "generic_decline" });
    expect(result.paymentIntentId).toMatch(/^pi_mock_/);
    // A declined PaymentIntent has nothing to capture.
    await expect(
      payments.capture({ paymentIntentId: result.paymentIntentId, amountCents: 100, idempotencyKey: "cap-declined" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("capturing more than the authorized amount throws", async () => {
    const { payments, authorizeInput } = await setup();
    const { paymentIntentId } = await payments.authorize(authorizeInput());
    await expect(
      payments.capture({ paymentIntentId, amountCents: 9601, idempotencyKey: `pi-capture:${mandateId}:member-1` }),
    ).rejects.toMatchObject({ code: "invalid_input", retryable: false });

    // A partial capture is fine; Stripe releases the rest. Capturing again is not.
    const captured = await payments.capture({ paymentIntentId, amountCents: 4357, idempotencyKey: `pi-capture:${mandateId}:member-1` });
    expect(captured).toEqual({ status: "captured", capturedCents: 4357 });
    await expect(payments.capture({ paymentIntentId, amountCents: 1, idempotencyKey: "second-capture" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(payments.release({ paymentIntentId, idempotencyKey: "release-after-capture" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("the same idempotency key returns the same result", async () => {
    const { payments, authorizeInput } = await setup();
    const first = await payments.authorize(authorizeInput());
    expect(await payments.authorize(authorizeInput())).toEqual(first);
    // A new provider instance (another server process) derives the same PaymentIntent ID.
    const elsewhere = await (await setup()).payments.authorize(authorizeInput());
    expect(elsewhere.paymentIntentId).toBe(first.paymentIntentId);

    const capture = { paymentIntentId: first.paymentIntentId, amountCents: 8682, idempotencyKey: `pi-capture:${mandateId}:member-1` };
    const captured = await payments.capture(capture);
    expect(await payments.capture(capture)).toEqual(captured);

    const released = await (async () => {
      const other = await payments.authorize(authorizeInput({ idempotencyKey: `pi-auth:${mandateId}:member-2` }));
      const release = { paymentIntentId: other.paymentIntentId, idempotencyKey: `pi-release:${mandateId}:member-2` };
      const once = await payments.release(release);
      expect(await payments.release(release)).toEqual(once);
      return once;
    })();
    expect(released).toEqual({ status: "released" });

    // Reusing a key for different parameters is a bug, as it is on Stripe.
    await expect(payments.authorize(authorizeInput({ amountCents: 100 }))).rejects.toMatchObject({ code: "internal" });
  });

  it("refund returns one refund id per key", async () => {
    const { payments, authorizeInput } = await setup();
    const { paymentIntentId } = await payments.authorize(authorizeInput());
    await payments.capture({ paymentIntentId, amountCents: 8682, idempotencyKey: `pi-capture:${mandateId}:member-1` });

    const refund = { paymentIntentId, amountCents: 4325, idempotencyKey: `cover-refund:${mandateId}:member-4`, metadata: { mandate_id: mandateId, share_member_id: "member-4" } };
    const first = await payments.refund(refund);
    expect(first.refundId).toMatch(/^re_mock_[0-9a-f]{24}$/);
    expect(await payments.refund(refund)).toEqual(first);

    const second = await payments.refund({ ...refund, amountCents: 100, idempotencyKey: "another-refund" });
    expect(second.refundId).not.toBe(first.refundId);
    // Refunds never add up to more than was captured.
    await expect(payments.refund({ ...refund, amountCents: 8682, idempotencyKey: "too-much" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("parseWebhook accepts a body signed by signMockWebhook and rejects any other signature", async () => {
    const { payments } = await setup();
    const rawBody = JSON.stringify({
      id: "evt_mock_1",
      type: "payment_intent.amount_capturable_updated",
      data: { object: { id: "pi_mock_abc", object: "payment_intent", status: "requires_capture" } },
    });
    expect(payments.parseWebhook({ rawBody, signature: signMockWebhook(rawBody) })).toEqual({
      id: "evt_mock_1",
      type: "payment_intent.amount_capturable_updated",
      paymentIntentId: "pi_mock_abc",
      status: "requires_capture",
      metadata: {},
      declineCode: null,
      refunds: [],
    });

    const refunded = JSON.stringify({
      id: "evt_mock_2",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_mock_1",
          object: "charge",
          payment_intent: "pi_mock_abc",
          status: "succeeded",
          refunds: { data: [{ id: "re_mock_1", amount: 4325, metadata: { mandate_id: "m-1", share_member_id: "member-4" } }] },
        },
      },
    });
    expect(payments.parseWebhook({ rawBody: refunded, signature: signMockWebhook(refunded) })).toMatchObject({
      paymentIntentId: "pi_mock_abc",
      refunds: [{ id: "re_mock_1", amountCents: 4325, metadata: { mandate_id: "m-1", share_member_id: "member-4" } }],
    });

    const tampered = rawBody.replace("pi_mock_abc", "pi_mock_xyz");
    expect(() => payments.parseWebhook({ rawBody: tampered, signature: signMockWebhook(rawBody) })).toThrow(/signature/);
    expect(() => payments.parseWebhook({ rawBody, signature: "t=1,v1=00" })).toThrow(/signature/);
    const stale = signMockWebhook(rawBody, Math.floor(Date.now() / 1000) - 3600);
    expect(() => payments.parseWebhook({ rawBody, signature: stale })).toThrow(/signature/);
  });

  it("records the events Stripe would send, once per change, and they parse back with their metadata", async () => {
    const { payments, authorizeInput } = await setup();
    const { paymentIntentId } = await payments.authorize(authorizeInput());
    await payments.authorize(authorizeInput());
    await payments.capture({ paymentIntentId, amountCents: 8682, idempotencyKey: "cap" });
    await payments.capture({ paymentIntentId, amountCents: 8682, idempotencyKey: "cap" });
    await payments.refund({ paymentIntentId, amountCents: 4325, idempotencyKey: "ref", metadata: { mandate_id: mandateId, share_member_id: "member-4" } });

    const events = payments.eventsFor(paymentIntentId);
    expect(events.map((e) => e.type)).toEqual(["payment_intent.amount_capturable_updated", "payment_intent.succeeded", "charge.refunded"]);
    expect(new Set(events.map((e) => e.id)).size).toBe(3);
    const parsed = events.map((e) => {
      const raw = JSON.stringify(e);
      return payments.parseWebhook({ rawBody: raw, signature: signMockWebhook(raw) });
    });
    expect(parsed[0]).toMatchObject({ paymentIntentId, status: "requires_capture", metadata: { mandate_id: mandateId, payer_member_id: "member-1" } });
    expect(parsed[1]).toMatchObject({ paymentIntentId, status: "succeeded" });
    expect(parsed[2]!.refunds).toEqual([{ id: expect.stringMatching(/^re_mock_/), amountCents: 4325, metadata: { mandate_id: mandateId, share_member_id: "member-4" } }]);

    const declined = await setup("declined");
    const failed = await declined.payments.authorize(declined.authorizeInput());
    const [failure] = declined.payments.eventsFor(failed.paymentIntentId);
    const raw = JSON.stringify(failure);
    expect(declined.payments.parseWebhook({ rawBody: raw, signature: signMockWebhook(raw) })).toMatchObject({
      type: "payment_intent.payment_failed",
      declineCode: "generic_decline",
    });
    await declined.payments.release({ paymentIntentId: failed.paymentIntentId, idempotencyKey: "rel" });
    expect(declined.payments.eventsFor(failed.paymentIntentId).map((e) => e.type)).toEqual([
      "payment_intent.payment_failed",
      "payment_intent.canceled",
    ]);
  });

  it("selectPaymentsProvider picks the mock or the test-mode Stripe adapter", () => {
    expect(selectPaymentsProvider({ PAYMENTS_PROVIDER: "mock", NEXT_PUBLIC_DEMO_MODE: true }).name).toBe("mock");
    expect(selectPaymentsProvider({
      PAYMENTS_PROVIDER: "real", NEXT_PUBLIC_DEMO_MODE: true,
      STRIPE_SECRET_KEY: ["sk", "test", "placeholder"].join("_"), STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    }).name).toBe("real");
  });

  it("outside dev mode the mock refuses every webhook, even one signed with its own secret", () => {
    // The mock's secret is in the source, so on a deployment anyone could sign with it.
    const rawBody = JSON.stringify({ id: "evt_forged", type: "payment_intent.succeeded", data: { object: { id: "pi_x", object: "payment_intent" } } });
    const signature = signMockWebhook(rawBody);
    const deployed = selectPaymentsProvider({ PAYMENTS_PROVIDER: "mock", NEXT_PUBLIC_DEMO_MODE: false });
    expect(() => deployed.parseWebhook({ rawBody, signature })).toThrow(/dev mode/);
    expect(() => createMockPaymentsProvider().parseWebhook({ rawBody, signature })).toThrow(/dev mode/);
    const dev = selectPaymentsProvider({ PAYMENTS_PROVIDER: "mock", NEXT_PUBLIC_DEMO_MODE: true });
    expect(dev.parseWebhook({ rawBody, signature }).id).toBe("evt_forged");
  });
});

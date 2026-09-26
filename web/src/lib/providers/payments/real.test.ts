import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createStripePaymentsProvider, STRIPE_API_VERSION, STRIPE_OPTIONS } from "./real";

const secretKey = ["sk", "test", "placeholder"].join("_");
const webhookSecret = "whsec_placeholder";
const mandateId = "00000000-0000-4000-8000-0000000000e1";
const memberId = "00000000-0000-4000-8000-0000000000e2";

function setup() {
  const realWebhooks = new Stripe(secretKey).webhooks;
  const sdk = {
    customers: { create: vi.fn().mockResolvedValue({ id: "cus_1" }) },
    paymentMethods: { attach: vi.fn().mockResolvedValue({ id: "pm_attached" }) },
    paymentIntents: {
      create: vi.fn().mockResolvedValue({ id: "pi_1", status: "requires_capture" }),
      capture: vi.fn().mockResolvedValue({ id: "pi_1", status: "succeeded", amount_received: 4325 }),
      cancel: vi.fn().mockResolvedValue({ id: "pi_1", status: "canceled" }),
    },
    refunds: { create: vi.fn().mockResolvedValue({ id: "re_1" }) },
    webhooks: realWebhooks,
  };
  const provider = createStripePaymentsProvider({
    secretKey,
    webhookSecret,
    demoMode: true,
    client: sdk as unknown as Stripe,
  });
  return { sdk, provider, realWebhooks };
}

describe("Stripe payments provider", () => {
  it("pins the SDK API version, two network retries, and ten seconds per request", () => {
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    expect(STRIPE_OPTIONS).toMatchObject({ apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 10_000 });
    expect(() => createStripePaymentsProvider({ secretKey: "sk_live_invalid", webhookSecret, demoMode: true })).toThrow(/test.mode/i);
  });

  it("creates a customer with a stable key and attaches test cards only in demo mode", async () => {
    const { sdk, provider } = setup();
    expect(await provider.ensureCustomer({ profileId: "profile-1", email: "p1@example.test", name: "Person 1" })).toEqual({ customerId: "cus_1" });
    expect(sdk.customers.create).toHaveBeenCalledWith(
      { email: "p1@example.test", name: "Person 1", metadata: { profile_id: "profile-1" } },
      { idempotencyKey: "customer:profile-1" },
    );
    expect(await provider.attachTestCard({ customerId: "cus_1", card: "visa" })).toEqual({ paymentMethodId: "pm_attached" });
    expect(sdk.paymentMethods.attach).toHaveBeenCalledWith(
      "pm_card_visa",
      { customer: "cus_1" },
      { idempotencyKey: "test-card:cus_1:visa" },
    );
    await provider.attachTestCard({ customerId: "cus_1", card: "declined" });
    expect(sdk.paymentMethods.attach).toHaveBeenCalledWith(
      "pm_card_chargeCustomerFail",
      { customer: "cus_1" },
      { idempotencyKey: "test-card:cus_1:declined" },
    );
    const deployed = createStripePaymentsProvider({ secretKey, webhookSecret, demoMode: false, client: sdk as unknown as Stripe });
    await expect(deployed.attachTestCard({ customerId: "cus_1", card: "visa" })).rejects.toMatchObject({ code: "not_permitted" });
  });

  it("authorizes one manual card PaymentIntent with the mandate and payer idempotency key", async () => {
    const { sdk, provider } = setup();
    const metadata = { mandate_id: mandateId, payer_member_id: memberId, trip_id: "trip-1" };
    const idempotencyKey = `pi-auth:${mandateId}:${memberId}`;
    expect(await provider.authorize({
      customerId: "cus_1", paymentMethodId: "pm_1", amountCents: 9600, currency: "usd", metadata, idempotencyKey,
    })).toEqual({ paymentIntentId: "pi_1", status: "authorized" });
    expect(sdk.paymentIntents.create).toHaveBeenCalledWith(
      {
        amount: 9600, currency: "usd", customer: "cus_1", payment_method: "pm_1", metadata,
        capture_method: "manual", confirm: true, payment_method_types: ["card"],
      },
      { idempotencyKey },
    );
  });

  it("returns a card decline with its PaymentIntent and issuer decline code", async () => {
    const { sdk, provider } = setup();
    sdk.paymentIntents.create.mockRejectedValueOnce(Object.assign(new Error("declined"), {
      type: "StripeCardError", code: "card_declined", decline_code: "generic_decline", payment_intent: { id: "pi_declined" },
    }));
    const result = await provider.authorize({
      customerId: "cus_1", paymentMethodId: "pm_declined", amountCents: 4800, currency: "usd",
      metadata: { mandate_id: mandateId, payer_member_id: memberId }, idempotencyKey: `pi-auth:${mandateId}:${memberId}`,
    });
    expect(result).toEqual({ paymentIntentId: "pi_declined", status: "declined", declineCode: "generic_decline" });
  });

  it("captures only the requested amount and cancels an uncaptured hold with their keys", async () => {
    const { sdk, provider } = setup();
    expect(await provider.capture({ paymentIntentId: "pi_1", amountCents: 4325, idempotencyKey: "pi-capture:mandate:payer" })).toEqual({
      status: "captured", capturedCents: 4325,
    });
    expect(sdk.paymentIntents.capture).toHaveBeenCalledWith("pi_1", { amount_to_capture: 4325 }, { idempotencyKey: "pi-capture:mandate:payer" });
    expect(await provider.release({ paymentIntentId: "pi_1", idempotencyKey: "pi-release:mandate:payer" })).toEqual({ status: "released" });
    expect(sdk.paymentIntents.cancel).toHaveBeenCalledWith("pi_1", {}, { idempotencyKey: "pi-release:mandate:payer" });
  });

  it("refunds a fronted share partially with identifying metadata and its idempotency key", async () => {
    const { sdk, provider } = setup();
    const metadata = { mandate_id: mandateId, share_member_id: memberId };
    expect(await provider.refund({ paymentIntentId: "pi_1", amountCents: 4325, metadata, idempotencyKey: "cover-refund:mandate:share" })).toEqual({ refundId: "re_1" });
    expect(sdk.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 4325, metadata },
      { idempotencyKey: "cover-refund:mandate:share" },
    );
  });

  it("verifies the exact raw webhook body and normalizes PaymentIntent and charge refunds", () => {
    const { provider, realWebhooks } = setup();
    const paymentIntentBody = JSON.stringify({
      id: "evt_pi", type: "payment_intent.payment_failed",
      data: { object: { id: "pi_1", object: "payment_intent", status: "requires_payment_method", metadata: { mandate_id: mandateId }, last_payment_error: { decline_code: "generic_decline" } } },
    });
    const piSignature = realWebhooks.generateTestHeaderString({ payload: paymentIntentBody, secret: webhookSecret });
    expect(provider.parseWebhook({ rawBody: paymentIntentBody, signature: piSignature })).toEqual({
      id: "evt_pi", type: "payment_intent.payment_failed", paymentIntentId: "pi_1", status: "requires_payment_method",
      metadata: { mandate_id: mandateId }, declineCode: "generic_decline", refunds: [],
    });
    expect(() => provider.parseWebhook({ rawBody: `${paymentIntentBody} `, signature: piSignature })).toThrow();

    const chargeBody = JSON.stringify({
      id: "evt_refund", type: "charge.refunded",
      data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_1", status: "succeeded", metadata: { mandate_id: mandateId }, refunds: { data: [{ id: "re_1", amount: 4325, metadata: { mandate_id: mandateId, share_member_id: memberId } }] } } },
    });
    const chargeSignature = realWebhooks.generateTestHeaderString({ payload: chargeBody, secret: webhookSecret });
    expect(provider.parseWebhook({ rawBody: chargeBody, signature: chargeSignature })).toMatchObject({
      paymentIntentId: "pi_1", refunds: [{ id: "re_1", amountCents: 4325, metadata: { mandate_id: mandateId, share_member_id: memberId } }],
    });
  });
});

import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { createMockPaymentsProvider } from "@/lib/providers/payments/mock";
import { STRIPE_OPTIONS } from "@/lib/providers/payments/real";
import type { TestUser } from "../../tests/db/helpers";

vi.mock("@/lib/providers/payments", () => ({ getPaymentsProvider: () => ({ name: "real" }) }));
vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_WEBHOOK_SECRET: "whsec_fixture" }),
}));
vi.mock("../../tests/db/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tests/db/helpers")>()),
  adminClient: () => ({}),
}));

import * as kitModule from "../../tests/payments/kit";

const { paymentsKit } = kitModule;
type KitFactory = (options: {
  provider: ReturnType<typeof createMockPaymentsProvider>;
  stripe: Stripe;
  webhookSecret: string;
  createUser: (options: { batch: string; displayName?: string }) => Promise<TestUser>;
  readProfile: (profileId: string) => Promise<{ customerId: string | null; displayName: string }>;
  saveCard: (profileId: string, customerId: string, paymentMethodId: string) => Promise<void>;
  post: (rawBody: string, signature: string) => Promise<Response>;
  eventWaitMs?: number;
}) => ReturnType<typeof paymentsKit>;

function fixture(settings: { eventWaitMs?: number } = {}) {
  const profile = { customerId: null as string | null, paymentMethodId: null as string | null };
  const stripe = new Stripe("test-only", STRIPE_OPTIONS);
  const createUser = vi.fn(async () => ({ userId: "profile-1", email: "person@example.test", client: {} }) as TestUser);
  const post = vi.fn(async (rawBody: string, signature: string) => {
    if (!rawBody || !signature) throw new Error("Webhook delivery needs a signed body.");
    return Response.json({ received: true });
  });
  const options = {
    provider: createMockPaymentsProvider(),
    stripe,
    webhookSecret: "whsec_fixture",
    createUser,
    readProfile: vi.fn(async () => ({ customerId: profile.customerId, displayName: "Person 1" })),
    saveCard: vi.fn(async (_id: string, customerId: string, paymentMethodId: string) => {
      profile.customerId = customerId;
      profile.paymentMethodId = paymentMethodId;
    }),
    post,
    ...settings,
  };
  const createKit = (kitModule as typeof kitModule & { createStripePaymentsKit: KitFactory }).createStripePaymentsKit;
  return { kit: createKit(options), options, profile };
}

function event(id: string, type: string, object: Record<string, unknown>, created: number): Stripe.Event {
  return {
    id,
    object: "event",
    type,
    created,
    api_version: STRIPE_OPTIONS.apiVersion,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: { object },
  } as unknown as Stripe.Event;
}

describe("Stripe payments kit", () => {
  it("selects the real test-mode branch", () => {
    expect(paymentsKit().provider).toBe("real");
  });

  it("creates a payer with a saved Visa test card, then reuses the customer when switching cards", async () => {
    const { kit, options, profile } = fixture();

    expect((await kit.createPayer("test:batch", "Person 1")).userId).toBe("profile-1");
    expect(profile.customerId).toMatch(/^cus_mock_/);
    expect(profile.paymentMethodId).toBe("pm_mock_visa");
    expect(options.createUser).toHaveBeenCalledWith({ batch: "test:batch", displayName: "Person 1" });

    const originalCustomer = profile.customerId;
    await kit.setCard("profile-1", "declined");
    expect(profile.customerId).toBe(originalCustomer);
    expect(profile.paymentMethodId).toBe("pm_mock_declined");
  });

  it("returns only the payment events for one PaymentIntent, oldest first", async () => {
    const { kit, options } = fixture();
    vi.spyOn(options.stripe.paymentIntents, "retrieve").mockResolvedValue({ id: "pi_target", created: 100 } as Stripe.Response<Stripe.PaymentIntent>);
    const listed = [
      event("evt_refund", "refund.created", { object: "refund", id: "re_1", payment_intent: "pi_target" }, 103),
      event("evt_other", "payment_intent.succeeded", { object: "payment_intent", id: "pi_other" }, 102),
      event("evt_charge", "charge.refunded", { object: "charge", id: "ch_1", payment_intent: "pi_target" }, 102),
      event("evt_auth", "payment_intent.amount_capturable_updated", { object: "payment_intent", id: "pi_target" }, 101),
    ];
    const list = vi.spyOn(options.stripe.events, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        for (const value of listed) yield value;
      },
    }) as unknown as ReturnType<Stripe["events"]["list"]>);

    expect((await kit.eventsFor("pi_target")).map((e) => e.id)).toEqual(["evt_auth", "evt_charge", "evt_refund"]);
    expect(list).toHaveBeenCalledWith({ created: { gte: 100 }, types: expect.arrayContaining(["payment_intent.succeeded", "refund.created"]), limit: 100 });
  });

  it("signs the exact event body accepted by Stripe's verifier before delivery", async () => {
    const { kit, options } = fixture();
    const sent = event("evt_1", "payment_intent.succeeded", { object: "payment_intent", id: "pi_1" }, 100);

    expect((await kit.deliver(sent as unknown as Parameters<typeof kit.deliver>[0])).status).toBe(200);
    const [rawBody, signature] = options.post.mock.calls[0]!;
    expect(options.stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret).id).toBe(sent.id);
    expect(JSON.parse(rawBody)).toEqual(sent);
  });

  it("waits for a captured PaymentIntent's event to appear in Stripe's Events API", async () => {
    const { kit, options } = fixture();
    vi.spyOn(options.stripe.paymentIntents, "retrieve").mockResolvedValue({
      id: "pi_target",
      created: 100,
      status: "succeeded",
    } as Stripe.Response<Stripe.PaymentIntent>);
    let calls = 0;
    vi.spyOn(options.stripe.events, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        calls += 1;
        if (calls === 2) yield event("evt_captured", "payment_intent.succeeded", { object: "payment_intent", id: "pi_target" }, 101);
      },
    }) as unknown as ReturnType<Stripe["events"]["list"]>);

    expect((await kit.eventsFor("pi_target")).map((e) => e.id)).toEqual(["evt_captured"]);
    expect(calls).toBe(2);
  });

  it("reports a missing capture event instead of treating an empty listing as success", async () => {
    const { kit, options } = fixture({ eventWaitMs: 0 });
    vi.spyOn(options.stripe.paymentIntents, "retrieve").mockResolvedValue({
      id: "pi_target",
      created: 100,
      status: "succeeded",
    } as Stripe.Response<Stripe.PaymentIntent>);
    vi.spyOn(options.stripe.events, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {},
    }) as unknown as ReturnType<Stripe["events"]["list"]>);

    await expect(kit.eventsFor("pi_target")).rejects.toThrow(/payment_intent\.succeeded/);
  });

  it("waits for an explicitly requested refund event after an already visible capture", async () => {
    const { kit, options } = fixture();
    vi.spyOn(options.stripe.paymentIntents, "retrieve").mockResolvedValue({
      id: "pi_target",
      created: 100,
      status: "succeeded",
    } as Stripe.Response<Stripe.PaymentIntent>);
    let calls = 0;
    vi.spyOn(options.stripe.events, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        calls += 1;
        if (calls === 2) yield event("evt_refund", "refund.created", { object: "refund", id: "re_1", payment_intent: "pi_target" }, 102);
        yield event("evt_capture", "payment_intent.succeeded", { object: "payment_intent", id: "pi_target" }, 101);
      },
    }) as unknown as ReturnType<Stripe["events"]["list"]>);

    expect((await kit.eventsFor("pi_target", ["refund.created"])).map((e) => e.id)).toEqual(["evt_capture", "evt_refund"]);
    expect(calls).toBe(2);
  });

  it("inspects one payer's actual captured intents and refunds in Stripe", async () => {
    const { kit, options, profile } = fixture();
    await kit.createPayer("test:batch", "Person 1");
    vi.spyOn(options.stripe.paymentIntents, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield { id: "pi_other", amount_received: 9000, metadata: { mandate_id: "other" } };
        yield { id: "pi_target", amount_received: 8682, metadata: { mandate_id: "mandate-1" } };
      },
    }) as unknown as ReturnType<Stripe["paymentIntents"]["list"]>);
    const refunds = vi.spyOn(options.stripe.refunds, "list").mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield { id: "re_target", amount: 4325 };
      },
    }) as unknown as ReturnType<Stripe["refunds"]["list"]>);
    const inspection = (kit as typeof kit & {
      stripe?: {
        intentsFor(profileId: string, mandateId: string): Promise<{ id: string; amountReceivedCents: number }[]>;
        refundsFor(paymentIntentId: string): Promise<{ id: string; amountCents: number }[]>;
      };
    }).stripe;

    expect(await inspection?.intentsFor("profile-1", "mandate-1")).toEqual([{ id: "pi_target", amountReceivedCents: 8682 }]);
    expect(await inspection?.refundsFor("pi_target")).toEqual([{ id: "re_target", amountCents: 4325 }]);
    expect(options.stripe.paymentIntents.list).toHaveBeenCalledWith({ customer: profile.customerId, limit: 100 });
    expect(refunds).toHaveBeenCalledWith({ payment_intent: "pi_target", limit: 100 });
  });
});

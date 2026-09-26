import "server-only";
import Stripe from "stripe";
import { AppError, withPolicy } from "@/lib/reliability";
import type { AuthorizeInput, PaymentsEvent, PaymentsProvider } from "./types";

/** Match the API version shipped with the pinned stripe@22.6.2 SDK. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";
export const STRIPE_OPTIONS = {
  apiVersion: STRIPE_API_VERSION,
  maxNetworkRetries: 2,
  timeout: 10_000,
} as const satisfies Stripe.StripeConfig;

// The SDK retries individual requests; this outer bound gives its three attempts time to finish.
const STRIPE_POLICY = { timeoutMs: 40_000, retries: 0 } as const;

interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  demoMode: boolean;
  /** Tests inject an SDK double; production constructs the pinned SDK client. */
  client?: Stripe;
}

function positiveCents(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError("invalid_input", "Amounts must be positive integer cents.", { retryable: false });
  }
}

async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await withPolicy(() => call(), STRIPE_POLICY);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as { type?: unknown } | null)?.type === "StripeInvalidRequestError") {
      throw new AppError("invalid_input", "Stripe rejected the payment request.", { retryable: false, cause: error });
    }
    throw new AppError("provider_unavailable", "Stripe could not complete the payment request. Try again.", { cause: error });
  }
}

function cardDecline(error: unknown): { paymentIntentId: string; status: "declined"; declineCode: string } | null {
  const failed = error as {
    type?: unknown;
    code?: unknown;
    decline_code?: unknown;
    payment_intent?: { id?: unknown };
  } | null;
  if (failed?.type !== "StripeCardError" || failed.code !== "card_declined") return null;
  const paymentIntentId = failed.payment_intent?.id;
  if (typeof paymentIntentId !== "string" || !paymentIntentId) return null;
  return {
    paymentIntentId,
    status: "declined",
    declineCode: typeof failed.decline_code === "string" ? failed.decline_code : "card_declined",
  };
}

function normalizeEvent(event: Stripe.Event): PaymentsEvent {
  const object = event.data.object;
  const isIntent = event.type.startsWith("payment_intent.");
  const isCharge = event.type.startsWith("charge.");
  const intent = isIntent ? (object as Stripe.PaymentIntent) : null;
  const charge = isCharge ? (object as Stripe.Charge) : null;
  const paymentIntent = charge?.payment_intent;
  return {
    id: event.id,
    type: event.type,
    paymentIntentId: intent?.id ?? (typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null),
    status: intent?.status ?? charge?.status ?? null,
    metadata: intent?.metadata ?? charge?.metadata ?? {},
    declineCode: intent?.last_payment_error?.decline_code ?? null,
    refunds: (charge?.refunds?.data ?? []).map((refund) => ({
      id: refund.id,
      amountCents: refund.amount,
      metadata: refund.metadata ?? {},
    })),
  };
}

/** Stripe test-mode adapter; live secret keys are refused even when called outside the env loader. */
export function createStripePaymentsProvider(options: StripeProviderOptions): PaymentsProvider {
  if (!options.secretKey.startsWith("sk_test_")) {
    throw new AppError("invalid_input", "Stripe payments require a test-mode key.", { retryable: false });
  }
  if (!options.webhookSecret) {
    throw new AppError("invalid_input", "A Stripe webhook secret is required.", { retryable: false });
  }
  const stripe = options.client ?? new Stripe(options.secretKey, STRIPE_OPTIONS);

  return {
    name: "real",

    async ensureCustomer({ profileId, email, name }) {
      const customer = await stripeCall(() => stripe.customers.create(
        { ...(email ? { email } : {}), name, metadata: { profile_id: profileId } },
        { idempotencyKey: `customer:${profileId}` },
      ));
      return { customerId: customer.id };
    },

    async attachTestCard({ customerId, card }) {
      if (!options.demoMode) {
        throw new AppError("not_permitted", "Test cards are available in demo mode only.", { retryable: false });
      }
      // Unlike pm_card_visa_chargeDeclined, this test method can be attached before it declines.
      const testMethod = card === "visa" ? "pm_card_visa" : "pm_card_chargeCustomerFail";
      const method = await stripeCall(() => stripe.paymentMethods.attach(
        testMethod,
        { customer: customerId },
        { idempotencyKey: `test-card:${customerId}:${card}` },
      ));
      return { paymentMethodId: method.id };
    },

    async authorize(input: AuthorizeInput) {
      positiveCents(input.amountCents);
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripeCall(() => stripe.paymentIntents.create({
          amount: input.amountCents,
          currency: input.currency,
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          metadata: input.metadata,
          capture_method: "manual",
          confirm: true,
          payment_method_types: ["card"],
        }, { idempotencyKey: input.idempotencyKey }));
      } catch (error) {
        const decline = cardDecline(error instanceof AppError ? error.cause : error);
        if (decline) return decline;
        throw error;
      }
      if (intent.status === "requires_capture") return { paymentIntentId: intent.id, status: "authorized" };
      if (intent.status === "requires_payment_method" && intent.last_payment_error?.code === "card_declined") {
        return {
          paymentIntentId: intent.id,
          status: "declined",
          declineCode: intent.last_payment_error.decline_code ?? "card_declined",
        };
      }
      return { paymentIntentId: intent.id, status: "failed" };
    },

    async capture({ paymentIntentId, amountCents, idempotencyKey }) {
      positiveCents(amountCents);
      const intent = await stripeCall(() => stripe.paymentIntents.capture(
        paymentIntentId,
        { amount_to_capture: amountCents },
        { idempotencyKey },
      ));
      if (intent.status !== "succeeded" || intent.amount_received !== amountCents) {
        throw new AppError("provider_unavailable", "Stripe did not confirm the requested capture.");
      }
      return { status: "captured", capturedCents: intent.amount_received };
    },

    async release({ paymentIntentId, idempotencyKey }) {
      const intent = await stripeCall(() => stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey }));
      if (intent.status !== "canceled") {
        throw new AppError("provider_unavailable", "Stripe did not release the hold.");
      }
      return { status: "released" };
    },

    async refund({ paymentIntentId, amountCents, idempotencyKey, metadata }) {
      positiveCents(amountCents);
      const refund = await stripeCall(() => stripe.refunds.create(
        { payment_intent: paymentIntentId, amount: amountCents, metadata },
        { idempotencyKey },
      ));
      return { refundId: refund.id };
    },

    parseWebhook({ rawBody, signature }) {
      try {
        return normalizeEvent(stripe.webhooks.constructEvent(rawBody, signature, options.webhookSecret));
      } catch (error) {
        throw new AppError("invalid_input", "The Stripe webhook signature or body is invalid.", {
          retryable: false,
          cause: error,
        });
      }
    },
  };
}

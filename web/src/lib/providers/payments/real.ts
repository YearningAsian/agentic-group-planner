import "server-only";
import Stripe from "stripe";
import { AppError, withPolicy } from "@/lib/reliability";
import type { AuthorizeInput, PaymentsEvent, PaymentsProvider } from "./types";
import { STRIPE_OPTIONS, STRIPE_POLICY } from "./stripe-config";

export { STRIPE_API_VERSION, STRIPE_OPTIONS, STRIPE_POLICY } from "./stripe-config";

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

function isStripeCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code;
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

/** Any card failure that produced a PaymentIntent is a decline we record, not a retryable outage. */
function cardDecline(error: unknown): { paymentIntentId: string; status: "declined"; declineCode: string } | null {
  const failed = error as {
    type?: unknown;
    code?: unknown;
    decline_code?: unknown;
    payment_intent?: { id?: unknown };
  } | null;
  if (failed?.type !== "StripeCardError") return null;
  const paymentIntentId = failed.payment_intent?.id;
  if (typeof paymentIntentId !== "string" || !paymentIntentId) return null;
  return {
    paymentIntentId,
    status: "declined",
    declineCode:
      typeof failed.decline_code === "string"
        ? failed.decline_code
        : typeof failed.code === "string"
          ? failed.code
          : "card_declined",
  };
}

function asRecord(metadata: Stripe.Metadata | null | undefined): Record<string, string> {
  return metadata ?? {};
}

function normalizeEvent(event: Stripe.Event): PaymentsEvent {
  const isIntent = event.type.startsWith("payment_intent.");
  const isCharge = event.type.startsWith("charge.");
  const isRefund = event.type.startsWith("refund.");
  const intent = isIntent ? (event.data.object as Stripe.PaymentIntent) : null;
  const charge = isCharge ? (event.data.object as Stripe.Charge) : null;
  const refund = isRefund ? (event.data.object as Stripe.Refund) : null;
  const chargePi = charge?.payment_intent;
  const refundPi = refund?.payment_intent;
  return {
    id: event.id,
    type: event.type,
    paymentIntentId:
      intent?.id ??
      (typeof chargePi === "string" ? chargePi : chargePi?.id ?? null) ??
      (typeof refundPi === "string" ? refundPi : refundPi?.id ?? null),
    status: intent?.status ?? charge?.status ?? refund?.status ?? null,
    metadata: asRecord(intent?.metadata ?? charge?.metadata ?? refund?.metadata),
    declineCode: intent?.last_payment_error?.decline_code ?? null,
    // Charge.refunds is not expanded on API ≥ 2022-11-15; refund.* events carry the Refund object.
    refunds: refund
      ? [{ id: refund.id, amountCents: refund.amount, metadata: asRecord(refund.metadata) }]
      : [],
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

  async function retrieveIntent(paymentIntentId: string): Promise<Stripe.PaymentIntent> {
    return stripeCall(() => stripe.paymentIntents.retrieve(paymentIntentId));
  }

  return {
    name: "real",

    async ensureCustomer({ profileId, email, name }) {
      const customer = await stripeCall(() =>
        stripe.customers.create(
          { ...(email ? { email } : {}), name, metadata: { profile_id: profileId } },
          { idempotencyKey: `customer:${profileId}` },
        ),
      );
      return { customerId: customer.id };
    },

    async attachTestCard({ customerId, card }) {
      if (!options.demoMode) {
        throw new AppError("not_permitted", "Test cards are available in demo mode only.", { retryable: false });
      }
      // Unlike pm_card_visa_chargeDeclined, this test method can be attached before it declines.
      const testMethod = card === "visa" ? "pm_card_visa" : "pm_card_chargeCustomerFail";
      const method = await stripeCall(() =>
        stripe.paymentMethods.attach(testMethod, { customer: customerId }, { idempotencyKey: `test-card:${customerId}:${card}` }),
      );
      return { paymentMethodId: method.id };
    },

    async authorize(input: AuthorizeInput) {
      positiveCents(input.amountCents);
      let intent: Stripe.PaymentIntent;
      try {
        intent = await stripeCall(() =>
          stripe.paymentIntents.create(
            {
              amount: input.amountCents,
              currency: input.currency,
              customer: input.customerId,
              payment_method: input.paymentMethodId,
              metadata: input.metadata,
              capture_method: "manual",
              confirm: true,
              payment_method_types: ["card"],
            },
            { idempotencyKey: input.idempotencyKey },
          ),
        );
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
      try {
        const intent = await stripeCall(() =>
          stripe.paymentIntents.capture(paymentIntentId, { amount_to_capture: amountCents }, { idempotencyKey }),
        );
        if (intent.status !== "succeeded" || intent.amount_received !== amountCents) {
          throw new AppError("provider_unavailable", "Stripe did not confirm the requested capture.");
        }
        return { status: "captured" as const, capturedCents: intent.amount_received };
      } catch (error) {
        const cause = error instanceof AppError ? error.cause : error;
        if (!isStripeCode(cause, "payment_intent_unexpected_state")) throw error;
        const intent = await retrieveIntent(paymentIntentId);
        if (intent.status === "succeeded" && intent.amount_received === amountCents) {
          return { status: "captured", capturedCents: intent.amount_received };
        }
        throw error;
      }
    },

    async release({ paymentIntentId, idempotencyKey }) {
      try {
        const intent = await stripeCall(() => stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey }));
        if (intent.status !== "canceled") {
          throw new AppError("provider_unavailable", "Stripe did not release the hold.");
        }
        return { status: "released" as const };
      } catch (error) {
        const cause = error instanceof AppError ? error.cause : error;
        if (!isStripeCode(cause, "payment_intent_unexpected_state")) throw error;
        const intent = await retrieveIntent(paymentIntentId);
        if (intent.status === "canceled") return { status: "released" };
        throw error;
      }
    },

    async refund({ paymentIntentId, amountCents, idempotencyKey, metadata }) {
      positiveCents(amountCents);
      const refund = await stripeCall(() =>
        stripe.refunds.create({ payment_intent: paymentIntentId, amount: amountCents, metadata }, { idempotencyKey }),
      );
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

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/reliability";
import type { AuthorizeInput, PaymentsEvent, PaymentsProvider } from "./types";

/** The mock's webhook signing secret. Not a credential: it only signs events the mock itself sends. */
const MOCK_WEBHOOK_SECRET = "mock-payments-webhook-signing";
/** Stripe's default tolerance for a signature's timestamp. */
const SIGNATURE_TOLERANCE_S = 300;
const DECLINING_METHODS = new Set(["pm_mock_declined"]);

type IntentStatus = "requires_capture" | "requires_payment_method" | "succeeded" | "canceled";

interface Intent {
  status: IntentStatus;
  amountCents: number;
  capturedCents: number;
  refundedCents: number;
}

/** A short, stable ID from a seed, so every process derives the same ID for the same key. */
function mockId(prefix: string, seed: string): string {
  return `${prefix}${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

/** What Stripe calls an invalid_request_error: the request can never succeed as sent. */
function invalidRequest(message: string): AppError {
  return new AppError("invalid_input", message, { retryable: false });
}

function assertPositiveCents(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw invalidRequest("Amounts must be positive integer cents.");
}

/**
 * Signs a raw webhook body the way Stripe does (`t=<unix>,v1=<hmac>`), with the mock's secret.
 * Test kits use it to deliver events the mock provider will accept.
 */
export function signMockWebhook(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", MOCK_WEBHOOK_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

function signatureMatches(rawBody: string, header: string, nowS: number): boolean {
  const parts = new Map(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(parts.get("t"));
  const given = parts.get("v1");
  if (!Number.isInteger(timestamp) || !given || Math.abs(nowS - timestamp) > SIGNATURE_TOLERANCE_S) return false;
  const expected = Buffer.from(signMockWebhook(rawBody, timestamp).split("v1=")[1]!, "hex");
  const actual = Buffer.from(given, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const StripeLikeEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.looseObject({
      id: z.string(),
      object: z.string(),
      status: z.string().nullish(),
      payment_intent: z.string().nullish(),
    }),
  }),
});

/**
 * A deterministic, in-memory stand-in for Stripe (design §2.3). It authorizes immediately, except
 * that `pm_mock_declined` declines. It keeps Stripe's rules that the payment flows rely on:
 * - an idempotency key replays its first result, and reusing a key with other parameters fails;
 * - a capture can't exceed the authorization, and a PaymentIntent is captured at most once;
 * - refunds never exceed what was captured.
 * IDs are derived from idempotency keys, so they're the same in every process.
 */
export function createMockPaymentsProvider(options: { now?: () => number } = {}): PaymentsProvider {
  const now = options.now ?? Date.now;
  const intents = new Map<string, Intent>();
  const replies = new Map<string, { request: string; result: unknown }>();

  /** Runs `fn` once per idempotency key, like Stripe's Idempotency-Key header. */
  function once<T>(key: string, request: unknown, fn: () => T): T {
    const fingerprint = JSON.stringify(request);
    const previous = replies.get(key);
    if (previous) {
      if (previous.request !== fingerprint) {
        throw new AppError("internal", `Idempotency key ${key} was reused with different parameters.`, { retryable: false });
      }
      return previous.result as T;
    }
    const result = fn();
    replies.set(key, { request: fingerprint, result });
    return result;
  }

  function intent(paymentIntentId: string): Intent {
    const found = intents.get(paymentIntentId);
    if (!found) throw invalidRequest(`No such PaymentIntent: ${paymentIntentId}.`);
    return found;
  }

  return {
    name: "mock",

    async ensureCustomer({ profileId }) {
      return { customerId: mockId("cus_mock_", `customer:${profileId}`) };
    },

    async attachTestCard({ card }) {
      return { paymentMethodId: card === "declined" ? "pm_mock_declined" : "pm_mock_visa" };
    },

    async authorize(input: AuthorizeInput) {
      const { idempotencyKey, ...request } = input;
      return once(idempotencyKey, { op: "authorize", ...request }, () => {
        assertPositiveCents(input.amountCents);
        const paymentIntentId = mockId("pi_mock_", idempotencyKey);
        if (DECLINING_METHODS.has(input.paymentMethodId)) {
          intents.set(paymentIntentId, { status: "requires_payment_method", amountCents: input.amountCents, capturedCents: 0, refundedCents: 0 });
          return { paymentIntentId, status: "declined" as const, declineCode: "generic_decline" };
        }
        intents.set(paymentIntentId, { status: "requires_capture", amountCents: input.amountCents, capturedCents: 0, refundedCents: 0 });
        return { paymentIntentId, status: "authorized" as const };
      });
    },

    async capture({ paymentIntentId, amountCents, idempotencyKey }) {
      return once(idempotencyKey, { op: "capture", paymentIntentId, amountCents }, () => {
        assertPositiveCents(amountCents);
        const pi = intent(paymentIntentId);
        if (pi.status !== "requires_capture") {
          throw invalidRequest(`PaymentIntent ${paymentIntentId} can't be captured: its status is ${pi.status}.`);
        }
        if (amountCents > pi.amountCents) {
          throw invalidRequest(`Can't capture ${amountCents}; only ${pi.amountCents} is authorized.`);
        }
        pi.status = "succeeded";
        pi.capturedCents = amountCents;
        return { status: "captured" as const, capturedCents: amountCents };
      });
    },

    async release({ paymentIntentId, idempotencyKey }) {
      return once(idempotencyKey, { op: "release", paymentIntentId }, () => {
        const pi = intent(paymentIntentId);
        if (pi.status !== "requires_capture" && pi.status !== "requires_payment_method") {
          throw invalidRequest(`PaymentIntent ${paymentIntentId} can't be canceled: its status is ${pi.status}.`);
        }
        pi.status = "canceled";
        return { status: "released" as const };
      });
    },

    async refund({ paymentIntentId, amountCents, idempotencyKey }) {
      return once(idempotencyKey, { op: "refund", paymentIntentId, amountCents }, () => {
        assertPositiveCents(amountCents);
        const pi = intent(paymentIntentId);
        if (pi.status !== "succeeded") throw invalidRequest(`PaymentIntent ${paymentIntentId} has no captured charge to refund.`);
        if (pi.refundedCents + amountCents > pi.capturedCents) {
          throw invalidRequest(`Can't refund ${amountCents}; ${pi.capturedCents - pi.refundedCents} is left to refund.`);
        }
        pi.refundedCents += amountCents;
        return { refundId: mockId("re_mock_", idempotencyKey) };
      });
    },

    parseWebhook({ rawBody, signature }): PaymentsEvent {
      if (!signatureMatches(rawBody, signature, Math.floor(now() / 1000))) {
        throw invalidRequest("The webhook signature doesn't match its body.");
      }
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw invalidRequest("The webhook body isn't JSON.");
      }
      const parsed = StripeLikeEvent.safeParse(body);
      if (!parsed.success) throw invalidRequest("The webhook body isn't an event.");
      const { id, type, data } = parsed.data;
      const object = data.object;
      return {
        id,
        type,
        paymentIntentId: object.object === "payment_intent" ? object.id : (object.payment_intent ?? null),
        status: object.status ?? null,
      };
    },
  };
}

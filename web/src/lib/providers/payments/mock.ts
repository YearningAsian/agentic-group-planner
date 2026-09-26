import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/reliability";
import type { AuthorizeInput, PaymentsEvent, PaymentsProvider } from "./types";

/**
 * The mock's webhook signing secret. It's in the source, so it proves nothing on a deployment:
 * the mock accepts webhooks only in dev mode (`acceptWebhooks`).
 */
const MOCK_WEBHOOK_SECRET = "mock-payments-webhook-signing";
/** Stripe's default tolerance for a signature's timestamp. */
const SIGNATURE_TOLERANCE_S = 300;
const DECLINING_METHODS = new Set(["pm_mock_declined"]);

type IntentStatus = "requires_capture" | "requires_payment_method" | "succeeded" | "canceled";

interface Intent {
  id: string;
  status: IntentStatus;
  amountCents: number;
  capturedCents: number;
  refunds: { id: string; amount: number; metadata: Record<string, string> }[];
  metadata: Record<string, string>;
}

/** An event the mock sent, in Stripe's shape. */
export interface MockEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export type MockPaymentsProvider = PaymentsProvider & {
  /** Every event the mock sent about a PaymentIntent, oldest first, as Stripe would deliver them. */
  eventsFor(paymentIntentId: string): MockEvent[];
};

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

const Metadata = z.record(z.string(), z.string()).catch({});

const StripeLikeEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.looseObject({
      id: z.string(),
      object: z.string(),
      status: z.string().nullish(),
      payment_intent: z.string().nullish(),
      metadata: Metadata.optional(),
      last_payment_error: z.looseObject({ decline_code: z.string().nullish() }).nullish(),
      refunds: z
        .looseObject({
          data: z.array(z.looseObject({ id: z.string(), amount: z.number().int(), metadata: Metadata.optional() })),
        })
        .nullish(),
    }),
  }),
});

/**
 * A deterministic, in-memory stand-in for Stripe (design §2.3). It authorizes immediately, except
 * that `pm_mock_declined` declines. It keeps Stripe's rules that the payment flows rely on:
 * - an idempotency key replays its first result, and reusing a key with other parameters fails;
 * - a capture can't exceed the authorization, and a PaymentIntent is captured at most once;
 * - refunds never exceed what was captured;
 * - each real change sends one event, the same ones Stripe would, and a replay sends none.
 * IDs are derived from idempotency keys, so they're the same in every process.
 *
 * @param options.acceptWebhooks accept signed webhooks. Only dev mode sets it, because the mock's
 *   secret is public and anyone could sign with it.
 */
export function createMockPaymentsProvider(options: { now?: () => number; acceptWebhooks?: boolean } = {}): MockPaymentsProvider {
  const now = options.now ?? Date.now;
  const intents = new Map<string, Intent>();
  const replies = new Map<string, { request: string; result: unknown }>();
  const events = new Map<string, MockEvent[]>();

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

  function paymentIntentObject(pi: Intent, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: pi.id, object: "payment_intent", status: pi.status, amount: pi.amountCents, metadata: pi.metadata, ...extra };
  }

  function send(pi: Intent, type: string, object: Record<string, unknown>): void {
    const sent = events.get(pi.id) ?? [];
    sent.push({
      id: mockId("evt_mock_", `${pi.id}:${sent.length}:${type}`),
      type,
      created: Math.floor(now() / 1000),
      data: { object: structuredClone(object) },
    });
    events.set(pi.id, sent);
  }

  return {
    name: "mock",

    eventsFor(paymentIntentId) {
      return structuredClone(events.get(paymentIntentId) ?? []);
    },

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
        const pi: Intent = {
          id: mockId("pi_mock_", idempotencyKey),
          status: "requires_capture",
          amountCents: input.amountCents,
          capturedCents: 0,
          refunds: [],
          metadata: { ...input.metadata },
        };
        intents.set(pi.id, pi);
        if (DECLINING_METHODS.has(input.paymentMethodId)) {
          pi.status = "requires_payment_method";
          const declineCode = "generic_decline";
          send(pi, "payment_intent.payment_failed", paymentIntentObject(pi, { last_payment_error: { code: "card_declined", decline_code: declineCode } }));
          return { paymentIntentId: pi.id, status: "declined" as const, declineCode };
        }
        send(pi, "payment_intent.amount_capturable_updated", paymentIntentObject(pi, { amount_capturable: pi.amountCents }));
        return { paymentIntentId: pi.id, status: "authorized" as const };
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
        send(pi, "payment_intent.succeeded", paymentIntentObject(pi, { amount_received: amountCents }));
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
        send(pi, "payment_intent.canceled", paymentIntentObject(pi));
        return { status: "released" as const };
      });
    },

    async refund({ paymentIntentId, amountCents, idempotencyKey, metadata }) {
      return once(idempotencyKey, { op: "refund", paymentIntentId, amountCents, metadata }, () => {
        assertPositiveCents(amountCents);
        const pi = intent(paymentIntentId);
        if (pi.status !== "succeeded") throw invalidRequest(`PaymentIntent ${paymentIntentId} has no captured charge to refund.`);
        const refunded = pi.refunds.reduce((sum, r) => sum + r.amount, 0);
        if (refunded + amountCents > pi.capturedCents) {
          throw invalidRequest(`Can't refund ${amountCents}; ${pi.capturedCents - refunded} is left to refund.`);
        }
        const refundId = mockId("re_mock_", idempotencyKey);
        pi.refunds.push({ id: refundId, amount: amountCents, metadata: { ...metadata } });
        send(pi, "charge.refunded", {
          id: mockId("ch_mock_", pi.id),
          object: "charge",
          payment_intent: pi.id,
          status: "succeeded",
          amount_captured: pi.capturedCents,
          amount_refunded: refunded + amountCents,
          metadata: pi.metadata,
          refunds: { object: "list", data: pi.refunds },
        });
        return { refundId };
      });
    },

    parseWebhook({ rawBody, signature }): PaymentsEvent {
      if (!options.acceptWebhooks) {
        throw new AppError("not_permitted", "Mock payment webhooks are accepted in dev mode only.");
      }
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
        metadata: object.metadata ?? {},
        declineCode: object.last_payment_error?.decline_code ?? null,
        refunds: (object.refunds?.data ?? []).map((r) => ({ id: r.id, amountCents: r.amount, metadata: r.metadata ?? {} })),
      };
    },
  };
}

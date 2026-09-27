import "server-only";
import { createHash } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import { captureCheckoutGroup } from "@/features/payments/server/capture-checkout-group";
import { type CheckoutHold, openCheckoutMandate } from "@/features/payments/server";
import { quoteShares, type QuotedShare } from "@/features/trip-draft/group-share";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { STRIPE_OPTIONS, STRIPE_POLICY } from "@/lib/providers/payments";
import { withPolicy } from "@/lib/reliability/with-policy";

const mandateSchema = z.object({
  tripId: z.uuid(),
  itemId: z.uuid(),
  optionId: z.uuid(),
});

const draftSchema = z.object({
  destinationId: z.string().min(1).nullable(),
  startDate: z.string(),
  endDate: z.string(),
  members: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().max(80),
        flightId: z.string().min(1).max(200),
        stayId: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(12),
  chosenFlight: z
    .object({
      id: z.string().min(1).max(200),
      airline: z.string().max(80),
      origin: z.string().max(8),
      destination: z.string().max(8),
      departure: z.string(),
      arrival: z.string(),
      stops: z.number(),
      price: z.number().positive(),
      currency: z.string().length(3),
    })
    .nullable(),
  chosenStay: z
    .object({
      id: z.string().min(1).max(200),
      name: z.string().max(120),
      area: z.string(),
      nightlyAmount: z.number().positive().nullable(),
      currency: z.string().nullable(),
      guestScore: z.number().nullable(),
      image: z.string().nullable(),
    })
    .nullable(),
});

export type GroupCheckoutBody = z.infer<typeof mandateSchema> | z.infer<typeof draftSchema>;

export type GroupCheckoutLink = {
  memberId: string;
  name: string;
  url: string | null;
  sessionId: string | null;
  totalCents: number;
  currency: string;
  status: string;
};

export type PaidSession = {
  state: "paid" | "authorized" | "open";
  memberId: string | null;
};

export interface GroupCheckoutDeps {
  profileId: string;
  stripe?: Stripe;
  appUrl?: string;
}

function stripeClient(): Stripe {
  const secret = getServerEnv().STRIPE_SECRET_KEY;
  if (!secret) throw new AppError("provider_unavailable", "Stripe isn't configured for checkout.");
  return new Stripe(secret, STRIPE_OPTIONS);
}

/** Node rejects non-ASCII Idempotency-Key bytes. Flight labels include "·" and "→". */
function draftIdempotencyKey(share: QuotedShare): string {
  const raw = `group-hold:v4:${share.memberId}:${share.totalCents}:${share.flightLabel}:${share.stayLabel}`;
  return raw.replace(/[^\t\x20-\x7E]/g, "-").slice(0, 255);
}

/** Same quote must send the same Checkout parameters, or Stripe rejects the idempotency key. */
function stableGroupKey(shares: QuotedShare[]): string {
  const raw = shares
    .map((share) => `${share.memberId}:${share.totalCents}:${share.flightLabel}:${share.stayLabel}`)
    .sort()
    .join("|");
  return createHash("sha256").update(raw).digest("hex");
}

function integrationIdentifier(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `group-buy-${suffix}`;
}

async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await withPolicy(() => call(), STRIPE_POLICY);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as { type?: unknown } | null)?.type === "StripeInvalidRequestError") {
      throw new AppError("invalid_input", "Stripe rejected the payment request.", { retryable: false, cause: error });
    }
    throw new AppError("provider_unavailable", "Stripe could not start checkout. Try again.", { cause: error });
  }
}

export async function createGroupCheckout(
  raw: unknown,
  deps: GroupCheckoutDeps,
): Promise<{ mandateId: string | null; links: GroupCheckoutLink[]; totalCents: number; currency: string }> {
  const mandate = mandateSchema.safeParse(raw);
  if (mandate.success) {
    return createMandateCheckout(mandate.data, deps);
  }
  const draft = draftSchema.safeParse(raw);
  if (!draft.success) throw new AppError("invalid_input", "That checkout request is missing a traveler or a pick.");
  return createDraftCheckout(draft.data, deps);
}

async function createMandateCheckout(
  input: z.infer<typeof mandateSchema>,
  deps: GroupCheckoutDeps,
): Promise<{ mandateId: string | null; links: GroupCheckoutLink[]; totalCents: number; currency: string }> {
  const { tripId, itemId, optionId } = input;
  const purchase = await openCheckoutMandate({ tripId, itemId, optionId, profileId: deps.profileId });
  const stripe = deps.stripe ?? stripeClient();
  const appUrl = (deps.appUrl ?? getServerEnv().NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  const integration = integrationIdentifier();
  const links = await Promise.all(
    purchase.holds.map((hold) => openSession(stripe, purchase.mandateId, purchase.tripId, hold, purchase.currency, appUrl, integration)),
  );
  return {
    mandateId: purchase.mandateId,
    links,
    totalCents: links.reduce((sum, link) => sum + link.totalCents, 0),
    currency: purchase.currency,
  };
}

async function createDraftCheckout(
  input: z.infer<typeof draftSchema>,
  deps: GroupCheckoutDeps,
): Promise<{ mandateId: null; links: GroupCheckoutLink[]; totalCents: number; currency: string }> {
  const quote = quoteShares(input);
  if (!quote.ok) throw new AppError("invalid_input", quote.message);
  const stripe = deps.stripe ?? stripeClient();
  const appUrl = (deps.appUrl ?? getServerEnv().NEXT_PUBLIC_APP_URL).replace(/\/$/, "");
  const groupKey = stableGroupKey(quote.shares);
  const groupId = groupKey.slice(0, 32);
  const integration = `group-buy-${groupKey.slice(32, 40)}`;
  const created = await Promise.all(
    quote.shares.map((share) =>
      openDraftSession(stripe, groupId, quote.shares.length, share, appUrl, integration),
    ),
  );
  const peerSessionIds = created.map((session) => session.id).join(",");
  await Promise.all(
    created.map((session) =>
      stripeCall(() =>
        stripe.checkout.sessions.update(session.id, {
          metadata: {
            member_id: session.metadata?.member_id ?? "",
            group_id: groupId,
            peer_session_ids: peerSessionIds,
          },
        }),
      ),
    ),
  );
  return {
    mandateId: null,
    currency: quote.currency,
    totalCents: quote.totalCents,
    links: created.map((session, index) => {
      const share = quote.shares[index]!;
      if (!session.url) throw new AppError("provider_unavailable", "Stripe did not return a checkout link.");
      return {
        memberId: share.memberId,
        name: share.name,
        url: session.url,
        sessionId: session.id,
        totalCents: share.totalCents,
        currency: quote.currency,
        status: "pending",
      };
    }),
  };
}

async function openDraftSession(
  stripe: Stripe,
  groupId: string,
  groupSize: number,
  share: QuotedShare,
  appUrl: string,
  integrationIdentifier: string,
): Promise<Stripe.Checkout.Session> {
  const idempotencyKey = draftIdempotencyKey(share);
  return stripeCall(() =>
    stripe.checkout.sessions.create(
      {
        mode: "payment",
        managed_payments: { enabled: false },
        client_reference_id: share.memberId,
        integration_identifier: integrationIdentifier,
        branding_settings: { display_name: "CoTravel" },
        success_url: `${appUrl}/current?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/current`,
        metadata: { member_id: share.memberId, group_id: groupId },
        payment_intent_data: {
          capture_method: "manual",
          metadata: {
            group_id: groupId,
            member_id: share.memberId,
            group_size: String(groupSize),
          },
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: share.currency.toLowerCase(),
              unit_amount: share.flightCents,
              product_data: { name: share.flightLabel },
            },
          },
          {
            quantity: 1,
            price_data: {
              currency: share.currency.toLowerCase(),
              unit_amount: share.stayCents,
              product_data: { name: share.stayLabel },
            },
          },
        ],
      },
      { idempotencyKey },
    ),
  );
}

async function openSession(
  stripe: Stripe,
  mandateId: string,
  tripId: string,
  hold: CheckoutHold,
  currency: string,
  appUrl: string,
  integrationIdentifier: string,
): Promise<GroupCheckoutLink> {
  if (hold.status !== "pending") {
    return { memberId: hold.memberId, name: hold.name, url: null, sessionId: null, totalCents: hold.capCents, currency, status: hold.status };
  }
  const idempotencyKey = `group-checkout:${mandateId}:${hold.memberId}`.slice(0, 255);
  const session = await stripeCall(() =>
    stripe.checkout.sessions.create(
      {
        mode: "payment",
        // This account turns on Managed Payments by default, which rejects a session without a product tax code.
        managed_payments: { enabled: false },
        client_reference_id: hold.memberId,
        integration_identifier: integrationIdentifier,
        branding_settings: { display_name: "CoTravel" },
        success_url: `${appUrl}/current?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/current`,
        metadata: {
          member_id: hold.memberId,
          mandate_id: mandateId,
          trip_id: tripId,
        },
        payment_intent_data: {
          capture_method: "manual",
          metadata: {
            trip_id: tripId,
            mandate_id: mandateId,
            payer_member_id: hold.memberId,
            share_member_id: hold.memberId,
          },
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: hold.capCents,
              product_data: { name: `${hold.name}'s share` },
            },
          },
        ],
      },
      { idempotencyKey },
    ),
  );
  if (!session.url) throw new AppError("provider_unavailable", "Stripe did not return a checkout link.");
  return {
    memberId: hold.memberId,
    name: hold.name,
    url: session.url,
    sessionId: session.id,
    totalCents: hold.capCents,
    currency,
    status: "pending",
  };
}

/** Captures a draft group's held cards once every traveler has authorized. */
export async function captureHeldGroup(sessionId: string, deps: { stripe?: Stripe } = {}): Promise<"captured" | "waiting"> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("invalid_input", "That checkout session is invalid.");
  const stripe = deps.stripe ?? stripeClient();
  const session = await stripeCall(() => stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }));
  const paymentIntent = session.payment_intent;
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (!paymentIntentId) return "waiting";
  return captureCheckoutGroup(paymentIntentId, stripe);
}

export async function readPaidSession(sessionId: string, deps: { stripe?: Stripe } = {}): Promise<PaidSession> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("invalid_input", "That checkout session is invalid.");
  const stripe = deps.stripe ?? stripeClient();
  const session = await stripeCall(() => stripe.checkout.sessions.retrieve(sessionId));
  const memberId = session.metadata?.member_id ?? session.client_reference_id ?? null;
  if (session.payment_status === "paid") return { state: "paid", memberId };
  const paymentIntent = session.payment_intent;
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id;
  if (session.status === "complete" && paymentIntentId) {
    const intent =
      paymentIntent && typeof paymentIntent === "object"
        ? paymentIntent
        : await stripeCall(() => stripe.paymentIntents.retrieve(paymentIntentId));
    if (intent.status === "requires_capture") return { state: "authorized", memberId };
  }
  return { state: "open", memberId };
}

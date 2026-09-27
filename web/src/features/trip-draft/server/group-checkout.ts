import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import { quoteShares, type QuotedShare } from "@/features/trip-draft/group-share";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { STRIPE_OPTIONS, STRIPE_POLICY } from "@/lib/providers/payments/stripe-config";
import { withPolicy } from "@/lib/reliability/with-policy";

const memberSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().max(80),
  flightId: z.string().min(1).max(200),
  stayId: z.string().min(1).max(200),
});

const bodySchema = z.object({
  destinationId: z.string().min(1).nullable(),
  startDate: z.string(),
  endDate: z.string(),
  members: z.array(memberSchema).min(1).max(12),
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

export type GroupCheckoutBody = z.infer<typeof bodySchema>;

export type GroupCheckoutLink = {
  memberId: string;
  name: string;
  url: string;
  totalCents: number;
  currency: string;
};

function stripeClient(): Stripe {
  const secret = getServerEnv().STRIPE_SECRET_KEY;
  if (!secret) throw new AppError("provider_unavailable", "Stripe isn't configured for checkout.");
  return new Stripe(secret, STRIPE_OPTIONS);
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

export async function createGroupCheckout(raw: unknown): Promise<{
  links: GroupCheckoutLink[];
  totalCents: number;
  currency: string;
}> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) throw new AppError("invalid_input", "That checkout request is missing a traveler or a pick.");
  const body = parsed.data;
  const quote = quoteShares(body);
  if (!quote.ok) throw new AppError("invalid_input", quote.message);

  const stripe = stripeClient();
  const appUrl = getServerEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const integration = integrationIdentifier();
  const links = await Promise.all(
    quote.shares.map((share) => {
      const member = body.members.find((item) => item.id === share.memberId);
      if (!member) throw new AppError("invalid_input", "That checkout request is missing a traveler or a pick.");
      return openSession(stripe, share, member, appUrl, integration, body.destinationId);
    }),
  );
  return { links, totalCents: quote.totalCents, currency: quote.currency };
}

async function openSession(
  stripe: Stripe,
  share: QuotedShare,
  member: { flightId: string; stayId: string },
  appUrl: string,
  integrationIdentifier: string,
  destinationId: string | null,
): Promise<GroupCheckoutLink> {
  const idempotencyKey = `group-checkout:${share.memberId}:${member.flightId}:${member.stayId}:${share.totalCents}`.slice(0, 255);
  const session = await stripeCall(() =>
    stripe.checkout.sessions.create(
      {
        mode: "payment",
        // This account turns on Managed Payments by default, which rejects a session without a product tax code.
        managed_payments: { enabled: false },
        client_reference_id: share.memberId,
        integration_identifier: integrationIdentifier,
        branding_settings: { display_name: "CoTravel" },
        success_url: `${appUrl}/current?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/current`,
        metadata: {
          member_id: share.memberId,
          destination_id: destinationId ?? "",
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
  if (!session.url) throw new AppError("provider_unavailable", "Stripe did not return a checkout link.");
  return {
    memberId: share.memberId,
    name: share.name,
    url: session.url,
    totalCents: share.totalCents,
    currency: share.currency,
  };
}

export async function readPaidSession(sessionId: string): Promise<{ paid: boolean; memberId: string | null }> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("invalid_input", "That checkout session is invalid.");
  const stripe = stripeClient();
  const session = await stripeCall(() => stripe.checkout.sessions.retrieve(sessionId));
  const memberId = session.metadata?.member_id ?? session.client_reference_id ?? null;
  return { paid: session.payment_status === "paid", memberId };
}

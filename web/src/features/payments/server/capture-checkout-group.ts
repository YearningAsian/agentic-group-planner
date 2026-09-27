import "server-only";
import Stripe from "stripe";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability";
import { STRIPE_OPTIONS, STRIPE_POLICY } from "@/lib/providers/payments";
import { withPolicy } from "@/lib/reliability/with-policy";

export type GroupCaptureResult = "captured" | "waiting";

function stripeClient(): Stripe {
  const secret = getServerEnv().STRIPE_SECRET_KEY;
  if (!secret) throw new AppError("provider_unavailable", "Stripe isn't configured for checkout.");
  return new Stripe(secret, STRIPE_OPTIONS);
}

async function stripeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await withPolicy(() => call(), STRIPE_POLICY);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("provider_unavailable", "Stripe could not capture the group. Try again.", { cause: error });
  }
}

function intentOf(session: Stripe.Checkout.Session): Stripe.PaymentIntent | null {
  const paymentIntent = session.payment_intent;
  return paymentIntent && typeof paymentIntent === "object" ? paymentIntent : null;
}

/**
 * Captures every hold in a draft group only after each Checkout Session is authorized.
 * One person paying leaves the others uncaptured.
 */
export async function captureCheckoutGroup(paymentIntentId: string, stripe: Stripe = stripeClient()): Promise<GroupCaptureResult> {
  const listed = await stripeCall(() => stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }));
  const current = listed.data[0];
  const peerIds = current?.metadata?.peer_session_ids?.split(",").filter(Boolean) ?? [];
  const groupId = current?.metadata?.group_id;
  if (!current || !groupId || peerIds.length === 0) return "waiting";

  const peers = await Promise.all(
    peerIds.map((id) => stripeCall(() => stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent"] }))),
  );
  const intents = peers.map(intentOf);
  if (intents.some((intent) => !intent) || peers.some((session) => session.status !== "complete")) return "waiting";
  const ready = intents.filter((intent): intent is Stripe.PaymentIntent => !!intent);
  if (ready.some((intent) => intent.capture_method !== "manual")) return "waiting";
  if (ready.some((intent) => intent.status !== "requires_capture" && intent.status !== "succeeded")) return "waiting";

  for (const intent of ready) {
    if (intent.status === "succeeded") continue;
    await stripeCall(() =>
      stripe.paymentIntents.capture(intent.id, {}, { idempotencyKey: `group-capture:${groupId}:${intent.id}`.slice(0, 255) }),
    );
  }
  return "captured";
}

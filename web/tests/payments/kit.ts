/**
 * One interface for every payments suite, over the mock provider now and Stripe test mode in
 * CO-305. A suite only talks to the provider through this kit and the app's own code, so the same
 * suite runs under `test:db` (mock) and `test:stripe` (real).
 */
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { createMandate, onPlaceholderClaimed } from "@/features/payments/server";
import { getServerEnv } from "@/lib/env/server";
import type { BookingProvider } from "@/lib/providers/booking";
import { getPaymentsProvider, type PaymentsProvider } from "@/lib/providers/payments";
import { type MockPaymentsProvider, signMockWebhook } from "@/lib/providers/payments/mock";
import { STRIPE_OPTIONS } from "@/lib/providers/payments/real";
import { getAdminClient } from "@/lib/supabase/admin";
import { adminClient, createPlace, createTrip, createUser, type TestUser } from "../db/helpers";

/** An event as the provider sends it (Stripe's shape). */
export interface ProviderEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type TestCard = "visa" | "declined";

export interface PaymentsKit {
  readonly provider: "mock" | "real";
  /** A signed-in user whose profile has a customer and a saved test card. */
  createPayer(batch: string, displayName: string, card?: TestCard): Promise<TestUser>;
  /** Replaces a payer's saved card, e.g. to make their next authorization decline. */
  setCard(profileId: string, card: TestCard): Promise<void>;
  /** Every event the provider sent about a PaymentIntent, oldest first. */
  eventsFor(paymentIntentId: string, expectedTypes?: string[]): Promise<ProviderEvent[]>;
  /** Delivers an event to `POST /api/webhooks/stripe`, signed the way the provider signs it. */
  deliver(event: ProviderEvent): Promise<Response>;
  /** Delivers any body with any signature, for signature tests. */
  deliverRaw(rawBody: string, signature: string): Promise<Response>;
  /** Direct Stripe-side evidence; absent on the mock kit. */
  stripe?: {
    intentsFor(profileId: string, mandateId: string): Promise<{ id: string; amountReceivedCents: number }[]>;
    refundsFor(paymentIntentId: string): Promise<{ id: string; amountCents: number }[]>;
  };
}

function post(rawBody: string, signature: string): Promise<Response> {
  return stripeWebhook(
    new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: rawBody,
      headers: { "content-type": "application/json", "stripe-signature": signature },
    }),
  );
}

interface StripeKitOptions {
  provider: PaymentsProvider;
  stripe: Stripe;
  webhookSecret: string;
  createUser: typeof createUser;
  readProfile(profileId: string): Promise<{ customerId: string | null; displayName: string }>;
  saveCard(profileId: string, customerId: string, paymentMethodId: string): Promise<void>;
  post: typeof post;
  eventWaitMs?: number;
}

function referencesIntent(event: Stripe.Event, paymentIntentId: string): boolean {
  const object = event.data.object as unknown as Record<string, unknown>;
  const reference = object.object === "payment_intent" ? object.id : object.payment_intent;
  return (typeof reference === "string" ? reference : (reference as { id?: unknown } | null)?.id) === paymentIntentId;
}

/** A Stripe test-mode kit with external calls injected for database-free contract tests. */
export function createStripePaymentsKit(options: StripeKitOptions): PaymentsKit {
  const { provider, stripe, webhookSecret } = options;

  const setCard = async (profileId: string, card: TestCard) => {
    const profile = await options.readProfile(profileId);
    const customerId = profile.customerId ?? (await provider.ensureCustomer({ profileId, name: profile.displayName })).customerId;
    const { paymentMethodId } = await provider.attachTestCard({ customerId, card });
    await options.saveCard(profileId, customerId, paymentMethodId);
  };

  return {
    provider: "real",
    async createPayer(batch, displayName, card = "visa") {
      const user = await options.createUser({ batch, displayName });
      await setCard(user.userId, card);
      return user;
    },
    setCard,
    async eventsFor(paymentIntentId, expectedTypes = []) {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const eventByStatus: Record<string, string | undefined> = {
        requires_capture: "payment_intent.amount_capturable_updated",
        requires_payment_method: "payment_intent.payment_failed",
        succeeded: "payment_intent.succeeded",
        canceled: "payment_intent.canceled",
      };
      const currentEvent = eventByStatus[intent.status];
      const expected = new Set([...(currentEvent ? [currentEvent] : []), ...expectedTypes]);
      const deadline = Date.now() + (options.eventWaitMs ?? 10_000);
      while (true) {
        const events: ProviderEvent[] = [];
        // The Events API is account-wide and newest first; scan all pages in the test's time window.
        for await (const event of stripe.events.list({ created: { gte: intent.created }, limit: 100 })) {
          if (referencesIntent(event, paymentIntentId)) events.push(event as unknown as ProviderEvent);
        }
        if ([...expected].every((type) => events.some((event) => event.type === type))) return events.reverse();
        if (Date.now() >= deadline) {
          throw new Error(`Stripe did not list ${[...expected].join(", ")} for ${paymentIntentId} before the test timeout.`);
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
      }
    },
    deliver(event) {
      const raw = JSON.stringify(event);
      const signature = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: webhookSecret });
      return options.post(raw, signature);
    },
    deliverRaw: options.post,
    stripe: {
      async intentsFor(profileId, mandateId) {
        const { customerId } = await options.readProfile(profileId);
        if (!customerId) throw new Error(`Profile ${profileId} has no Stripe customer to inspect.`);
        const intents: { id: string; amountReceivedCents: number }[] = [];
        for await (const intent of stripe.paymentIntents.list({ customer: customerId, limit: 100 })) {
          if (intent.metadata.mandate_id === mandateId) {
            intents.push({ id: intent.id, amountReceivedCents: intent.amount_received });
          }
        }
        return intents;
      },
      async refundsFor(paymentIntentId) {
        const refunds: { id: string; amountCents: number }[] = [];
        for await (const refund of stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 })) {
          refunds.push({ id: refund.id, amountCents: refund.amount });
        }
        return refunds;
      },
    },
  };
}

/** The kit for the provider `PAYMENTS_PROVIDER` selects. */
export function paymentsKit(): PaymentsKit {
  const provider = getPaymentsProvider();
  if (provider.name === "real") {
    const env = getServerEnv();
    const admin = adminClient();
    return createStripePaymentsKit({
      provider,
      stripe: new Stripe(env.STRIPE_SECRET_KEY!, STRIPE_OPTIONS),
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
      createUser,
      async readProfile(profileId) {
        const { data, error } = await admin.from("profiles").select("stripe_customer_id, display_name").eq("id", profileId).single();
        if (error) throw error;
        return { customerId: data.stripe_customer_id, displayName: data.display_name };
      },
      async saveCard(profileId, customerId, paymentMethodId) {
        const { error } = await admin
          .from("profiles")
          .update({ stripe_customer_id: customerId, default_payment_method_id: paymentMethodId })
          .eq("id", profileId);
        if (error) throw error;
      },
      post,
    });
  }
  const mock = provider as MockPaymentsProvider;
  const admin = adminClient();

  const setCard = async (profileId: string, card: TestCard) => {
    const { customerId } = await mock.ensureCustomer({ profileId, name: profileId });
    const { paymentMethodId } = await mock.attachTestCard({ customerId, card });
    const { error } = await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId, default_payment_method_id: paymentMethodId })
      .eq("id", profileId);
    if (error) throw error;
  };

  return {
    provider: "mock",
    async createPayer(batch, displayName, card = "visa") {
      const user = await createUser({ batch, displayName });
      await setCard(user.userId, card);
      return user;
    },
    setCard,
    async eventsFor(paymentIntentId) {
      return mock.eventsFor(paymentIntentId) as ProviderEvent[];
    },
    deliver(event) {
      const raw = JSON.stringify(event);
      return post(raw, signMockWebhook(raw));
    },
    deliverRaw: post,
  };
}

export interface MandateScenario {
  tripId: string;
  itemId: string;
  optionId: string;
  runId: string;
  mandateId: string;
  /** Person 1 (organizer) to Person 4 (placeholder), by member ID. */
  person: [string, string, string, string];
}

/**
 * The seeded purchase (design §4.2): four $42 tickets for a decided item, Persons 1–3 joined
 * with saved cards, Person 4 a placeholder that Person 1 fronts, and an open mandate from a
 * propose_purchase call that Person 2 made.
 */
export async function mandateScenario(batch: string, payers: [TestUser, TestUser, TestUser]): Promise<MandateScenario> {
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: payers[0].userId },
      { displayName: "Person 2", profileId: payers[1].userId },
      { displayName: "Person 3", profileId: payers[2].userId },
      { displayName: "Person 4", inviteToken: `invite-${randomUUID()}` },
    ],
  });
  return addMandate(batch, { tripId, person: memberIds as MandateScenario["person"] });
}

/** Another decided $42 item on the same trip, everyone attending, with its own open mandate. */
export async function addMandate(
  batch: string,
  trip: { tripId: string; person: MandateScenario["person"] },
  slot: { key: string; startsAt: string; endsAt: string } = { key: "morning", startsAt: "2026-09-26T14:00:00Z", endsAt: "2026-09-26T16:30:00Z" },
  category: "activity" | "lodging" = "activity",
  booking?: BookingProvider,
): Promise<MandateScenario> {
  const admin = adminClient();
  const { tripId } = trip;
  const memberIds = trip.person;
  const { placeId } = await createPlace(batch, { name: category === "lodging" ? "Midtown Inn" : "Georgia Aquarium" });
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert({ seed_batch: batch, ...row }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const itemId = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: slot.key,
    label: slot.key,
    category,
    starts_at: slot.startsAt,
    ends_at: slot.endsAt,
    position: 1,
    status: "voting",
  });
  const optionId = await insert("item_options", {
    trip_id: tripId,
    item_id: itemId,
    place_id: placeId,
    rank: 1,
    price_cents: 4200,
    score: 0.8,
    score_breakdown: {},
    source: "mock",
  });
  const decided = await admin.from("itinerary_items").update({ status: "decided", chosen_option_id: optionId }).eq("id", itemId);
  if (decided.error) throw decided.error;
  const attending = await admin
    .from("item_attendees")
    .insert(memberIds.map((member_id) => ({ item_id: itemId, member_id, trip_id: tripId, seed_batch: batch })));
  if (attending.error) throw attending.error;
  const runId = await insert("agent_runs", {
    trip_id: tripId,
    trigger: "mention",
    requester_member_id: memberIds[1],
    // Finished: a trip has one running run at a time, and a trip here may hold several mandates.
    status: "succeeded",
    finished_at: new Date().toISOString(),
    provider: "mock",
    model: "muse-spark-1.3",
  });
  const toolCallId = `call_${randomUUID()}`;
  await insert("tool_calls", {
    trip_id: tripId,
    run_id: runId,
    tool_call_id: toolCallId,
    tool_name: "propose_purchase",
    input: { item_handle: "I1" },
    status: "started",
  });
  const { mandateId } = await createMandate({
    ctx: { tripId, runId, toolCallId, actorMemberId: memberIds[1]!, admin: getAdminClient() },
    itemId,
    optionId,
    idempotencyKey: `mandate:${runId}:${toolCallId}`,
    ...(booking ? { booking } : {}),
  });
  return { tripId, itemId, optionId, runId, mandateId, person: memberIds };
}

/**
 * Person 4 claims their lane as `user`, the way an invite claim does: the member joins, then the
 * claim hands their `awaiting_member` share rows to them (`onPlaceholderClaimed`).
 */
export async function claimPlaceholder(s: Pick<MandateScenario, "person">, user: TestUser): Promise<{ pendingMandateIds: string[] }> {
  const person4 = s.person[3];
  const joined = await adminClient()
    .from("trip_members")
    .update({ profile_id: user.userId, status: "joined", claimed_at: new Date().toISOString(), invite_token: null })
    .eq("id", person4);
  if (joined.error) throw joined.error;
  return onPlaceholderClaimed(person4);
}

/** The mandate's share rows, keyed `${share member}:${kind}`. */
export async function shareRows(mandateId: string) {
  const { data, error } = await adminClient().from("payment_holds").select("*").eq("mandate_id", mandateId);
  if (error) throw error;
  type Row = {
    id: string;
    payer_member_id: string | null;
    share_member_id: string;
    kind: "own" | "fronted";
    status: string;
    stripe_payment_intent_id: string | null;
    cap_cents: number;
    captured_cents: number | null;
    refunded_cents: number | null;
    pays_share: boolean | null;
    decline_code: string | null;
    authorized_at: string | null;
    lease_expires_at: string | null;
    updated_at: string;
  };
  return new Map((data as Row[]).map((row) => [`${row.share_member_id}:${row.kind}`, row]));
}

export async function mandateRow(mandateId: string) {
  const { data, error } = await adminClient().from("mandates").select("*").eq("id", mandateId).single();
  if (error) throw error;
  return data as { status: string; final_cents: number | null; cancel_reason: string | null; trip_id: string };
}

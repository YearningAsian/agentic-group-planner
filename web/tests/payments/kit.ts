/**
 * One interface for every payments suite, over the mock provider now and Stripe test mode in
 * CO-305. A suite only talks to the provider through this kit and the app's own code, so the same
 * suite runs under `test:db` (mock) and `test:stripe` (real).
 */
import { randomUUID } from "node:crypto";
import { POST as stripeWebhook } from "@/app/api/webhooks/stripe/route";
import { createMandate } from "@/features/payments/server";
import { NotBuiltError } from "@/lib/not-built";
import { getPaymentsProvider } from "@/lib/providers/payments";
import { type MockPaymentsProvider, signMockWebhook } from "@/lib/providers/payments/mock";
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
  eventsFor(paymentIntentId: string): Promise<ProviderEvent[]>;
  /** Delivers an event to `POST /api/webhooks/stripe`, signed the way the provider signs it. */
  deliver(event: ProviderEvent): Promise<Response>;
  /** Delivers any body with any signature, for signature tests. */
  deliverRaw(rawBody: string, signature: string): Promise<Response>;
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

/** The kit for the provider `PAYMENTS_PROVIDER` selects. */
export function paymentsKit(): PaymentsKit {
  const provider = getPaymentsProvider();
  if (provider.name !== "mock") throw new NotBuiltError("The Stripe test-mode branch of the payments kit (CO-305)");
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
  const admin = adminClient();
  const { tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: payers[0].userId },
      { displayName: "Person 2", profileId: payers[1].userId },
      { displayName: "Person 3", profileId: payers[2].userId },
      { displayName: "Person 4", inviteToken: `invite-${randomUUID()}` },
    ],
  });
  const { placeId } = await createPlace(batch, { name: "Georgia Aquarium" });
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert({ seed_batch: batch, ...row }).select("id").single();
    if (error) throw error;
    return data.id as string;
  };
  const itemId = await insert("itinerary_items", {
    trip_id: tripId,
    slot_key: "morning",
    label: "Morning",
    category: "activity",
    starts_at: "2026-09-26T14:00:00Z",
    ends_at: "2026-09-26T16:30:00Z",
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
    status: "running",
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
  });
  return { tripId, itemId, optionId, runId, mandateId, person: memberIds as MandateScenario["person"] };
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
    updated_at: string;
  };
  return new Map((data as Row[]).map((row) => [`${row.share_member_id}:${row.kind}`, row]));
}

export async function mandateRow(mandateId: string) {
  const { data, error } = await adminClient().from("mandates").select("*").eq("id", mandateId).single();
  if (error) throw error;
  return data as { status: string; final_cents: number | null; cancel_reason: string | null; trip_id: string };
}

import "server-only";
import type { WebhookProvider } from "@agp/shared";
import type { Json } from "@agp/shared/db";
import { getAdminClient } from "@/lib/supabase/admin";
import { AppError } from "./app-error";

/** How long a running attempt owns its event before a provider retry may take it over. */
const ATTEMPT_LEASE_MS = 30_000;
const MAX_ERROR_LENGTH = 1_000;

/** `process`: this delivery owns the event and should handle it. `skip`: acknowledge and drop it. */
export type WebhookDecision = "process" | "skip";

export interface WebhookDelivery {
  provider: WebhookProvider;
  eventId: string;
  type: string;
  /** Trimmed by the caller: identifiers and statuses only, never card data. */
  payload: Json | null;
}

function dbError(error: unknown): AppError {
  // The provider retries on a 5xx, so a ledger outage is transient by definition.
  return new AppError("internal", "Couldn't record the webhook.", { retryable: true, cause: error });
}

/**
 * Records a webhook before anything handles it (design §7.2), so each event is processed by one
 * delivery at a time and never again once finished:
 * - a new event is inserted and returns `process`;
 * - a `processed` or `ignored` event returns `skip`;
 * - a `failed` event whose failure is recorded returns `process` at once: nothing is running, and
 *   the provider's retry right after our 500 must be processed, not dropped;
 * - a running attempt (a `received` event, or a `failed` one being retried) returns `skip` while
 *   it was touched within 30 s, and `process` after that, in case it crashed.
 * Taking an event increments `attempts` with a compare-and-set, so of several simultaneous
 * deliveries exactly one gets `process`.
 */
export async function recordWebhook(delivery: WebhookDelivery): Promise<WebhookDecision> {
  const admin = getAdminClient();
  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .upsert(
      {
        provider: delivery.provider,
        event_id: delivery.eventId,
        type: delivery.type,
        payload: delivery.payload,
        received_at: new Date().toISOString(),
      },
      { onConflict: "provider,event_id", ignoreDuplicates: true },
    )
    .select("event_id");
  if (insertError) throw dbError(insertError);
  if (inserted.length > 0) return "process";

  const { data: existing, error: readError } = await admin
    .from("webhook_events")
    .select("status, attempts, updated_at, error")
    .eq("provider", delivery.provider)
    .eq("event_id", delivery.eventId)
    .single();
  if (readError) throw dbError(readError);
  if (existing.status !== "received" && existing.status !== "failed") return "skip";

  // finishWebhook always stores an error with a failure, and taking a failed event clears it, so a
  // failed row with no error is a retry in progress. There's no failed -> received transition.
  const failureRecorded = existing.status === "failed" && existing.error !== null;
  const cutoff = new Date(Date.now() - ATTEMPT_LEASE_MS).toISOString();
  if (!failureRecorded && Date.parse(existing.updated_at) >= Date.parse(cutoff)) return "skip";

  let claim = admin
    .from("webhook_events")
    .update({ attempts: existing.attempts + 1, error: null })
    .eq("provider", delivery.provider)
    .eq("event_id", delivery.eventId)
    .eq("attempts", existing.attempts)
    .eq("status", existing.status);
  claim = failureRecorded ? claim.not("error", "is", null) : claim.lt("updated_at", cutoff);
  const { data: claimed, error: claimError } = await claim.select("event_id");
  if (claimError) throw dbError(claimError);
  return claimed.length > 0 ? "process" : "skip";
}

/**
 * Marks an event finished (`processed` or `ignored`) or `failed`, so the provider's retry
 * processes it again. A failure always keeps an error message, which is how `recordWebhook` tells
 * a recorded failure from a running retry. Only an unfinished event changes; finishing twice is a
 * no-op.
 */
export async function finishWebhook(
  provider: WebhookProvider,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
): Promise<void> {
  const message = status === "failed" ? error?.slice(0, MAX_ERROR_LENGTH) || "The event failed." : null;
  const { error: updateError } = await getAdminClient()
    .from("webhook_events")
    .update({ status, error: message, processed_at: status === "failed" ? null : new Date().toISOString() })
    .eq("provider", provider)
    .eq("event_id", eventId)
    .in("status", ["received", "failed"]);
  if (updateError) throw dbError(updateError);
}

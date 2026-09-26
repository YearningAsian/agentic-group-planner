import "server-only";
import { AppError } from "@/lib/reliability";
import type { AdminClient } from "@/lib/supabase/admin";
import { failRun } from "./finish";

/** A queued run that hasn't started within 5 minutes is no longer what anyone is waiting for (design §4.4). */
export const STALE_QUEUED_MS = 5 * 60_000;

const RUN_COLUMNS = "id, trip_id, requester_member_id, trigger_message_id";

/**
 * Fails the trip's runs that can't finish: a running run whose lease has lapsed (its process died),
 * and a queued run older than 5 minutes. Each gets an error card with Try again, so members see
 * why nothing happened. Racing sweepers are harmless: `finish_agent_run` ends a run once.
 */
export async function sweepTrip(admin: AdminClient, tripId: string, now = Date.now()): Promise<void> {
  const [expired, stale] = await Promise.all([
    admin
      .from("agent_runs")
      .select(RUN_COLUMNS)
      .eq("trip_id", tripId)
      .eq("status", "running")
      .lt("lease_expires_at", new Date(now).toISOString()),
    admin
      .from("agent_runs")
      .select(RUN_COLUMNS)
      .eq("trip_id", tripId)
      .eq("status", "queued")
      .lt("created_at", new Date(now - STALE_QUEUED_MS).toISOString()),
  ]);
  if (expired.error || stale.error) {
    throw new AppError("internal", "Couldn't check the trip's agent runs.", { retryable: true, cause: expired.error ?? stale.error });
  }
  for (const run of expired.data) {
    await failRun(admin, run, { code: "timeout", message: "The agent stopped before it finished. Try again.", retryable: true });
  }
  for (const run of stale.data) {
    await failRun(admin, run, { code: "timeout", message: "This request waited too long to start. Try again.", retryable: true });
  }
}

/** The trip's oldest queued run, which starts when the running one finishes. */
export async function nextQueuedRun(admin: AdminClient, tripId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("agent_runs")
    .select("id")
    .eq("trip_id", tripId)
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read the trip's queue.", { retryable: true, cause: error });
  return data?.id ?? null;
}

import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { finishWebhook, recordWebhook } from "@/lib/reliability";
import { adminClient, cleanup, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient();
// webhook_events has no trip, so this file's events share a prefix that cleanup can find.
const prefix = `evt_${batch.replace(/\W/g, "_")}_`;

function eventId(): string {
  return `${prefix}${randomUUID()}`;
}

function delivery(id: string) {
  return {
    provider: "stripe" as const,
    eventId: id,
    type: "payment_intent.amount_capturable_updated",
    payload: { payment_intent: "pi_mock_abc", status: "requires_capture" },
  };
}

async function row(id: string) {
  const { data, error } = await admin.from("webhook_events").select("*").eq("provider", "stripe").eq("event_id", id).single();
  if (error) throw error;
  return data as { status: string; attempts: number; error: string | null; processed_at: string | null; payload: unknown };
}

/** An event whose last attempt started `ageMs` ago; the updated_at trigger only runs on update. */
async function insertStale(id: string, status: "received" | "failed" | "processed", ageMs = 40_000): Promise<void> {
  const touched = new Date(Date.now() - ageMs).toISOString();
  const { error } = await admin.from("webhook_events").insert({
    provider: "stripe",
    event_id: id,
    type: "payment_intent.succeeded",
    status,
    received_at: touched,
    created_at: touched,
    updated_at: touched,
    seed_batch: batch,
  });
  if (error) throw error;
}

afterAll(async () => {
  await admin.from("webhook_events").delete().like("event_id", `${prefix}%`);
  await cleanup(batch);
});

describe("webhook recorder", () => {
  it("a first delivery returns process", async () => {
    const id = eventId();
    expect(await recordWebhook(delivery(id))).toBe("process");
    expect(await row(id)).toMatchObject({ status: "received", attempts: 1, payload: delivery(id).payload });
  });

  it("a processed duplicate returns skip", async () => {
    const id = eventId();
    expect(await recordWebhook(delivery(id))).toBe("process");
    await finishWebhook("stripe", id, "processed");
    expect(await recordWebhook(delivery(id))).toBe("skip");
    const processed = await row(id);
    expect(processed).toMatchObject({ status: "processed", attempts: 1 });
    expect(processed.processed_at).not.toBeNull();

    // Ignored events are finished too, and a finished event never moves back.
    const ignored = eventId();
    await recordWebhook(delivery(ignored));
    await finishWebhook("stripe", ignored, "ignored");
    expect(await recordWebhook(delivery(ignored))).toBe("skip");
    await finishWebhook("stripe", ignored, "failed", "late failure");
    expect(await row(ignored)).toMatchObject({ status: "ignored", error: null });
  });

  it("a received event touched within 30 s returns skip", async () => {
    const id = eventId();
    expect(await recordWebhook(delivery(id))).toBe("process");
    // The first attempt is still running, so the provider's retry is acknowledged and dropped.
    expect(await recordWebhook(delivery(id))).toBe("skip");
    expect((await row(id)).attempts).toBe(1);

    const recent = eventId();
    await insertStale(recent, "received", 20_000);
    expect(await recordWebhook(delivery(recent))).toBe("skip");
  });

  it("a received or failed event older than 30 s increments attempts and returns process", async () => {
    const received = eventId();
    await insertStale(received, "received");
    expect(await recordWebhook(delivery(received))).toBe("process");
    expect(await row(received)).toMatchObject({ status: "received", attempts: 2 });
    // The retry touched the row, so a third delivery right now waits for it.
    expect(await recordWebhook(delivery(received))).toBe("skip");

    const failed = eventId();
    await insertStale(failed, "failed");
    expect(await recordWebhook(delivery(failed))).toBe("process");
    expect((await row(failed)).attempts).toBe(2);
    await finishWebhook("stripe", failed, "processed");
    expect(await row(failed)).toMatchObject({ status: "processed", attempts: 2 });

    const done = eventId();
    await insertStale(done, "processed");
    expect(await recordWebhook(delivery(done))).toBe("skip");
  });

  it("concurrent deliveries of a new or stale event process it exactly once", async () => {
    const fresh = eventId();
    const firsts = await Promise.all(Array.from({ length: 5 }, () => recordWebhook(delivery(fresh))));
    expect(firsts.filter((d) => d === "process")).toHaveLength(1);

    const stale = eventId();
    await insertStale(stale, "failed");
    const retries = await Promise.all(Array.from({ length: 5 }, () => recordWebhook(delivery(stale))));
    expect(retries.filter((d) => d === "process")).toHaveLength(1);
    expect((await row(stale)).attempts).toBe(2);
  });

  it("finishWebhook records a failure's message so the next retry can process it again", async () => {
    const id = eventId();
    await recordWebhook(delivery(id));
    await finishWebhook("stripe", id, "failed", "database unavailable");
    expect(await row(id)).toMatchObject({ status: "failed", error: "database unavailable", processed_at: null });

    // The handler answered 500, so the provider retries at once; nothing is running, so it's processed.
    expect(await recordWebhook(delivery(id))).toBe("process");
    expect(await row(id)).toMatchObject({ status: "failed", attempts: 2 });
    // Of two simultaneous retries of a failed event, one claims it.
    await finishWebhook("stripe", id, "failed", "still unavailable");
    const retries = await Promise.all([recordWebhook(delivery(id)), recordWebhook(delivery(id))]);
    expect(retries.sort()).toEqual(["process", "skip"]);
    expect((await row(id)).attempts).toBe(3);
    await finishWebhook("stripe", id, "processed");
    expect(await recordWebhook(delivery(id))).toBe("skip");
  });
});

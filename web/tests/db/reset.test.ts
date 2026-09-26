import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { reset } from "../../scripts/demo/reset";
import { seed } from "../../scripts/demo/seed";
import { adminClient, cleanup, createUser, testBatch } from "./helpers";

const batch = testBatch();
const other = testBatch();
const stuck = testBatch();
const elsewhere = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
const now = new Date("2026-09-26T15:00:00Z");

afterAll(async () => {
  await cleanup(batch);
  await cleanup(other);
  // The other batch's trip first: its organizer is one of `stuck`'s users.
  await cleanup(elsewhere);
  await cleanup(stuck);
});

async function profileIds(ofBatch: string): Promise<string[]> {
  const { data } = await admin.from("profiles").select("id").eq("seed_batch", ofBatch).order("id");
  return (data ?? []).map((p) => p.id);
}

describe("reset:demo", () => {
  it("resets one batch in under 30 s, keeps its seeded users, and leaves other batches alone", async () => {
    const first = await seed({ batch, now });
    const untouched = await seed({ batch: other, now });
    const seededUsers = await profileIds(batch);
    // Person 4 was claimed, and the morning moved on.
    const claimer = await createUser({ batch, displayName: "Person 4" });
    await admin
      .from("trip_members")
      .update({ status: "joined", profile_id: claimer.userId, invite_token: null })
      .eq("trip_id", first.tripId)
      .eq("display_name", "Person 4");
    await admin.from("itinerary_items").update({ status: "proposing" }).eq("trip_id", first.tripId).eq("slot_key", "morning");

    const result = await reset({ batch, now });

    expect(result.ms).toBeLessThan(30_000);
    expect(result.deletedUsers).toBe(1);
    expect(result.seeded.tripId).toBe(first.tripId);
    // The seeded users are the same users, so their sessions stay valid; the claimer is gone.
    expect(await profileIds(batch)).toEqual(seededUsers);
    const { data: person4 } = await admin.from("trip_members").select("status, invite_token").eq("trip_id", first.tripId).eq("display_name", "Person 4").single();
    expect(person4).toEqual({ status: "placeholder", invite_token: first.inviteToken });
    const { data: morning } = await admin.from("itinerary_items").select("status").eq("trip_id", first.tripId).eq("slot_key", "morning").single();
    expect(morning!.status).toBe("tbd");

    // The other batch still has its trip and users.
    const { count } = await admin.from("trips").select("*", { count: "exact", head: true }).eq("id", untouched.tripId);
    expect(count).toBe(1);
    expect(await profileIds(other)).toHaveLength(3);
  });

  it("forwards --stage to the re-seed", async () => {
    const seeded = await seed({ batch: stuck, now });
    // Until AI-214 builds it, the planned stage throws; the re-seed reaching it proves the stage came through.
    await expect(reset({ batch: stuck, stage: "planned", now })).rejects.toThrow(/stage not implemented: planned/);
    const { count } = await admin.from("trips").select("*", { count: "exact", head: true }).eq("id", seeded.tripId);
    expect(count).toBe(1);
  });

  it("a user it can't delete doesn't leave the batch without a trip", async () => {
    await seed({ batch: stuck, now });
    // A claimer of this batch who organizes a trip in another batch: deleting them is refused.
    const claimer = await createUser({ batch: stuck, displayName: "Person 4" });
    const { error } = await admin.from("trips").insert({
      slug: `x${Date.now().toString(36)}`.slice(0, 11).padEnd(11, "x"),
      title: "Another trip",
      city: "Atlanta",
      trip_date: "2026-10-03",
      organizer_profile_id: claimer.userId,
      seed_batch: elsewhere,
    });
    if (error) throw error;

    await expect(reset({ batch: stuck, now })).rejects.toThrow(/re-seeded, but couldn't delete 1 user/);
    const { count } = await admin.from("trips").select("*", { count: "exact", head: true }).eq("seed_batch", stuck);
    expect(count).toBe(1);
  });
});

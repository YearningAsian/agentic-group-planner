import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let organizer: TestUser;

const slugPattern = /^[A-Za-z0-9_-]{11}$/;

beforeAll(async () => {
  organizer = await createUser({ batch, displayName: "Person 1" });
});

afterAll(() => cleanup(batch));

async function insertTrip(slug?: string, id?: string) {
  return admin
    .from("trips")
    .insert({
      ...(slug === undefined ? {} : { slug }),
      ...(id === undefined ? {} : { id }),
      title: "Slug test trip",
      city: "Atlanta",
      trip_date: "2026-10-03",
      organizer_profile_id: organizer.userId,
      seed_batch: batch,
    })
    .select("id, slug")
    .single();
}

describe("database-generated trip slugs", () => {
  it("generates distinct 11-character base64url slugs for inserts without one", async () => {
    const rows = await Promise.all(Array.from({ length: 12 }, () => insertTrip()));
    for (const row of rows) {
      expect(row.error).toBeNull();
      expect(row.data?.slug).toMatch(slugPattern);
    }
    expect(new Set(rows.map((row) => row.data?.slug)).size).toBe(rows.length);
  });

  it("retries an explicit slug collision without changing the existing trip", async () => {
    const candidate = randomBytes(8).toString("base64url");
    const first = await insertTrip(candidate);
    expect(first.error).toBeNull();

    const second = await insertTrip(candidate);
    expect(second.error).toBeNull();
    expect(second.data?.slug).toMatch(slugPattern);
    expect(second.data?.slug).not.toBe(candidate);

    const original = await admin.from("trips").select("slug").eq("id", first.data!.id).single();
    expect(original.data?.slug).toBe(candidate);
  });

  it("rejects malformed slugs and changes to an existing slug", async () => {
    const malformed = await insertTrip("too-short");
    expect(malformed.error?.code).toBe("23514");

    const created = await insertTrip();
    expect(created.error).toBeNull();
    const changed = await admin.from("trips").update({ slug: randomBytes(8).toString("base64url") }).eq("id", created.data!.id);
    expect(changed.error).not.toBeNull();
  });

  it("lets a fixed demo slug be reclaimed only by the same trip ID after a reset", async () => {
    const fixed = randomBytes(8).toString("base64url");
    const first = await insertTrip(fixed);
    expect(first.error).toBeNull();
    expect((await admin.from("trips").delete().eq("id", first.data!.id)).error).toBeNull();
    const restored = await insertTrip(fixed, first.data!.id);
    expect(restored.error).toBeNull();
    expect(restored.data?.slug).toBe(fixed);
  });

  it("RLS hides a real slug from a non-member exactly like a missing slug", async () => {
    const outsider = await createUser({ batch, displayName: "Outsider" });
    const trip = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: organizer.userId }] });
    const forbidden = await outsider.client.from("trips").select("id").eq("slug", trip.slug).maybeSingle();
    const missing = await outsider.client.from("trips").select("id").eq("slug", randomBytes(8).toString("base64url")).maybeSingle();
    expect(forbidden).toMatchObject({ data: null, error: null });
    expect(missing).toMatchObject({ data: null, error: null });
    const visible = await organizer.client.from("trips").select("id").eq("slug", trip.slug).single();
    expect(visible.data?.id).toBe(trip.tripId);
  });
});

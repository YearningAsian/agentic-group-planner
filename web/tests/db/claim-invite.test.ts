import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimInvite, previewInvite } from "@/features/invite/server";
import { inviteTokenFor } from "../../scripts/demo/lib/ids";
import { seed } from "../../scripts/demo/seed";
import { adminClient, cleanup, createPlace, createTrip, createUser, publicClient, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const otherBatch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
const untaggedUserIds: string[] = [];
let organizer: TestUser;

const as = (user: TestUser) => user.client as SupabaseClient<Database>;

/** A nanoid(21)-shaped token, unique per call. */
function newToken(): string {
  return randomBytes(16).toString("base64url").slice(0, 21);
}

/** A trip with Person 1 (organizer) and Person 4 (a placeholder holding the token). */
async function tripWithPlaceholder(token = newToken()) {
  const trip = await createTrip(batch, {
    members: [{ displayName: "Person 1", profileId: organizer.userId }, { displayName: "Person 4", inviteToken: token }],
  });
  return { ...trip, token, placeholderId: trip.memberIds[1]! };
}

async function member(id: string) {
  const { data, error } = await admin.from("trip_members").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function profile(id: string) {
  const { data, error } = await admin.from("profiles").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

/** A signed-in user whose profile has no seed_batch, like someone who signs up from an invite. */
async function untaggedUser(): Promise<TestUser> {
  const email = `${randomUUID()}@test.agp.test`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error) throw created.error;
  untaggedUserIds.push(created.data.user.id);
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const client = publicClient();
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "email" });
  if (verified.error) throw verified.error;
  return { userId: created.data.user.id, email, client };
}

beforeAll(async () => {
  organizer = await createUser({ batch, displayName: "Person 1" });
});

afterAll(async () => {
  await cleanup(batch);
  await cleanup(otherBatch);
  // Claims that failed leave these untagged, so cleanup(batch) can't find them.
  for (const id of untaggedUserIds) await admin.auth.admin.deleteUser(id);
});

describe("claimInvite", () => {
  it("a claim sets joined, profile_id, and claimed_at, clears the token, and returns the slug and member id", async () => {
    const { slug, token, placeholderId } = await tripWithPlaceholder();
    const claimer = await createUser({ batch });

    const result = await claimInvite(as(claimer), token);

    expect(result).toEqual({ tripSlug: slug, memberId: placeholderId });
    const row = await member(placeholderId);
    expect(row).toMatchObject({ status: "joined", profile_id: claimer.userId, invite_token: null, display_name: "Person 4" });
    expect(Date.now() - Date.parse(row.claimed_at!)).toBeLessThan(60_000);
    // Now a joined member, the claimer can read the trip through row-level security.
    const { data: trips } = await as(claimer).from("trips").select("slug").eq("slug", slug);
    expect(trips).toEqual([{ slug }]);
  });

  it('a second claim of the same token returns "already used"', async () => {
    const { token, placeholderId } = await tripWithPlaceholder();
    const first = await createUser({ batch });
    const second = await createUser({ batch });
    await claimInvite(as(first), token);

    const alreadyUsed = { name: "AppError", code: "conflict", message: "This invite was already used." };
    await expect(claimInvite(as(second), token)).rejects.toMatchObject(alreadyUsed);
    // The claimer's own second device gets the same clear state, never a second claim.
    await expect(claimInvite(as(first), token)).rejects.toMatchObject(alreadyUsed);
    expect(await member(placeholderId)).toMatchObject({ status: "joined", profile_id: first.userId });

    // Two devices tapping Join at once: exactly one claim wins, and the other reads "already used".
    const race = await tripWithPlaceholder();
    const [a, b] = [await createUser({ batch }), await createUser({ batch })];
    const results = await Promise.allSettled([claimInvite(as(a), race.token), claimInvite(as(b), race.token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: alreadyUsed });
    const winner = await member(race.placeholderId);
    expect([a.userId, b.userId]).toContain(winner.profile_id);
  });

  it("an unknown or empty token is rejected and changes nothing", async () => {
    const { tripId, token, placeholderId } = await tripWithPlaceholder();
    const claimer = await createUser({ batch });
    const membersBefore = await admin.from("trip_members").select("*").eq("trip_id", tripId).order("sort_order");
    const profileBefore = await profile(claimer.userId);

    for (const bad of ["", "   ", newToken(), `${token.slice(0, 20)}x`]) {
      await expect(claimInvite(as(claimer), bad), JSON.stringify(bad)).rejects.toMatchObject({
        code: "not_found",
        message: "Invite not found.",
      });
    }
    // The function guards itself too, for a client that calls it directly.
    const direct = await as(claimer).rpc("claim_invite", { p_token: "" });
    expect(direct.error?.message).toMatch(/^not_found/);

    const membersAfter = await admin.from("trip_members").select("*").eq("trip_id", tripId).order("sort_order");
    expect(membersAfter.data).toEqual(membersBefore.data);
    expect(await profile(claimer.userId)).toEqual(profileBefore);
    expect(await member(placeholderId)).toMatchObject({ status: "placeholder", invite_token: token });
  });

  it("a signed-out caller is rejected and the placeholder stays open", async () => {
    const { token, placeholderId } = await tripWithPlaceholder();

    await expect(claimInvite(publicClient() as SupabaseClient<Database>, token)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(await member(placeholderId)).toMatchObject({ status: "placeholder", profile_id: null, invite_token: token });
  });

  it("a caller who's already a member gets an error", async () => {
    const { token, placeholderId } = await tripWithPlaceholder();

    // Person 1 opens Person 4's link: they can't take a second lane on their own trip.
    await expect(claimInvite(as(organizer), token)).rejects.toMatchObject({
      code: "conflict",
      message: "You're already a member of this trip.",
    });
    expect(await member(placeholderId)).toMatchObject({ status: "placeholder", profile_id: null, invite_token: token });
  });

  it("the trip's seed_batch is copied to the claimer's profile", async () => {
    const { token } = await tripWithPlaceholder();
    const claimer = await untaggedUser();
    expect((await profile(claimer.userId)).seed_batch).toBeNull();

    await claimInvite(as(claimer), token);

    // Tagged with the trip's batch, so resetting that batch removes the claimer (design §10.5).
    expect((await profile(claimer.userId)).seed_batch).toBe(batch);

    // A profile that already belongs to a batch keeps it, so a claim never moves a seeded user.
    const other = await tripWithPlaceholder();
    const tagged = await createUser({ batch: otherBatch });
    await claimInvite(as(tagged), other.token);
    expect((await profile(tagged.userId)).seed_batch).toBe(otherBatch);
  });
});

describe("previewInvite", () => {
  it("previewInvite returns only the trip title, date, and that member's lane", async () => {
    const token = newToken();
    const { tripId, memberIds } = await createTrip(batch, {
      title: "Saturday in Atlanta",
      tripDate: "2026-10-03",
      members: [
        { displayName: "Person 1", profileId: organizer.userId },
        { displayName: "Person 4", inviteToken: token },
      ],
    });
    const [organizerId, placeholderId] = memberIds as [string, string];
    const { placeId: museum } = await createPlace(batch, { name: "Test museum" });
    const { placeId: park } = await createPlace(batch, { name: "Test park" });

    // Times are UTC; the trip is in New York (UTC-4 in October).
    // A bulk insert sends null for any column a row leaves out, so every row names them all.
    type ItemInsert = Database["public"]["Tables"]["itinerary_items"]["Insert"];
    const item = (fields: Pick<ItemInsert, "slot_key" | "label" | "starts_at" | "ends_at"> & Partial<ItemInsert>): ItemInsert => ({
      trip_id: tripId,
      category: "activity",
      position: 1,
      status: "tbd",
      together: false,
      seed_batch: batch,
      ...fields,
    });
    const { data: items, error } = await admin
      .from("itinerary_items")
      .insert([
        // A TBD block with no attendees yet belongs to everyone's lane.
        item({ slot_key: "morning", label: "Morning", starts_at: "2026-10-03T14:00:00Z", ends_at: "2026-10-03T16:30:00Z", together: true }),
        // The split afternoon: Person 4's branch, and the organizer's.
        item({ slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:15:00Z", ends_at: "2026-10-03T21:15:00Z", status: "voting" }),
        item({ slot_key: "afternoon", label: "Afternoon", starts_at: "2026-10-03T18:15:00Z", ends_at: "2026-10-03T21:15:00Z", status: "voting", position: 2 }),
        // A replaced item never shows.
        item({ slot_key: "lunch", label: "Old lunch", starts_at: "2026-10-03T16:45:00Z", ends_at: "2026-10-03T17:45:00Z", status: "superseded" }),
      ])
      .select("id, slot_key, position, status");
    if (error) throw error;
    const [, mine, theirs, superseded] = items.map((i) => i.id) as [string, string, string, string];
    const optionRows = [
      { item_id: mine, place_id: museum, rank: 1 },
      { item_id: mine, place_id: park, rank: 2 },
      { item_id: theirs, place_id: park, rank: 1 },
    ].map((o) => ({ ...o, trip_id: tripId, price_cents: 1000, score: 1, score_breakdown: {}, source: "manual", seed_batch: batch }));
    const options = await admin.from("item_options").insert(optionRows);
    if (options.error) throw options.error;
    const attendees = await admin.from("item_attendees").insert([
      { item_id: mine, member_id: placeholderId, trip_id: tripId, seed_batch: batch },
      { item_id: theirs, member_id: organizerId, trip_id: tripId, seed_batch: batch },
      { item_id: superseded, member_id: placeholderId, trip_id: tripId, seed_batch: batch },
    ]);
    if (attendees.error) throw attendees.error;

    expect(await previewInvite(token)).toEqual({
      status: "open",
      trip: { title: "Saturday in Atlanta", trip_date: "2026-10-03" },
      lane: {
        display_name: "Person 4",
        lane_color: "lane-2",
        stops: [
          { label: "Morning", starts: "10:00", ends: "12:30", place_name: null },
          { label: "Afternoon", starts: "14:15", ends: "17:15", place_name: "Test museum" },
        ],
      },
    });

    // Once claimed, the link shows a clear state and nothing about the trip.
    await claimInvite(as(await createUser({ batch })), token);
    expect(await previewInvite(token)).toEqual({ status: "used" });
    expect(await previewInvite(newToken())).toEqual({ status: "not_found" });
    expect(await previewInvite("not a token")).toEqual({ status: "not_found" });
  });

  it("the seeded Person 4 link previews the Saturday trip and claims once", async () => {
    const seeded = testBatch();
    try {
      // A Saturday afternoon in New York, so the trip is the following Saturday.
      const { slug, inviteToken } = await seed({ batch: seeded, now: new Date("2026-09-26T15:00:00Z") });
      expect(inviteToken).toBe(inviteTokenFor(seeded));

      // Before any plan, every slot is a TBD block, so all four are Person 4's too.
      expect(await previewInvite(inviteToken)).toEqual({
        status: "open",
        trip: { title: "Saturday in Atlanta", trip_date: "2026-10-03" },
        lane: {
          display_name: "Person 4",
          lane_color: "lane-4",
          stops: [
            { label: "Morning", starts: "10:00", ends: "12:30", place_name: null },
            { label: "Lunch", starts: "12:45", ends: "13:45", place_name: null },
            { label: "Afternoon", starts: "14:15", ends: "17:15", place_name: null },
            { label: "Dinner", starts: "19:00", ends: "20:30", place_name: null },
          ],
        },
      });

      const claimer = await untaggedUser();
      expect((await claimInvite(as(claimer), inviteToken)).tripSlug).toBe(slug);
      expect((await profile(claimer.userId)).seed_batch).toBe(seeded);
      await expect(claimInvite(as(await createUser({ batch })), inviteToken)).rejects.toMatchObject({ code: "conflict" });
    } finally {
      await cleanup(seeded);
    }
  });
});

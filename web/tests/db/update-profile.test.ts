import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { updateProfile } from "@/features/profile/server";
import { adminClient, cleanup, createTrip, createUser, publicClient, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let organizer: TestUser;

const as = (user: TestUser) => user.client as SupabaseClient<Database>;

async function profile(id: string) {
  const { data, error } = await admin.from("profiles").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function memberNames(ids: string[]) {
  const { data, error } = await admin.from("trip_members").select("id, display_name").in("id", ids);
  if (error) throw error;
  return Object.fromEntries(data.map((m) => [m.id, m.display_name]));
}

beforeAll(async () => {
  organizer = await createUser({ batch, displayName: "Person 1" });
});

afterAll(() => cleanup(batch));

describe("updateProfile", () => {
  it("sets the display name and copies it onto the member's joined rows", async () => {
    // A claimer starts as "Guest" (design §5.1) and names themselves after joining two trips.
    const claimer = await createUser({ batch });
    const first = await createTrip(batch, {
      members: [
        { displayName: "Person 1", profileId: organizer.userId },
        { displayName: "Guest", profileId: claimer.userId },
      ],
    });
    const second = await createTrip(batch, {
      members: [
        { displayName: "Person 1", profileId: organizer.userId },
        { displayName: "Guest", profileId: claimer.userId },
        { displayName: "Guest" },
      ],
    });

    const result = await updateProfile(as(claimer), { displayName: "  Person 4 ", avatarUrl: "https://example.test/p4.png" });

    expect(result).toEqual({
      profile: { id: claimer.userId, display_name: "Person 4", avatar_url: "https://example.test/p4.png" },
    });
    expect(await profile(claimer.userId)).toMatchObject({ display_name: "Person 4", avatar_url: "https://example.test/p4.png" });
    expect(await memberNames([first.memberIds[1]!, second.memberIds[1]!, second.memberIds[2]!])).toEqual({
      [first.memberIds[1]!]: "Person 4",
      [second.memberIds[1]!]: "Person 4",
      // The placeholder that shares the old name isn't the caller's row.
      [second.memberIds[2]!]: "Guest",
    });

    // An avatar-only update leaves the name, and a null avatar clears it.
    await updateProfile(as(claimer), { avatarUrl: null });
    expect(await profile(claimer.userId)).toMatchObject({ display_name: "Person 4", avatar_url: null });
  });

  it("a caller with no session is rejected", async () => {
    const user = await createUser({ batch, displayName: "Person 2" });
    const before = await profile(user.userId);
    const signedOut = publicClient() as SupabaseClient<Database>;

    await expect(updateProfile(signedOut, { displayName: "Person 3" })).rejects.toMatchObject({
      name: "AppError",
      code: "unauthenticated",
    });
    // Straight to the database, a signed-out client can't update any profile either.
    const direct = await signedOut.from("profiles").update({ display_name: "Person 3" }).eq("id", user.userId).select();
    expect(direct.data ?? []).toEqual([]);
    expect(await profile(user.userId)).toEqual(before);
  });

  it("one member's update changes no other member's rows", async () => {
    const person2 = await createUser({ batch, displayName: "Person 2" });
    const person3 = await createUser({ batch, displayName: "Person 3" });
    const trip = await createTrip(batch, {
      members: [
        { displayName: "Person 1", profileId: organizer.userId },
        { displayName: "Person 2", profileId: person2.userId },
        { displayName: "Person 3", profileId: person3.userId },
      ],
    });
    const organizerBefore = await profile(organizer.userId);
    const person3Before = await profile(person3.userId);

    await updateProfile(as(person2), { displayName: "Person 2 (vegetarian)" });

    expect(await memberNames(trip.memberIds)).toEqual({
      [trip.memberIds[0]!]: "Person 1",
      [trip.memberIds[1]!]: "Person 2 (vegetarian)",
      [trip.memberIds[2]!]: "Person 3",
    });
    expect(await profile(organizer.userId)).toEqual(organizerBefore);

    // Row-level security keeps a direct write to another user's profile from matching any row.
    const direct = await as(person2).from("profiles").update({ display_name: "Person 9" }).eq("id", person3.userId).select();
    expect(direct.data ?? []).toEqual([]);
    expect(await profile(person3.userId)).toEqual(person3Before);
    expect((await memberNames([trip.memberIds[2]!]))[trip.memberIds[2]!]).toBe("Person 3");
  });

  it("a user can change only their name and avatar, within the same limits as the route", async () => {
    const user = await createUser({ batch, displayName: "Person 2" });
    const before = await profile(user.userId);
    const own = as(user).from("profiles");

    // Stripe fields and the seed batch belong to the server.
    for (const patch of [{ stripe_customer_id: "cus_fake" }, { default_payment_method_id: "pm_fake" }, { seed_batch: "demo" }]) {
      const { error } = await own.update(patch).eq("id", user.userId);
      expect(error?.code, JSON.stringify(patch)).toBe("42501");
    }
    // A client that skips the route still can't store a blank or overlong name, or a non-web avatar.
    for (const patch of [{ display_name: "   " }, { display_name: "x".repeat(81) }, { avatar_url: "javascript:alert(1)" }]) {
      const { error } = await own.update(patch).eq("id", user.userId);
      expect(error?.code, JSON.stringify(patch)).toBe("42501");
    }
    expect(await profile(user.userId)).toEqual(before);
    await expect(updateProfile(as(user), { displayName: "x".repeat(81) })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

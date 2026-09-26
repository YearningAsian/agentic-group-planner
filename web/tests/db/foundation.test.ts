import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanup, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient();
let organizer: TestUser;
let outsider: TestUser;
let tripId: string;
let memberIds: string[];

beforeAll(async () => {
  organizer = await createUser({ batch, displayName: "Person 1" });
  outsider = await createUser({ batch, displayName: "Outsider" });
  ({ tripId, memberIds } = await createTrip(batch, {
    members: [
      { displayName: "Person 1", profileId: organizer.userId },
      { displayName: "Person 4", status: "placeholder" },
    ],
  }));
});

afterAll(() => cleanup(batch));

describe("foundation migration", () => {
  it('handle_new_user creates a profile from display_name metadata, and "Guest" for an anonymous user', async () => {
    const { data: named } = await admin.from("profiles").select("display_name, seed_batch").eq("id", organizer.userId).single();
    expect(named).toEqual({ display_name: "Person 1", seed_batch: batch });

    const guest = await createUser({ batch, anonymous: true });
    const { data: anonymous } = await admin.from("profiles").select("display_name").eq("id", guest.userId).single();
    expect(anonymous?.display_name).toBe("Guest");
  });

  it("is_trip_member is true for a joined member and false for a placeholder row", async () => {
    const joined = await organizer.client.rpc("is_trip_member", { p_trip_id: tripId });
    expect(joined.error).toBeNull();
    expect(joined.data).toBe(true);

    // The placeholder row has no profile, so nobody is a member through it.
    const placeholder = await outsider.client.rpc("is_trip_member", { p_trip_id: tripId });
    expect(placeholder.data).toBe(false);
    const { data: row } = await admin.from("trip_members").select("status, profile_id").eq("id", memberIds[1]).single();
    expect(row).toEqual({ status: "placeholder", profile_id: null });
  });

  it("a signed-in non-member selects no trips and no trip_members", async () => {
    const trips = await outsider.client.from("trips").select("id").eq("id", tripId);
    expect(trips.error).toBeNull();
    expect(trips.data).toEqual([]);
    const members = await outsider.client.from("trip_members").select("id").eq("trip_id", tripId);
    expect(members.data).toEqual([]);

    // And a member does see them.
    const own = await organizer.client.from("trip_members").select("id").eq("trip_id", tripId);
    expect(own.data).toHaveLength(2);
  });

  it("trip_members rejects status joined with a null profile_id", async () => {
    const { error } = await admin
      .from("trip_members")
      .insert({ trip_id: tripId, display_name: "Nobody", status: "joined", lane_color: "lane-3", sort_order: 3, seed_batch: batch });
    expect(error?.code).toBe("23514");
  });

  it("a trip can't have two organizers", async () => {
    const { error } = await admin.from("trip_members").insert({
      trip_id: tripId,
      profile_id: outsider.userId,
      display_name: "Outsider",
      role: "organizer",
      status: "joined",
      lane_color: "lane-3",
      sort_order: 3,
      seed_batch: batch,
    });
    expect(error?.code).toBe("23505");
  });

  it("a member's status only moves forward", async () => {
    const { error } = await admin.from("trip_members").update({ status: "invited" }).eq("id", memberIds[0]);
    expect(error?.message).toContain("invalid_transition");
  });
});

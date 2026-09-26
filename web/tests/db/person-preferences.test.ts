import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTripSnapshot, renderContext } from "@/lib/agent/context";
import { adminClient, cleanup, createTrip, createUser, testBatch, type TestUser } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
let remembered: TestUser;
let stranger: TestUser;

const as = (user: TestUser) => user.client as SupabaseClient<Database>;

async function constraintsOf(memberId: string) {
  const { data, error } = await admin
    .from("member_constraints")
    .select("dietary, interests, budget_cents")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  remembered = await createUser({ batch, displayName: "Person 2" });
  stranger = await createUser({ batch, displayName: "Person 3" });
  const { error } = await as(remembered)
    .from("person_preferences")
    .insert({
      profile_id: remembered.userId,
      dietary: ["vegetarian"],
      interests: ["art", "food"],
      notes: [{ text: "hates early starts", at: "2026-09-26T12:00:00Z" }],
      seed_batch: batch,
    });
  if (error) throw error;
});

afterAll(() => cleanup(batch));

describe("person_preferences", () => {
  it("a user reads and writes only their own row", async () => {
    const own = await as(remembered).from("person_preferences").select("profile_id");
    expect(own.data).toEqual([{ profile_id: remembered.userId }]);

    const others = await as(stranger).from("person_preferences").select("profile_id");
    expect(others.error).toBeNull();
    expect(others.data).toEqual([]);

    const forged = await as(stranger).from("person_preferences").insert({ profile_id: remembered.userId, interests: ["x"] });
    expect(forged.error).not.toBeNull();

    const edit = await as(stranger).from("person_preferences").update({ interests: ["x"] }).eq("profile_id", remembered.userId).select();
    expect(edit.data ?? []).toEqual([]);
  });

  it("a member who joins as the organizer starts with their remembered dietary needs and interests", async () => {
    const trip = await createTrip(batch, { members: [{ displayName: "Person 2", profileId: remembered.userId }] });
    expect(await constraintsOf(trip.memberIds[0]!)).toEqual({ dietary: ["vegetarian"], interests: ["art", "food"], budget_cents: null });
  });

  it("claiming a lane merges remembered preferences into what the organizer set, keeping the budget", async () => {
    const organizer = await createUser({ batch, displayName: "Person 1" });
    const token = `tok_${crypto.randomUUID()}`;
    const trip = await createTrip(batch, {
      members: [
        { displayName: "Person 1", profileId: organizer.userId },
        { displayName: "Guest", inviteToken: token },
      ],
    });
    const lane = trip.memberIds[1]!;
    const seeded = await admin
      .from("member_constraints")
      .insert({ trip_id: trip.tripId, member_id: lane, dietary: ["nut_free"], interests: ["food", "parks"], budget_cents: 5000, seed_batch: batch });
    if (seeded.error) throw seeded.error;
    // Nothing remembered for the organizer, so their lane gets no constraints row.
    expect(await constraintsOf(trip.memberIds[0]!)).toBeNull();

    const claim = await as(remembered).rpc("claim_invite", { p_token: token });
    expect(claim.error).toBeNull();

    expect(await constraintsOf(lane)).toEqual({
      dietary: ["nut_free", "vegetarian"],
      interests: ["art", "food", "parks"],
      budget_cents: 5000,
    });
  });

  it("remember_preference saves only for the requester and shows up in the next context", async () => {
    const speaker = await createUser({ batch, displayName: "Person 5" });
    const trip = await createTrip(batch, {
      members: [
        { displayName: "Person 5", profileId: speaker.userId },
        { displayName: "Person 3", profileId: stranger.userId },
      ],
    });
    const { rememberPreferenceTool } = await import("@/lib/tools/remember-preference/tool");
    const ctx = {
      tripId: trip.tripId,
      runId: "00000000-0000-4000-8000-0000000000f1",
      toolCallId: "call_pref",
      requesterMemberId: trip.memberIds[0]!,
      actorMemberId: trip.memberIds[0]!,
      handles: { M1: trip.memberIds[0]! },
      admin: admin as never,
    };
    const result = await rememberPreferenceTool.handler(
      rememberPreferenceTool.input.parse({ dietary: ["vegan"], note: "prefers museums" }),
      ctx,
    );
    expect(result.ok).toBe(true);

    const snapshot = await loadTripSnapshot(admin as never, trip.tripId);
    expect(snapshot.members.find((m) => m.id === trip.memberIds[0])?.remembered).toEqual(["prefers museums"]);
    expect(await constraintsOf(trip.memberIds[0]!)).toMatchObject({ dietary: ["vegan"] });
    // The shared fixture profile is untouched.
    expect(
      (await admin.from("person_preferences").select("notes").eq("profile_id", remembered.userId).single()).data?.notes,
    ).toEqual([{ text: "hates early starts", at: "2026-09-26T12:00:00Z" }]);
  });

  it("the agent's context quotes what it remembers about each joined member", async () => {
    const trip = await createTrip(batch, {
      members: [
        { displayName: "Person 2", profileId: remembered.userId },
        { displayName: "Person 3", profileId: stranger.userId },
        { displayName: "Guest" },
      ],
    });
    const snapshot = await loadTripSnapshot(admin as never, trip.tripId);
    expect(snapshot.members.find((m) => m.id === trip.memberIds[0])?.remembered).toEqual(["hates early starts"]);
    expect(snapshot.members.find((m) => m.id === trip.memberIds[1])).not.toHaveProperty("remembered");

    const { system } = renderContext(snapshot, trip.memberIds[1]!);
    expect(system).toMatch(/M1 Person 2 \(organizer, vegetarian\) · no budget set · likes art, food · remembers "hates early starts"/);
  });
});

import type { Database } from "@agp/shared/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { inviteTokenFor } from "../../scripts/demo/lib/ids";
import { seed } from "../../scripts/demo/seed";
import { adminClient, cleanup, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient() as SupabaseClient<Database>;
// A Saturday afternoon in New York, so the trip is the following Saturday.
const now = new Date("2026-09-26T15:00:00Z");

afterAll(() => cleanup(batch));

describe("seed:demo", () => {
  it("seeding twice gives identical row counts and the same trip", async () => {
    const first = await seed({ batch, now });
    const second = await seed({ batch, now });

    expect(second).toEqual(first);
    expect(first.counts).toMatchObject({ profiles: 3, trips: 1, trip_members: 4, member_constraints: 4, itinerary_items: 4 });
    expect(first.counts.places).toBeGreaterThanOrEqual(12);
    expect(first.inviteToken).toBe(inviteTokenFor(batch));
    expect(first.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("the members are Person 1 through Person 4, and Person 4 is a placeholder with the invite token", async () => {
    const { tripId, inviteToken } = await seed({ batch, now });
    const { data: members } = await admin
      .from("trip_members")
      .select("display_name, role, status, profile_id, invite_token, sort_order")
      .eq("trip_id", tripId)
      .order("sort_order");

    expect(members!.map((m) => m.display_name)).toEqual(["Person 1", "Person 2", "Person 3", "Person 4"]);
    expect(members![0]).toMatchObject({ role: "organizer", status: "joined", invite_token: null });
    expect(members!.slice(1, 3).every((m) => m.status === "joined" && m.profile_id)).toBe(true);
    expect(members![3]).toMatchObject({ status: "placeholder", profile_id: null, invite_token: inviteToken });
  });

  it("the items are the four Saturday slots in New York time, with dinner's area set", async () => {
    const { tripId } = await seed({ batch, now });
    const { data: items } = await admin
      .from("itinerary_items")
      .select("slot_key, starts_at, together, status, area_label, area_lat")
      .eq("trip_id", tripId)
      .order("starts_at");

    expect(items!.map((i) => [i.slot_key, i.status])).toEqual([
      ["morning", "tbd"],
      ["lunch", "tbd"],
      ["afternoon", "tbd"],
      ["dinner", "tbd"],
    ]);
    expect(Date.parse(items![0]!.starts_at)).toBe(Date.parse("2026-10-03T14:00:00Z"));
    expect(items![2]!.together).toBe(false);
    expect(items![3]).toMatchObject({ area_label: "Midtown", area_lat: 33.7835 });
  });

  it("the places carry a per-person price in their payload", async () => {
    const { data } = await admin.from("places").select("name, raw").eq("provider", "seed").eq("provider_place_id", "georgia-aquarium").single();
    expect(data).toMatchObject({ name: "Georgia Aquarium", raw: { price_cents: 4200 } });
  });

  it("a re-run leaves a trip that moved on alone", async () => {
    const { tripId } = await seed({ batch, now });
    await admin.from("itinerary_items").update({ status: "proposing" }).eq("trip_id", tripId).eq("slot_key", "morning");
    // A plan_day run saved new constraints for Person 2.
    const { data: person2 } = await admin.from("trip_members").select("id").eq("trip_id", tripId).eq("display_name", "Person 2").single();
    await admin.from("member_constraints").update({ budget_cents: 5000, dietary: ["vegan"] }).eq("member_id", person2!.id);

    // Person 4 claimed their lane since the last seed.
    const claimer = await createUser({ batch, displayName: "Person 4" });
    await admin
      .from("trip_members")
      .update({ status: "joined", profile_id: claimer.userId, invite_token: null, claimed_at: new Date().toISOString() })
      .eq("trip_id", tripId)
      .eq("display_name", "Person 4");

    await expect(seed({ batch, now })).resolves.toBeDefined();
    const { data } = await admin.from("itinerary_items").select("status").eq("trip_id", tripId).eq("slot_key", "morning").single();
    expect(data!.status).toBe("proposing");
    const { data: person4 } = await admin.from("trip_members").select("status, profile_id").eq("trip_id", tripId).eq("display_name", "Person 4").single();
    expect(person4).toEqual({ status: "joined", profile_id: claimer.userId });
    const { data: constraints } = await admin.from("member_constraints").select("budget_cents, dietary").eq("member_id", person2!.id).single();
    expect(constraints).toEqual({ budget_cents: 5000, dietary: ["vegan"] });
  });
});

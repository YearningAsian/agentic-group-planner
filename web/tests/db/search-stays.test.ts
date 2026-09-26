import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { findPlaces } from "@/lib/optimizer/find-places";
import { createSearchStaysTool, searchStaysTool } from "@/lib/tools/search-stays/tool";
import { adminClient, cleanup, createTrip, createUser, testBatch } from "./helpers";

const batch = testBatch();
const admin = adminClient();

async function tripWithItem(item: { category: string; status?: string }) {
  const organizer = await createUser({ batch, displayName: "Person 1" });
  const { tripId, memberIds } = await createTrip(batch, { members: [{ displayName: "Person 1", profileId: organizer.userId }] });
  const { data, error } = await admin
    .from("itinerary_items")
    .insert({
      trip_id: tripId,
      slot_key: "hotel",
      label: "Hotel",
      category: item.category,
      starts_at: "2026-09-26T22:00:00Z",
      ends_at: "2026-09-27T15:00:00Z",
      position: 9,
      status: item.status ?? "tbd",
      area_label: "Midtown",
      area_lat: 33.7812,
      area_lng: -84.3857,
      seed_batch: batch,
    })
    .select("id")
    .single();
  if (error) throw error;
  const ctx = {
    tripId,
    runId: "00000000-0000-4000-8000-0000000000f2",
    toolCallId: "call_stays",
    requesterMemberId: memberIds[0]!,
    actorMemberId: memberIds[0]!,
    handles: { I1: data.id, M1: memberIds[0]! } as Record<string, string>,
    admin: admin as never,
  };
  return { ctx, itemId: data.id };
}

afterAll(() => cleanup(batch));

describe("search_stays", () => {
  it("stores a Duffel rate with the item, dates, guests, and expiry, then reuses its place", async () => {
    const { ctx } = await tripWithItem({ category: "lodging" });
    const search = {
      id: "duffel_stays" as const,
      search: async () => [{
        providerPlaceId: "srr_test:rat_test", rateId: "rat_test", totalCents: 12001,
        expiresAt: "2099-09-26T21:00:00.000Z", name: "Duffel Test Hotel",
        address: "1 Test Road", lat: 33.7812, lng: -84.3857, rating: 4,
        tags: [], pricePerGuestCents: 12001, distanceKm: 0,
      }],
    };
    const tool = createSearchStaysTool({ search });
    const args = tool.input.parse({ item_handle: "I1", max_results: 1 });
    const first = await tool.handler(args, ctx);
    const second = await tool.handler(args, ctx);
    const placeId = Object.entries(first.handles ?? {}).find(([handle]) => handle.startsWith("P"))?.[1];
    expect(placeId).toBeDefined();
    expect(Object.values(second.handles ?? {})).toContain(placeId);
    const { data, error } = await admin.from("places").select("provider, provider_place_id, raw").eq("id", placeId!).single();
    if (error) throw error;
    expect(data).toMatchObject({
      provider: "duffel_stays", provider_place_id: `${ctx.handles.I1}:srr_test:rat_test`,
      raw: { source: "search_stays", rate_id: "rat_test", item_id: ctx.handles.I1,
        check_in_date: "2026-09-26", check_out_date: "2026-09-27", guests: 1,
        expires_at: "2099-09-26T21:00:00.000Z", total_cents: 12001, price_cents: 12001 },
    });
    const scoped = await findPlaces({ category: "lodging", limit: 50,
      stays: { provider: "real", itemIds: [ctx.handles.I1], now: "2026-09-26T12:00:00.000Z" } }, admin as never);
    expect(scoped.map((p) => p.id)).toContain(placeId);
    const unrelated = await findPlaces({ category: "lodging", limit: 50,
      stays: { provider: "real", itemIds: ["00000000-0000-4000-8000-000000000099"], now: "2026-09-26T12:00:00.000Z" } }, admin as never);
    expect(unrelated.map((p) => p.id)).not.toContain(placeId);
  });

  it("with no attendee rows, it searches for every member, placeholders included, as plan_day plans", async () => {
    const organizer = await createUser({ batch, displayName: "Person 1" });
    const { tripId, memberIds } = await createTrip(batch, {
      members: [{ displayName: "Person 1", profileId: organizer.userId }, { displayName: "Person 4", inviteToken: `invite-${randomUUID()}` }],
    });
    const { data: item, error } = await admin.from("itinerary_items").insert({
      trip_id: tripId, slot_key: "hotel", label: "Hotel", category: "lodging", starts_at: "2026-09-26T22:00:00Z",
      ends_at: "2026-09-27T15:00:00Z", position: 9, status: "tbd", area_label: "Midtown", area_lat: 33.7812, area_lng: -84.3857, seed_batch: batch,
    }).select("id").single();
    if (error) throw error;
    let guests = 0;
    const search = { id: "stays_mock" as const, search: async (input: { guests: number }) => { guests = input.guests; return []; } };
    const tool = createSearchStaysTool({ search: search as never });
    const ctx = { tripId, runId: "00000000-0000-4000-8000-0000000000f3", toolCallId: "call_guests", requesterMemberId: memberIds[0]!,
      actorMemberId: memberIds[0]!, handles: { I1: item.id } as Record<string, string>, admin: admin as never };

    await tool.handler(tool.input.parse({ item_handle: "I1", max_results: 1 }), ctx);

    expect(guests).toBe(2);
  });

  it("a Duffel rate's place is readable only by that trip's members, and needs its whole scope", async () => {
    const { ctx } = await tripWithItem({ category: "lodging" });
    const search = {
      id: "duffel_stays" as const,
      search: async () => [{
        providerPlaceId: `srr_${randomUUID()}:rat_private`, rateId: "rat_private", totalCents: 20000,
        expiresAt: "2099-09-26T21:00:00.000Z", name: "Private Rate Hotel", address: "2 Test Road",
        lat: 33.78, lng: -84.38, rating: null, tags: [], pricePerGuestCents: 20000, distanceKm: 0,
      }],
    };
    const tool = createSearchStaysTool({ search: search as never });
    const result = await tool.handler(tool.input.parse({ item_handle: "I1", max_results: 1 }), ctx);
    const placeId = Object.entries(result.handles ?? {}).find(([handle]) => handle.startsWith("P"))![1];
    const outsider = await createUser({ batch, displayName: "Outsider" });

    const { data: seen } = await outsider.client.from("places").select("id").eq("id", placeId);
    expect(seen).toEqual([]);

    const incomplete = await admin.from("places").insert({
      provider: "duffel_stays", provider_place_id: `srr_${randomUUID()}:rat_none`, name: "No Rate", category: "lodging",
      raw: { price_cents: 100, item_id: ctx.handles.I1, trip_id: ctx.tripId, check_in_date: "2026-09-26", check_out_date: "2026-09-27",
        guests: 1, expires_at: "2099-01-01T00:00:00.000Z", total_cents: 100 },
      seed_batch: batch,
    });
    expect(incomplete.error?.code).toBe("23514");
  });

  it("caches nearby hotels as lodging places with a per-guest price, so plan_day can offer them", async () => {
    const { ctx } = await tripWithItem({ category: "lodging" });

    const result = await searchStaysTool.handler(searchStaysTool.input.parse({ item_handle: "I1", max_results: 3 }), ctx);

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Midtown Commons Hotel");
    const placeHandles = Object.entries(result.handles ?? {}).filter(([h]) => h.startsWith("P"));
    expect(placeHandles).toHaveLength(3);
    const { data: places, error } = await admin
      .from("places")
      .select("id, provider, category, raw")
      .in("id", placeHandles.map(([, id]) => id));
    if (error) throw error;
    expect(places).toHaveLength(3);
    for (const place of places!) expect(place).toMatchObject({ provider: "mock", category: "lodging" });
    expect(places!.map((p) => (p.raw as { price_cents: number }).price_cents)).toContain(11900);

    const candidates = await findPlaces({ category: "lodging", limit: 50 }, admin as never);
    expect(candidates.map((c) => c.id)).toEqual(expect.arrayContaining(placeHandles.map(([, id]) => id)));
  });

  it("searching twice reuses the same places instead of adding copies", async () => {
    const { ctx } = await tripWithItem({ category: "lodging" });
    const first = await searchStaysTool.handler(searchStaysTool.input.parse({ item_handle: "I1", max_results: 2 }), ctx);
    const second = await searchStaysTool.handler(searchStaysTool.input.parse({ item_handle: "I1", max_results: 2 }), ctx);
    const ids = (r: typeof first) => Object.entries(r.handles ?? {}).filter(([h]) => h.startsWith("P")).map(([, id]) => id).sort();
    expect(ids(second)).toEqual(ids(first));
  });

  it("refuses an item that isn't lodging, or one already booked", async () => {
    const dinner = await tripWithItem({ category: "food" });
    await expect(searchStaysTool.handler(searchStaysTool.input.parse({ item_handle: "I1" }), dinner.ctx)).rejects.toMatchObject({
      code: "invalid_input",
    });
    const booked = await tripWithItem({ category: "lodging", status: "decided" });
    const set = await admin.from("itinerary_items").update({ status: "booked" }).eq("id", booked.itemId);
    if (set.error) throw set.error;
    await expect(searchStaysTool.handler(searchStaysTool.input.parse({ item_handle: "I1" }), booked.ctx)).rejects.toMatchObject({
      code: "conflict",
    });
  });
});

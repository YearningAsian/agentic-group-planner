import "server-only";
import { SearchStaysInput, type ToolResult } from "@agp/shared";
import { addHandle, resolveHandle } from "@/lib/agent/handles";
import { getStaysSearch, type StaysSearch } from "@/lib/providers/booking";
import { AppError } from "@/lib/reliability";
import { defineTool } from "../define-tool";

const CLOSED = new Set(["booked", "cancelled", "superseded"]);

export interface SearchStaysDeps {
  search?: StaysSearch;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

/**
 * `search_stays` (plan CO-S05): finds hotels near a lodging item's area for its dates and party,
 * and caches them as `lodging` places with the per-guest price for the whole stay in
 * `raw.price_cents`. The cache key includes the night count, so one trip's stay length can't
 * overwrite another's price. It changes no item; `plan_day` with that item's handle then offers
 * them as options, and `propose_purchase` books the chosen one through the stays adapter.
 */
export function createSearchStaysTool(deps: SearchStaysDeps = {}) {
  return defineTool({
    name: "search_stays",
    description:
      "Find hotels for a lodging item near its area, for its dates and the people attending. Found hotels become places; then run plan_day with that item's handle so they become its options.",
    input: SearchStaysInput,
    handler: async (input, ctx): Promise<ToolResult> => {
      const itemId = resolveHandle(ctx.handles, input.item_handle, "I");
      const [itemResult, tripResult, attendeeResult, memberResult] = await Promise.all([
        ctx.admin
          .from("itinerary_items")
          .select("label, category, status, starts_at, ends_at, area_lat, area_lng")
          .eq("id", itemId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle(),
        ctx.admin.from("trips").select("seed_batch").eq("id", ctx.tripId).single(),
        ctx.admin.from("item_attendees").select("member_id", { count: "exact", head: true }).eq("item_id", itemId),
        ctx.admin.from("trip_members").select("id", { count: "exact", head: true }).eq("trip_id", ctx.tripId).eq("status", "joined"),
      ]);
      for (const result of [itemResult, tripResult, attendeeResult, memberResult]) {
        if (result.error) throw new AppError("internal", "Couldn't read the item.", { retryable: true, cause: result.error });
      }
      const item = itemResult.data;
      if (!item) throw new AppError("unknown_handle", `There's no ${input.item_handle} on this trip.`, { retryable: false });
      if (item.category !== "lodging") {
        throw new AppError("invalid_input", `${item.label} isn't a lodging item; use search_places for other venues.`, { retryable: false });
      }
      if (CLOSED.has(item.status)) throw new AppError("conflict", `${item.label} is ${item.status}; it can't take new hotels.`, { retryable: false });
      if (item.area_lat === null || item.area_lng === null) {
        throw new AppError("invalid_input", `${item.label} has no area to search near; give it one with update_item first.`, { retryable: false });
      }

      // No attendee rows means everyone together, same as plan_day's RequestItem rule.
      const guests = Math.max(1, (attendeeResult.count ?? 0) || (memberResult.count ?? 1));
      const search = deps.search ?? getStaysSearch();
      const offers = await search.search({
        near: { lat: item.area_lat, lng: item.area_lng },
        checkIn: item.starts_at,
        checkOut: item.ends_at,
        guests,
        maxResults: input.max_results,
      });
      if (offers.length === 0) return { ok: true, summary: `No hotels found near ${item.label}'s area.` };

      if (search.id === "duffel_stays" && offers.some((o) => !o.rateId || !o.expiresAt || !Number.isInteger(o.totalCents))) {
        throw new AppError("provider_unavailable", "The hotel provider returned a rate without booking details.", { retryable: false });
      }

      const keys = offers.map((o) => o.providerPlaceId);
      const provider = search.id === "duffel_stays" ? "duffel_stays" as const : "mock" as const;
      const fetchedAt = new Date().toISOString();
      // ignoreDuplicates keeps another trip's seed_batch (and its fixed per-nights price) intact.
      const { error: upsertError } = await ctx.admin.from("places").upsert(
        offers.map((o) => ({
          provider,
          provider_place_id: o.providerPlaceId,
          name: o.name,
          category: "lodging" as const,
          address: o.address,
          lat: o.lat,
          lng: o.lng,
          rating: o.rating,
          tags: o.tags,
          raw: {
            price_cents: o.pricePerGuestCents,
            source: "search_stays",
            ...(provider === "duffel_stays" ? {
              rate_id: o.rateId!, total_cents: o.totalCents!, expires_at: o.expiresAt!,
              item_id: itemId, trip_id: ctx.tripId, check_in_date: item.starts_at.slice(0, 10),
              check_out_date: item.ends_at.slice(0, 10), guests,
            } : {}),
          },
          fetched_at: fetchedAt,
          seed_batch: tripResult.data!.seed_batch,
        })),
        { onConflict: "provider,provider_place_id", ignoreDuplicates: true },
      );
      if (upsertError) throw new AppError("internal", "Couldn't save the hotels.", { retryable: true, cause: upsertError });
      const { data: places, error } = await ctx.admin
        .from("places")
        .select("id, provider_place_id")
        .eq("provider", provider)
        .in("provider_place_id", keys);
      if (error) throw new AppError("internal", "Couldn't save the hotels.", { retryable: true, cause: error });

      const idOf = new Map(places.map((p) => [p.provider_place_id, p.id]));
      const handles: Record<string, string> = {};
      const lines: string[] = [];
      for (const o of offers) {
        const id = idOf.get(o.providerPlaceId)!;
        const handle = addHandle(ctx.handles, "P", id);
        handles[handle] = id;
        lines.push(`${handle} ${o.name} (${dollars(o.pricePerGuestCents)}/guest, ${o.rating}★, ${o.distanceKm} km)`);
      }
      const head = `Found ${offers.length} hotels for ${item.label}: `;
      const tail = ". Run plan_day with this item's handle to offer them.";
      let summary = `${head}${lines.join("; ")}${tail}`;
      while (summary.length > 600 && lines.length > 1) {
        lines.pop();
        summary = `${head}${lines.join("; ")}${tail}`;
      }
      if (summary.length > 600) summary = `${summary.slice(0, 597)}...`;
      return { ok: true, summary, handles };
    },
  });
}

export const searchStaysTool = createSearchStaysTool();

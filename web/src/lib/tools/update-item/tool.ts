import "server-only";
import { randomUUID } from "node:crypto";
import { ItineraryChangeCard, PlanDayInput, type UpdateItemAction, UpdateItemInput } from "@agp/shared";
import type { Json } from "@agp/shared/db";
import { addHandle, resolveHandle } from "@/lib/agent/handles";
import { AppError, rpcError } from "@/lib/reliability";
import { defineTool, type RunContext } from "../define-tool";
import { type PlanDayDeps, runPlanDay } from "../plan-day/tool";

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

type ItemRow = { id: string; label: string; status: string; chosen_option_id: string | null };

async function readItem(ctx: RunContext, itemId: string): Promise<ItemRow> {
  const { data, error } = await ctx.admin
    .from("itinerary_items")
    .select("id, label, status, chosen_option_id")
    .eq("id", itemId)
    .eq("trip_id", ctx.tripId)
    .maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read the item.", { retryable: true, cause: error });
  if (!data) throw new AppError("unknown_handle", "That item isn't on this trip. Use a handle from the trip context.");
  return data;
}

async function placeName(ctx: RunContext, optionId: string | null): Promise<string | null> {
  if (!optionId) return null;
  const { data, error } = await ctx.admin.from("item_options").select("place:places(name)").eq("id", optionId).maybeSingle();
  if (error) throw new AppError("internal", "Couldn't read the option.", { retryable: true, cause: error });
  return data?.place?.name ?? null;
}

/**
 * The places the item's slot has offered, in any round and to either group of a split, so
 * request_alternatives leaves them all out and never brings an earlier round back.
 */
async function offeredPlaceIds(ctx: RunContext, itemId: string): Promise<Set<string>> {
  const { data: item, error: itemError } = await ctx.admin.from("itinerary_items").select("slot_key").eq("id", itemId).single();
  if (itemError) throw new AppError("internal", "Couldn't read the item.", { retryable: true, cause: itemError });
  const { data: slotItems, error: slotError } = await ctx.admin
    .from("itinerary_items")
    .select("id")
    .eq("trip_id", ctx.tripId)
    .eq("slot_key", item.slot_key);
  if (slotError) throw new AppError("internal", "Couldn't read the slot's items.", { retryable: true, cause: slotError });
  const { data, error } = await ctx.admin.from("item_options").select("place_id").in("item_id", slotItems.map((i) => i.id));
  if (error) throw new AppError("internal", "Couldn't read the item's options.", { retryable: true, cause: error });
  return new Set(data.map((o) => o.place_id));
}

/**
 * update_item (design §2.1): one change to one item, written with its itinerary_change card by
 * `apply_item_change` in one transaction. The server writes the card's text from the rows; the
 * database enforces who may do what. request_alternatives instead re-plans that one item through
 * plan_day's replan path, without the places it already offered, and posts a plan card of the new
 * options (design §11.7).
 */
export function createUpdateItemTool(deps: PlanDayDeps = {}) {
  return defineTool({
    name: "update_item",
    description:
      "Change one itinerary item: add a slot, mark it TBD, swap to another option (organizer only), ask for alternatives, or set who attends. Refer to items, options, and members by handle (I#, O#, M#).",
    input: UpdateItemInput,
    handler: async (input, ctx) => {
      const itemId = input.item_handle ? resolveHandle(ctx.handles, input.item_handle, "I") : null;
      const item = itemId ? await readItem(ctx, itemId) : null;

      if (input.action === "request_alternatives") {
        if (item!.status === "booked") throw new AppError("not_permitted", "This item is booked, so it can't change.");
        if (item!.status === "superseded" || item!.status === "cancelled") {
          throw new AppError("conflict", `${item!.label} was ${item!.status === "superseded" ? "replaced" : "cancelled"}; use the current trip context.`, {
            retryable: false,
          });
        }
        const replan = PlanDayInput.parse({ mode: "replan", item_handles: [input.item_handle] });
        return runPlanDay(replan, ctx, deps, { excludePlaceIds: await offeredPlaceIds(ctx, item!.id) });
      }

      const newItemId = input.action === "mark_tbd" || input.action === "add_slot" ? randomUUID() : null;
      const optionId = input.option_handle ? resolveHandle(ctx.handles, input.option_handle, "O") : null;
      const memberIds = input.member_handles?.map((handle) => resolveHandle(ctx.handles, handle, "M"));

      let label: string;
      let summary: string;
      switch (input.action as Exclude<UpdateItemAction, "request_alternatives">) {
        case "swap_option":
          label = item!.label;
          summary = `${label} is locked to ${(await placeName(ctx, optionId)) ?? "the chosen option"}.`;
          break;
        case "mark_tbd": {
          label = item!.label;
          const dropped = await placeName(ctx, item!.chosen_option_id);
          summary = dropped ? `${label} is TBD again; ${dropped} was dropped.` : `${label} is TBD again.`;
          break;
        }
        case "set_attendees": {
          label = item!.label;
          const { data, error } = await ctx.admin
            .from("trip_members")
            .select("id, display_name, sort_order")
            .eq("trip_id", ctx.tripId)
            .in("id", memberIds!);
          if (error) throw new AppError("internal", "Couldn't read the members.", { retryable: true, cause: error });
          const names = [...data].sort((a, b) => a.sort_order - b.sort_order).map((m) => m.display_name);
          summary = `${label}: ${names.join(", ")}.`;
          break;
        }
        case "add_slot": {
          const slot = input.slot!;
          label = slot.label;
          const { data, error } = await ctx.admin.from("trips").select("timezone").eq("id", ctx.tripId).single();
          if (error) throw new AppError("internal", "Couldn't read the trip.", { retryable: true, cause: error });
          const near = slot.area ? ` near ${slot.area.label}` : "";
          summary = `Added ${label}, ${clock(slot.starts_at, data.timezone)}–${clock(slot.ends_at, data.timezone)}${near}, to be decided.`;
          break;
        }
      }

      const card = ItineraryChangeCard.parse({
        card_type: "itinerary_change",
        requested_by_member_id: ctx.requesterMemberId ?? ctx.actorMemberId,
        changes: [{ item_id: newItemId ?? itemId!, label, action: input.action, summary: summary.slice(0, 200) }],
      });
      const handles = newItemId ? { [addHandle(ctx.handles, "I", newItemId)]: `${label} (TBD)` } : undefined;
      const resultSummary = `${summary}${handles ? ` The new item is ${Object.keys(handles)[0]}.` : ""} Posted an itinerary change card.`;

      const { data, error } = await ctx.admin.rpc("apply_item_change", {
        payload: {
          trip_id: ctx.tripId,
          actor_member_id: ctx.actorMemberId,
          run_id: ctx.runId,
          tool_call_id: ctx.toolCallId,
          action: input.action,
          item_id: itemId,
          option_id: optionId,
          member_ids: memberIds ?? null,
          new_item_id: newItemId,
          slot: input.slot ?? null,
          card,
          result_summary: resultSummary,
          ...(handles ? { result_handles: handles } : {}),
        } as unknown as Json,
      });
      if (error) throw rpcError(error);
      const cardMessageId = (data as { card_message_id: string }).card_message_id;
      return { ok: true, summary: resultSummary, card_message_id: cardMessageId, ...(handles ? { handles } : {}) };
    },
  });
}

export const updateItemTool = createUpdateItemTool();

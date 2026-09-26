import "server-only";
import { type ConstraintUpdate, PlaceCategory, PlanDayInput, type ToolResult } from "@agp/shared";
import { applyPlan } from "@/features/itinerary/server";
import { travelMinutes } from "@/features/map/server";
import { resolveHandle } from "@/lib/agent/handles";
import {
  type BuildPlanRequestInput,
  buildPlanRequest,
  type RequestItem,
  type RequestPlace,
  travelPairs,
} from "@/lib/optimizer/build-plan-request";
import { getOptimizerClient, type OptimizerClient } from "@/lib/optimizer/client";
import { findPlaces } from "@/lib/optimizer/find-places";
import { AppError } from "@/lib/reliability";
import { defineTool, type RunContext } from "../define-tool";

/** Enough cached places per category for the builder to rank and cut to 6 after diet and hours. */
const PLACES_PER_CATEGORY = 30;

const fail = (what: string, cause: unknown) => new AppError("internal", `Couldn't read the trip's ${what}.`, { retryable: true, cause });

/**
 * Saves the group's stated constraints before planning (design §2.1). Each update is one upsert
 * with the same columns for every row, so a field an update doesn't mention keeps its value.
 */
async function saveConstraints(ctx: RunContext, updates: ConstraintUpdate[], memberIds: string[]): Promise<void> {
  for (const update of updates) {
    const targets = update.member_handle === "all" ? memberIds : [resolveHandle(ctx.handles, update.member_handle, "M")];
    const fields = {
      ...(update.budget_cents === undefined ? {} : { budget_cents: update.budget_cents }),
      ...(update.dietary === undefined ? {} : { dietary: update.dietary }),
      ...(update.interests === undefined ? {} : { interests: update.interests }),
    };
    if (Object.keys(fields).length === 0) continue;
    const rows = targets.map((member_id) => ({ trip_id: ctx.tripId, member_id, set_by_member_id: ctx.actorMemberId, ...fields }));
    const { error } = await ctx.admin
      .from("member_constraints")
      .upsert(rows, { onConflict: "member_id", defaultToNull: false });
    if (error) throw new AppError("internal", "Couldn't save the group's constraints.", { retryable: true, cause: error });
  }
}

/**
 * Everything the request builder reads about the trip: its time zone, the live items (with who
 * goes, the chosen place and price, and a booking's confirmed start), and each member's constraints.
 */
async function loadTrip(ctx: RunContext) {
  const { admin, tripId } = ctx;
  const [trip, items, attendees, bookings, constraints] = await Promise.all([
    admin.from("trips").select("timezone").eq("id", tripId).single(),
    admin
      .from("itinerary_items")
      .select("id, slot_key, label, category, starts_at, ends_at, together, status, pinned, position, chosen_option_id")
      .eq("trip_id", tripId)
      .not("status", "in", "(cancelled,superseded)")
      .order("starts_at")
      .order("position"),
    admin.from("item_attendees").select("item_id, member_id").eq("trip_id", tripId),
    admin.from("bookings").select("item_id, details").eq("trip_id", tripId).eq("status", "confirmed"),
    admin.from("member_constraints").select("member_id, budget_cents, dietary, interests").eq("trip_id", tripId),
  ]);
  if (trip.error) throw fail("details", trip.error);
  if (items.error) throw fail("itinerary", items.error);
  if (attendees.error) throw fail("attendees", attendees.error);
  if (bookings.error) throw fail("bookings", bookings.error);
  if (constraints.error) throw fail("constraints", constraints.error);

  const chosenIds = items.data.flatMap((i) => (i.chosen_option_id ? [i.chosen_option_id] : []));
  const chosen = chosenIds.length > 0 ? await admin.from("item_options").select("id, place_id, price_cents").in("id", chosenIds) : { data: [], error: null };
  if (chosen.error) throw fail("options", chosen.error);
  const options = new Map(chosen.data.map((o) => [o.id, o]));
  const bookedAt = new Map(
    bookings.data.flatMap((b) => {
      const startsAt = (b.details as { starts_at?: unknown } | null)?.starts_at;
      return typeof startsAt === "string" ? [[b.item_id, startsAt] as const] : [];
    }),
  );

  const requestItems: (RequestItem & { label: string })[] = items.data.map((item) => {
    const option = item.chosen_option_id ? options.get(item.chosen_option_id) : undefined;
    return {
      ...item,
      attendee_ids: attendees.data.filter((a) => a.item_id === item.id).map((a) => a.member_id),
      place_id: option?.place_id ?? null,
      price_cents: option?.price_cents ?? null,
      booked_starts_at: bookedAt.get(item.id) ?? null,
    };
  });
  return { timezone: trip.data.timezone, items: requestItems, constraints: constraints.data };
}

/** Candidate places for every category still open, plus the places booked or pinned items go to. */
async function loadPlaces(ctx: RunContext, items: RequestItem[], interests: string[]): Promise<RequestPlace[]> {
  const open = items.filter((i) => !i.pinned && i.status !== "booked");
  const categories = [...new Set(open.map((i) => PlaceCategory.parse(i.category)))];
  const fixedIds = [...new Set(items.flatMap((i) => (i.place_id && (i.pinned || i.status === "booked") ? [i.place_id] : [])))];
  const [candidates, fixed] = await Promise.all([
    Promise.all(categories.map((category) => findPlaces({ category, tags: interests, limit: PLACES_PER_CATEGORY }, ctx.admin))),
    fixedIds.length > 0
      ? ctx.admin.from("places").select("id, name, category, rating, tags, dietary_tags, hours, raw").in("id", fixedIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (fixed.error) throw fail("places", fixed.error);
  const byId = new Map<string, RequestPlace>();
  for (const place of [...candidates.flat(), ...fixed.data.map((p) => ({ ...p, rating: p.rating === null ? null : Number(p.rating) }))]) {
    byId.set(place.id, place);
  }
  return [...byId.values()];
}

/** `{member:<uuid>}` tokens from the optimizer become display names before anyone reads them. */
function withNames(reasons: string[], names: Map<string, string>): string[] {
  return reasons.map((reason) => reason.replace(/\{member:([0-9a-f-]+)\}/g, (_, id: string) => names.get(id) ?? "A member"));
}

export interface PlanDayDeps {
  /** The optimizer; tests pass a double (AI-201). The product always calls FastAPI. */
  optimizer?: () => OptimizerClient;
}

/**
 * `plan_day` (design §2.1): saves constraint updates, plans the earliest 3 open slots (or the named
 * ones) with the optimizer, with booked neighbors as pinned context and travel from the route cache
 * or a straight-line estimate, and writes the plan through `applyPlan`. AI-209 adds splits,
 * reasoning, and routes; AI-210 adds re-planning.
 */
export function createPlanDayTool(deps: PlanDayDeps = {}) {
  return defineTool({
    name: "plan_day",
    description:
      "Plan the day with the optimizer: score options for up to 3 open itinerary slots, including split plans where members branch off and meet again, and post a plan card the group discusses in comments. Put any budget, dietary, or interest changes the group mentions in constraint_updates. Use mode \"replan\" after a booking changes the day. Never invent times or prices; the card carries them.",
    input: PlanDayInput,
    handler: async (input, ctx): Promise<ToolResult> => {
      if (input.mode !== "initial") {
        throw new AppError("invalid_input", "Re-planning isn't available yet. Use mode \"initial\" on open slots.");
      }
      const { admin } = ctx;
      const members = await admin.from("trip_members").select("id, display_name").eq("trip_id", ctx.tripId).order("sort_order");
      if (members.error) throw fail("members", members.error);
      const memberIds = members.data.map((m) => m.id);

      await saveConstraints(ctx, input.constraint_updates ?? [], memberIds);
      const wanted = input.item_handles?.map((handle) => resolveHandle(ctx.handles, handle, "I"));

      const trip = await loadTrip(ctx);
      const interests = [...new Set(trip.constraints.flatMap((c) => c.interests))];
      const base: BuildPlanRequestInput = {
        requestId: ctx.toolCallId,
        mode: input.mode,
        timezone: trip.timezone,
        members: members.data,
        constraints: trip.constraints,
        items: trip.items,
        places: await loadPlaces(ctx, trip.items, interests),
        travel: [],
        planItemIds: wanted,
      };
      const draft = buildPlanRequest(base);
      const plannedKeys = new Set(draft.slots.filter((s) => !s.pinned).map((s) => s.key));
      const planned = trip.items.filter((i) => plannedKeys.has(i.slot_key));
      if (planned.length === 0) {
        throw new AppError("conflict", "There are no open slots to plan. Every slot is decided, booked, or pinned.");
      }
      const closed = planned.find((item) => item.status !== "tbd" && item.status !== "proposing");
      if (closed) throw new AppError("conflict", `The ${closed.slot_key} slot is ${closed.status}, so it can't be planned again.`);
      const empty = draft.slots.find((slot) => slot.candidates.length === 0);
      if (empty) throw new AppError("conflict", `There are no priced places to suggest for ${empty.key} yet.`);

      const pairs = travelPairs(draft.slots);
      const minutes = await travelMinutes(pairs, { admin });
      const request = buildPlanRequest({
        ...base,
        travel: pairs.map((p) => ({ from_place_id: p.from, to_place_id: p.to, minutes: minutes.get(`${p.from}:${p.to}`) ?? 0 })),
      });

      const response = await (deps.optimizer ?? getOptimizerClient)().plan(request);
      const names = new Map(members.data.map((m) => [m.id, m.display_name]));
      if (response.plans.length === 0) {
        const reasons = withNames(response.infeasible_reasons, names);
        throw new AppError("conflict", `No plan fits. ${reasons.join(" ") || "The constraints rule out every option."}`.slice(0, 600));
      }

      const result = await applyPlan({
        tripId: ctx.tripId,
        actorMemberId: ctx.actorMemberId,
        runId: ctx.runId,
        toolCallId: ctx.toolCallId,
        mode: input.mode,
        request,
        response: { ...response, infeasible_reasons: withNames(response.infeasible_reasons, names) },
        itemsBySlot: Object.fromEntries(planned.map((i) => [i.slot_key, i.id])),
        reasoning: {},
      });
      return { ok: true, summary: result.summary, card_message_id: result.cardMessageId };
    },
  });
}

export const planDayTool = createPlanDayTool();

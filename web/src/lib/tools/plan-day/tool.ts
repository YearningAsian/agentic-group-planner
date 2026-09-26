import "server-only";
import { PlaceCategory, PlanDayInput, type SlotSummary, type ToolResult } from "@agp/shared";
import { applyPlan, type PlanResultText, reasoningKey } from "@/features/itinerary/server";
import { ensureRoutes, legKey, type RouteLeg, travelMinutes } from "@/features/map/server";
import { addHandle, type HandleTable, resolveHandle } from "@/lib/agent/handles";
import {
  type BuildPlanRequestInput,
  buildPlanRequest,
  type RequestItem,
  type RequestPlace,
  travelPairs,
} from "@/lib/optimizer/build-plan-request";
import { checkPlanResponse } from "@/lib/optimizer/check-response";
import { getOptimizerClient, type OptimizerClient, type PlannerResponse, type PlanRequest } from "@/lib/optimizer/client";
import { findPlaces } from "@/lib/optimizer/find-places";
import { formatUsd } from "@/lib/money";
import { minutesFor } from "@/lib/providers/routing";
import { AppError } from "@/lib/reliability";
import { defineTool, type RunContext } from "../define-tool";
import { optionReasoning } from "./reasoning";

/** Enough cached places per category for the builder to rank and cut to 6 after diet and hours. */
const PLACES_PER_CATEGORY = 30;
const SUMMARY_MAX = 600;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const fail = (what: string, cause: unknown) => new AppError("internal", `Couldn't read the trip's ${what}.`, { retryable: true, cause });

interface Member {
  id: string;
  display_name: string;
}

/** A constraint update with its members resolved, so a bad handle fails before anything is written. */
interface ResolvedUpdate {
  targets: string[];
  fields: { budget_cents?: number; dietary?: string[]; interests?: string[] };
}

/**
 * Saves the group's stated constraints before planning (design §2.1). Each update is one upsert
 * with the same columns for every row, so a field an update doesn't mention keeps its value.
 */
async function saveConstraints(ctx: RunContext, updates: ResolvedUpdate[]): Promise<void> {
  for (const { targets, fields } of updates) {
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

/**
 * Member IDs become display names before anyone reads a reason: the engines write `{member:<uuid>}`
 * tokens (design §2.2), and a bare member ID is replaced too, so no ID ever reaches the card or model.
 */
function withNames(reasons: string[], names: Map<string, string>): string[] {
  return reasons.map((reason) =>
    reason
      .replace(/\{member:([0-9a-f-]+)\}/gi, (_, id: string) => names.get(id.toLowerCase()) ?? "A member")
      .replace(UUID, (id) => names.get(id.toLowerCase()) ?? id),
  );
}

/** "Person 1", "Person 1 and Person 4", "Person 1, Person 2, and Person 3". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/**
 * The legs a plan uses, for the route cache and the reasoning: every member's walk or drive from
 * one slot's stop to the next in the rank-1 plan, and from each group's previous stop to each of its
 * options.
 */
function planLegs(request: PlanRequest, response: PlannerResponse) {
  const plan = response.plans.find((p) => p.rank === 1)!;
  const placeOf = (slotKey: string | undefined, memberId: string) =>
    plan.assignments.find((a) => a.slot_key === slotKey)?.groups.find((g) => g.member_ids.includes(memberId))?.place_id;
  const keys = request.slots.map((s) => s.key);
  const pairs: { from: string; to: string }[] = [];
  keys.forEach((key, i) => {
    if (i === 0) return;
    for (const member of request.members) {
      const from = placeOf(keys[i - 1], member.id);
      const to = placeOf(key, member.id);
      if (from && to) pairs.push({ from, to });
    }
  });
  /** A group's previous stop: where its first member was in the slot before. */
  const previous = (slotKey: string, memberIds: string[]) => {
    const i = keys.indexOf(slotKey);
    return i > 0 ? placeOf(keys[i - 1], memberIds[0]!) : undefined;
  };
  for (const slot of response.slot_options) {
    for (const group of slot.groups) {
      const from = previous(slot.slot_key, group.member_ids);
      if (from) for (const option of group.options) pairs.push({ from, to: option.place_id });
    }
  }
  return { pairs, previous };
}

/**
 * The ToolResult summary (≤ 600 characters; design §2.1): each planned slot with its handle, time,
 * who goes where, and exact prices, the split named as one, then what couldn't be met. Alternatives
 * are dropped first when it runs long, so the chosen plan and the unmet constraints always fit.
 */
function planSummary(input: {
  slots: SlotSummary[];
  handleOf: (id: string) => string;
  names: Map<string, string>;
  everyone: number;
  timezone: string;
  infeasible: string[];
}): string {
  const clock = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const price = (cents: number) => (cents === 0 ? "free" : formatUsd(cents));
  const who = (ids: string[]) => (ids.length === input.everyone ? "everyone" : listNames(ids.map((id) => input.names.get(id) ?? "A member")));
  const render = (withAlternatives: boolean) => {
    const lines = input.slots.map((slot) => {
      const time = `${slot.label} ${clock(slot.starts_at)}–${clock(slot.ends_at)}`;
      const groups = slot.groups.map((group) => {
        const [top, ...rest] = group.options;
        const head = `${who(group.member_ids)} at ${input.handleOf(top!.option_id)} ${top!.name} (${price(top!.price_cents)}) [${input.handleOf(group.item_id)}]`;
        const others = rest.map((o) => `${input.handleOf(o.option_id)} ${o.name} (${price(o.price_cents)})`).join(", ");
        return withAlternatives && others ? `${head}, or ${others}` : head;
      });
      return slot.groups.length > 1 ? `${time} is split: ${groups.join("; ")}` : `${time}: ${groups[0]}`;
    });
    const unmet = input.infeasible.length > 0 ? ` Couldn't meet: ${input.infeasible.join(" ")}` : "";
    return `Posted a plan card for the group to discuss. ${lines.join(". ")}.${unmet}`;
  };
  const full = render(true);
  if (full.length <= SUMMARY_MAX) return full;
  const short = render(false);
  return short.length <= SUMMARY_MAX ? short : `${short.slice(0, SUMMARY_MAX - 1)}…`;
}

export interface PlanDayDeps {
  /** The optimizer; tests pass a double (AI-201). The product always calls FastAPI. */
  optimizer?: () => OptimizerClient;
}

/**
 * `plan_day` (design §2.1). It resolves every handle first, so a bad one changes nothing; saves the
 * constraint updates; plans the earliest 3 open slots (or the named ones) with the optimizer, with
 * booked or pinned neighbors as context and travel from the route cache or a straight-line estimate;
 * checks the answer against the request; fills the route cache for the chosen legs; writes each
 * option's reasoning from its facts; and applies the plan through `applyPlan`, which gives a split
 * slot's second group its own sibling item. New items and options get handles. AI-210 adds re-planning.
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
      const memberIds = members.data.map((m: Member) => m.id);

      // Every handle resolves before anything is written.
      const wanted = input.item_handles?.map((handle) => resolveHandle(ctx.handles, handle, "I"));
      const pinnedIds = new Set(input.pinned_item_handles?.map((handle) => resolveHandle(ctx.handles, handle, "I")));
      const updates: ResolvedUpdate[] = (input.constraint_updates ?? []).map((update) => ({
        targets: update.member_handle === "all" ? memberIds : [resolveHandle(ctx.handles, update.member_handle, "M")],
        fields: {
          ...(update.budget_cents === undefined ? {} : { budget_cents: update.budget_cents }),
          ...(update.dietary === undefined ? {} : { dietary: update.dietary }),
          ...(update.interests === undefined ? {} : { interests: update.interests }),
        },
      }));

      await saveConstraints(ctx, updates);

      const trip = await loadTrip(ctx);
      const interests = [...new Set(trip.constraints.flatMap((c) => c.interests))];
      // Items the model pinned for this run are planned around, like booked ones.
      const items = trip.items.map((item) => (pinnedIds.has(item.id) ? { ...item, pinned: true } : item));
      const places = await loadPlaces(ctx, items, interests);
      const base: BuildPlanRequestInput = {
        requestId: ctx.toolCallId,
        mode: input.mode,
        timezone: trip.timezone,
        members: members.data,
        constraints: trip.constraints,
        items,
        places,
        travel: [],
        planItemIds: wanted,
      };
      const draft = buildPlanRequest(base);
      const plannedKeys = new Set(draft.slots.filter((s) => !s.pinned).map((s) => s.key));
      const planned = items.filter((i) => plannedKeys.has(i.slot_key));
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
        travel: pairs.map((p) => ({ from_place_id: p.from, to_place_id: p.to, minutes: minutes.get(legKey(p.from, p.to)) ?? 0 })),
      });

      const answer = await (deps.optimizer ?? getOptimizerClient)().plan(request);
      checkPlanResponse(request, answer);
      const names = new Map(members.data.map((m: Member) => [m.id, m.display_name]));
      const response = { ...answer, infeasible_reasons: withNames(answer.infeasible_reasons, names) };
      if (response.plans.length === 0) {
        throw new AppError("conflict", `No plan fits. ${response.infeasible_reasons.join(" ") || "The constraints rule out every option."}`.slice(0, SUMMARY_MAX));
      }

      // Real routes for the legs the plan uses (the map draws them), and each option's reasoning from facts.
      const legs = planLegs(request, response);
      const routes: Map<string, RouteLeg> = await ensureRoutes(legs.pairs, { admin });
      const placeById = new Map(places.map((p) => [p.id, p]));
      const byMember = new Map(trip.constraints.map((c) => [c.member_id, c]));
      const reasoning: Record<string, string> = {};
      for (const slot of response.slot_options) {
        const candidates = request.slots.find((s) => s.key === slot.slot_key)!.candidates;
        for (const group of slot.groups) {
          const from = legs.previous(slot.slot_key, group.member_ids);
          for (const option of group.options) {
            const place = placeById.get(option.place_id);
            const leg = from ? routes.get(legKey(from, option.place_id)) : undefined;
            reasoning[reasoningKey(slot.slot_key, group.member_ids, option.place_id)] = optionReasoning({
              place: { tags: place?.tags ?? [], rating: place?.rating ?? null },
              priceCents: candidates.find((c) => c.place_id === option.place_id)!.price_cents,
              members: group.member_ids.map((id) => ({ name: names.get(id) ?? "A member", interests: byMember.get(id)?.interests ?? [] })),
              travel: from === option.place_id ? { minutes: 0, mode: "walking" } : leg ? { minutes: minutesFor(leg.durationS), mode: leg.mode } : null,
            });
          }
        }
      }

      // Handles go on a copy until the write lands, so a failed write leaves the run's table as it was.
      const handles: HandleTable = { ...ctx.handles };
      const describe = (slots: SlotSummary[]): PlanResultText => {
        const added: Record<string, string> = {};
        const known = new Set(Object.values(handles));
        const handleOf = (kind: "I" | "O", id: string, label: string) => {
          const isNew = !known.has(id);
          const handle = addHandle(handles, kind, id);
          if (isNew) added[handle] = label;
          return handle;
        };
        const labels = new Map<string, string>();
        for (const slot of slots) {
          for (const group of slot.groups) {
            const who = group.member_ids
              .map((id) => names.get(id) ?? "A member")
              .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
              .join(", ");
            labels.set(group.item_id, handleOf("I", group.item_id, `${slot.label} (${who})`));
            for (const option of group.options) labels.set(option.option_id, handleOf("O", option.option_id, option.name));
          }
        }
        const summary = planSummary({
          slots,
          handleOf: (id) => labels.get(id) ?? "?",
          names,
          everyone: memberIds.length,
          timezone: trip.timezone,
          infeasible: response.infeasible_reasons,
        });
        return { summary, ...(Object.keys(added).length > 0 ? { handles: added } : {}) };
      };

      const result = await applyPlan({
        tripId: ctx.tripId,
        actorMemberId: ctx.actorMemberId,
        runId: ctx.runId,
        toolCallId: ctx.toolCallId,
        mode: input.mode,
        request,
        response,
        itemsBySlot: Object.fromEntries(planned.map((i) => [i.slot_key, i.id])),
        reasoning,
        optionsPerSlot: input.options_per_slot,
        describe,
      });
      if (!result.replayed) Object.assign(ctx.handles, handles);
      return {
        ok: true,
        summary: result.summary,
        ...(result.handles ? { handles: result.handles } : {}),
        card_message_id: result.cardMessageId,
      };
    },
  });
}

export const planDayTool = createPlanDayTool();

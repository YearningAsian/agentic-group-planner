import "server-only";
import { randomUUID } from "node:crypto";
import { PlanCard, type PlanChange, type SlotSummary } from "@agp/shared";
import { checkPlanResponse } from "@/lib/optimizer/check-response";
import type { PlannerResponse, PlanRequest } from "@/lib/optimizer/client";
import { formatUsd } from "@/lib/money";
import { AppError, rpcError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";

/** What the model reads back from a plan: its summary, and handles for the rows the plan created. */
export interface PlanResultText {
  summary: string;
  handles?: Record<string, string>;
}

export interface ApplyPlanInput {
  tripId: string;
  /** The joined member the write is on behalf of (the run's requester). */
  actorMemberId: string;
  runId: string;
  toolCallId: string;
  mode: "initial" | "replan";
  /** What was sent to the optimizer: it carries each candidate's price. */
  request: PlanRequest;
  response: PlannerResponse;
  /** The items being planned, keyed by slot_key. A split slot's second group gets a new sibling. */
  itemsBySlot: Record<string, string>;
  /** Server-written reasoning per option, keyed by `reasoningKey(slotKey, memberIds, placeId)`. */
  reasoning: Record<string, string>;
  /** Options kept per group, 2–3 (`plan_day`'s `options_per_slot`). Default 3. */
  optionsPerSlot?: number;
  /**
   * Writes the ToolResult's summary and handles from the slots as they'll be stored (new IDs
   * included), before the write, so the tool call stores exactly what the model reads.
   */
  describe?: (slots: SlotSummary[]) => PlanResultText;
}

export interface ApplyPlanResult extends PlanResultText {
  cardMessageId: string;
  changes: PlanChange[];
  /** The slots as written; empty when the call had already succeeded (a replay). */
  slots: SlotSummary[];
  replayed: boolean;
}

const MAX_OPTIONS = 3;

/** The reasoning key for one option of one group: a place can be an option for both sides of a split. */
export function reasoningKey(slotKey: string, memberIds: readonly string[], placeId: string): string {
  return `${slotKey}:${[...memberIds].sort().join(",")}:${placeId}`;
}

/** The summary when the caller doesn't write one: each group's options with their exact prices. */
function plainSummary(slots: SlotSummary[]): PlanResultText {
  const lines = slots.map(
    (s) => `${s.label}: ${s.groups.map((g) => g.options.map((o) => `${o.name} (${formatUsd(o.price_cents)})`).join(", ")).join(" | ")}`,
  );
  return { summary: `Posted a plan card for the group to discuss. ${lines.join("; ")}.`.slice(0, 600) };
}

/**
 * Writes the optimizer's rank-1 plan (design §2.1): options and attendees for each planned item,
 * items to `voting`, and one plan card, in one transaction (`apply_plan`). A split slot keeps its
 * item for the group with the earliest member and gets a sibling item, with the same slot_key, for
 * the other. Prices come only from the request's candidates; an answer naming anything else is
 * refused, never priced at $0. Safe to call twice for the same tool call.
 */
export async function applyPlan(input: ApplyPlanInput): Promise<ApplyPlanResult> {
  if (input.mode !== "initial") throw new AppError("invalid_input", "Re-planning isn't available yet.");
  checkPlanResponse(input.request, input.response);
  const plan = input.response.plans.find((p) => p.rank === 1);
  if (!plan) throw new AppError("domain_rule", "The optimizer found no plan that fits.");
  const keep = input.optionsPerSlot ?? MAX_OPTIONS;

  const admin = getAdminClient();
  const itemIds = Object.values(input.itemsBySlot);
  const { data: items, error: itemError } = await admin
    .from("itinerary_items")
    .select("id, slot_key, label, starts_at, ends_at")
    .eq("trip_id", input.tripId)
    .in("id", itemIds)
    .order("starts_at");
  if (itemError) throw rpcError(itemError);
  if (items.length !== itemIds.length) throw new AppError("not_permitted", "An item belongs to another trip.");

  const prices = new Map<string, number>();
  for (const slot of input.request.slots) {
    for (const c of slot.candidates) prices.set(`${slot.key}:${c.place_id}`, c.price_cents);
  }
  const placeIds = [...new Set(input.response.slot_options.flatMap((s) => s.groups.flatMap((g) => g.options.map((o) => o.place_id))))];
  const { data: places, error: placeError } = await admin.from("places").select("id, name").in("id", placeIds);
  if (placeError) throw rpcError(placeError);
  const names = new Map(places.map((p) => [p.id, p.name]));
  const memberOrder = new Map(input.request.members.map((m, i) => [m.id, i]));
  const firstMember = (ids: string[]) => Math.min(...ids.map((id) => memberOrder.get(id) ?? Infinity));

  const slots: SlotSummary[] = [];
  const payloadSlots = [];
  for (const item of items) {
    const options = input.response.slot_options.find((s) => s.slot_key === item.slot_key);
    if (!options || options.groups.length === 0 || options.groups.length > 2) {
      throw new AppError("internal", `The planner's answer has no usable groups for ${item.slot_key}.`, { retryable: false });
    }
    // The group with the earliest member keeps the existing item, so a re-run lays out the same way.
    const groups = [...options.groups].sort((a, b) => firstMember(a.member_ids) - firstMember(b.member_ids));
    const summaryGroups: SlotSummary["groups"] = [];
    for (const [index, group] of groups.entries()) {
      const itemId = index === 0 ? item.id : randomUUID();
      const snapshots = [...group.options]
        .sort((a, b) => a.rank - b.rank)
        .slice(0, keep)
        .map((o) => {
          const price = prices.get(`${item.slot_key}:${o.place_id}`);
          if (price === undefined) {
            throw new AppError("internal", `No price for an option in ${item.slot_key}.`, { retryable: false });
          }
          return {
            option_id: randomUUID(),
            place_id: o.place_id,
            name: names.get(o.place_id) ?? "Unknown place",
            price_cents: price,
            score: o.score,
            breakdown: { preference: o.preference, cost: o.cost, travel: o.travel, fairness: o.fairness },
            reasoning: input.reasoning[reasoningKey(item.slot_key, group.member_ids, o.place_id)] ?? `${formatUsd(price)} per person`,
          };
        });
      summaryGroups.push({ item_id: itemId, member_ids: group.member_ids, options: snapshots });
      payloadSlots.push({
        item_id: itemId,
        ...(index === 0 ? {} : { sibling_of: item.id }),
        member_ids: group.member_ids,
        options: snapshots.map((s, i) => ({
          id: s.option_id,
          place_id: s.place_id,
          rank: i + 1,
          price_cents: s.price_cents,
          score: s.score,
          score_breakdown: { ...s.breakdown, per_member: {} },
          reasoning: s.reasoning,
          source: input.response.engine,
        })),
      });
    }
    slots.push({ slot_key: item.slot_key, label: item.label, starts_at: item.starts_at, ends_at: item.ends_at, groups: summaryGroups });
  }

  const card = PlanCard.parse({
    card_type: "plan",
    mode: input.mode,
    engine: input.response.engine,
    solve_ms: input.response.solve_ms,
    applied_plan_rank: 1,
    plans: input.response.plans.map(({ rank, total_score, fairness, split, member_scores }) => ({
      rank,
      total_score,
      fairness,
      split,
      member_scores,
    })),
    slots,
    ...(input.response.infeasible_reasons.length > 0 ? { infeasible: input.response.infeasible_reasons } : {}),
  });

  const text = (input.describe ?? plainSummary)(slots);
  const summary = text.summary.slice(0, 600);
  const { data, error } = await admin.rpc("apply_plan", {
    payload: {
      trip_id: input.tripId,
      actor_member_id: input.actorMemberId,
      run_id: input.runId,
      tool_call_id: input.toolCallId,
      mode: input.mode,
      slots: payloadSlots,
      card,
      result_summary: summary,
      ...(text.handles ? { result_handles: text.handles } : {}),
    },
  });
  if (error) throw rpcError(error);
  const result = data as {
    card_message_id: string;
    changes: PlanChange[];
    replayed: boolean;
    result?: { summary?: string; handles?: Record<string, string> };
  };
  if (result.replayed) {
    // The rows written the first time are the real ones; this call's new IDs were never stored.
    return {
      cardMessageId: result.card_message_id,
      changes: result.changes,
      summary: result.result?.summary ?? summary,
      ...(result.result?.handles ? { handles: result.result.handles } : {}),
      slots: [],
      replayed: true,
    };
  }
  return { cardMessageId: result.card_message_id, changes: result.changes, summary, ...(text.handles ? { handles: text.handles } : {}), slots, replayed: false };
}

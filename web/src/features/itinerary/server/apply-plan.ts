import "server-only";
import { randomUUID } from "node:crypto";
import { PlanCard, type PlanChange, type SlotSummary } from "@agp/shared";
import type { components } from "@agp/shared/optimizer";
import { AppError } from "@/lib/reliability";
import { getAdminClient } from "@/lib/supabase/admin";

type PlanRequest = components["schemas"]["PlanRequest"];
type PlanResponse = components["schemas"]["PlanResponse"];

export interface ApplyPlanInput {
  tripId: string;
  /** The joined member the write is on behalf of (the run's requester). */
  actorMemberId: string;
  runId: string;
  toolCallId: string;
  mode: "initial" | "replan";
  /** What was sent to the optimizer: it carries each candidate's price. */
  request: PlanRequest;
  response: PlanResponse;
  /** The items being planned, keyed by slot_key. */
  itemsBySlot: Record<string, string>;
  /** Server-written reasoning per option, keyed `${slotKey}:${placeId}`. */
  reasoning: Record<string, string>;
}

export interface ApplyPlanResult {
  cardMessageId: string;
  changes: PlanChange[];
}

const MAX_OPTIONS = 3;

function dollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

/** Maps a raised `code: message` exception from a write function to an AppError. */
export function rpcError(error: { message: string; code?: string }): AppError {
  const match = /^(not_permitted|conflict|invalid_input):\s*(.*)$/.exec(error.message);
  if (match) return new AppError(match[1] as "not_permitted" | "conflict" | "invalid_input", match[2] ?? error.message);
  if (error.code === "42501") return new AppError("not_permitted", error.message);
  return new AppError("internal", "The database write failed.", { retryable: true, cause: error });
}

/**
 * Writes the optimizer's rank-1 plan: options and attendees for each planned item, items to
 * `voting`, and one plan card, in one transaction (`apply_plan`). Safe to call twice for the same
 * tool call. This version handles merged slots on an initial plan.
 */
export async function applyPlan(input: ApplyPlanInput): Promise<ApplyPlanResult> {
  if (input.mode !== "initial") throw new AppError("invalid_input", "Re-planning isn't available yet.");
  const plan = input.response.plans.find((p) => p.rank === 1);
  if (!plan) throw new AppError("domain_rule", "The optimizer found no plan that fits.");

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

  const slots: SlotSummary[] = [];
  const payloadSlots = [];
  for (const item of items) {
    const options = input.response.slot_options.find((s) => s.slot_key === item.slot_key);
    if (!options || options.groups.length !== 1) {
      throw new AppError("invalid_input", `Split plans aren't available yet (slot ${item.slot_key}).`);
    }
    const group = options.groups[0]!;
    const snapshots = [...group.options]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_OPTIONS)
      .map((o) => {
        const key = `${item.slot_key}:${o.place_id}`;
        const price = prices.get(key) ?? 0;
        return {
          option_id: randomUUID(),
          place_id: o.place_id,
          name: names.get(o.place_id) ?? "Unknown place",
          price_cents: price,
          score: o.score,
          breakdown: { preference: o.preference, cost: o.cost, travel: o.travel, fairness: o.fairness },
          reasoning: input.reasoning[key] ?? `${dollars(price)} per person`,
        };
      });
    slots.push({
      slot_key: item.slot_key,
      label: item.label,
      starts_at: item.starts_at,
      ends_at: item.ends_at,
      groups: [{ item_id: item.id, member_ids: group.member_ids, options: snapshots }],
    });
    payloadSlots.push({
      item_id: item.id,
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

  const summary = slots
    .map((s) => `${s.label}: ${s.groups[0]!.options.map((o) => `${o.name} (${dollars(o.price_cents)})`).join(", ")}`)
    .join("; ");
  const { data, error } = await admin.rpc("apply_plan", {
    payload: {
      trip_id: input.tripId,
      actor_member_id: input.actorMemberId,
      run_id: input.runId,
      tool_call_id: input.toolCallId,
      mode: input.mode,
      slots: payloadSlots,
      card,
      result_summary: `Posted a plan card for the group to vote on. ${summary}.`.slice(0, 600),
    },
  });
  if (error) throw rpcError(error);
  const result = data as { card_message_id: string; changes: PlanChange[] };
  return { cardMessageId: result.card_message_id, changes: result.changes };
}

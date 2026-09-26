import "server-only";
import { type ConstraintUpdate, PlanDayInput, type ToolResult } from "@agp/shared";
import { applyPlan } from "@/features/itinerary/server";
import { resolveHandle } from "@/lib/agent/handles";
import { buildPlanRequest, MAX_PLANNED_SLOTS } from "@/lib/optimizer/build-plan-request";
import { getOptimizerClient, type OptimizerClient } from "@/lib/optimizer/client";
import { AppError } from "@/lib/reliability";
import { defineTool, type RunContext } from "../define-tool";

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

/** `{member:<uuid>}` tokens from the optimizer become display names before anyone reads them. */
function withNames(reasons: string[], names: Map<string, string>): string[] {
  return reasons.map((reason) => reason.replace(/\{member:([0-9a-f-]+)\}/g, (_, id: string) => names.get(id) ?? "A member"));
}

export interface PlanDayDeps {
  /** The optimizer; tests pass a double (AI-201). The product always calls FastAPI. */
  optimizer?: () => OptimizerClient;
}

/**
 * `plan_day`, first version (AI-107): saves constraint updates, plans the earliest 3 open slots
 * (or the named ones) with the optimizer, and writes the plan through `applyPlan`. AI-209 adds
 * splits, reasoning, and routes; AI-210 adds re-planning.
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
      let query = admin
        .from("itinerary_items")
        .select("id, slot_key, category, starts_at, ends_at, together, status, pinned")
        .eq("trip_id", ctx.tripId)
        .order("starts_at");
      query = wanted ? query.in("id", wanted) : query.eq("status", "tbd").eq("pinned", false).limit(MAX_PLANNED_SLOTS);
      const items = await query;
      if (items.error) throw fail("itinerary", items.error);
      if (items.data.length === 0) {
        throw new AppError("conflict", "There are no open slots to plan. Every slot is decided, booked, or pinned.");
      }
      const closed = items.data.find((item) => item.status !== "tbd" && item.status !== "proposing");
      if (closed) throw new AppError("conflict", `The ${closed.slot_key} slot is ${closed.status}, so it can't be planned again.`);

      const [constraints, places] = await Promise.all([
        admin.from("member_constraints").select("member_id, budget_cents, dietary, interests").eq("trip_id", ctx.tripId),
        admin
          .from("places")
          .select("id, name, category, rating, tags, dietary_tags, raw")
          .in("category", [...new Set(items.data.map((i) => i.category))])
          .order("rating", { ascending: false, nullsFirst: false })
          .limit(200),
      ]);
      if (constraints.error) throw fail("constraints", constraints.error);
      if (places.error) throw fail("places", places.error);
      const byMember = new Map(constraints.data.map((c) => [c.member_id, c]));

      const request = buildPlanRequest({
        requestId: ctx.toolCallId,
        mode: input.mode,
        members: memberIds.map((id) => ({
          id,
          budget_cents: byMember.get(id)?.budget_cents ?? null,
          dietary: byMember.get(id)?.dietary ?? [],
          interests: byMember.get(id)?.interests ?? [],
        })),
        items: items.data,
        places: places.data.map((p) => ({ ...p, rating: p.rating === null ? null : Number(p.rating) })),
      });
      const empty = request.slots.find((slot) => slot.candidates.length === 0);
      if (empty) throw new AppError("conflict", `There are no priced places to suggest for ${empty.key} yet.`);

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
        itemsBySlot: Object.fromEntries(items.data.map((i) => [i.slot_key, i.id])),
        reasoning: {},
      });
      return { ok: true, summary: result.summary, card_message_id: result.cardMessageId };
    },
  });
}

export const planDayTool = createPlanDayTool();

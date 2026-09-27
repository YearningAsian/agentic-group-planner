import "server-only";
import { ProposePurchaseInput, type ToolResult } from "@agp/shared";
import { createMandate, mandateSummary } from "@/features/payments/server";
import { resolveHandle } from "@/lib/agent/handles";
import { AppError } from "@/lib/reliability";
import { defineTool } from "../define-tool";

export interface ProposePurchaseDeps {
  /** The mandate write; tests pass a double. */
  createMandate?: typeof createMandate;
}

/**
 * `propose_purchase` (design §2.1): asks the group to approve paying for a decided item. The model
 * names only the item (and optionally another of its options, a cap percent, and a note); the
 * server quotes, splits, and caps every amount. One mandate per tool call, keyed
 * `mandate:{run_id}:{tool_call_id}`.
 */
export function createProposePurchaseTool(deps: ProposePurchaseDeps = {}) {
  return defineTool({
    name: "propose_purchase",
    description:
      "Ask the group to approve paying for a decided item. The server gets the quote and splits it into per-member shares with a cap; never state or supply an amount yourself. Only a decided item can be paid for; if it isn't decided, ask the group to confirm it in the comments first.",
    input: ProposePurchaseInput,
    handler: async (input, ctx): Promise<ToolResult> => {
      const itemId = resolveHandle(ctx.handles, input.item_handle, "I");
      const namedOption = input.option_handle ? resolveHandle(ctx.handles, input.option_handle, "O") : null;

      const { data: item, error } = await ctx.admin
        .from("itinerary_items")
        .select("status, chosen_option_id, label")
        .eq("id", itemId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (error) throw new AppError("internal", "Couldn't read the item.", { retryable: true, cause: error });
      if (!item) throw new AppError("unknown_handle", `There's no ${input.item_handle} on this trip.`);
      if (item.status === "booked") throw new AppError("conflict", `${item.label} is already booked.`);
      if (item.status !== "decided") {
        throw new AppError(
          "invalid_input",
          `${item.label} is ${item.status}, not decided. Ask the group to confirm it in the comments first; only a decided item can be paid for.`,
        );
      }
      const optionId = namedOption ?? item.chosen_option_id;
      if (!optionId) throw new AppError("invalid_input", `${item.label} has no chosen option to pay for.`);

      const result = await (deps.createMandate ?? createMandate)({
        ctx,
        itemId,
        optionId,
        capPercent: input.cap_percent,
        note: input.note,
        idempotencyKey: `mandate:${ctx.runId}:${ctx.toolCallId}`,
      });
      return { ok: true, summary: mandateSummary(result.card), card_message_id: result.cardMessageId };
    },
  });
}

export const proposePurchaseTool = createProposePurchaseTool();

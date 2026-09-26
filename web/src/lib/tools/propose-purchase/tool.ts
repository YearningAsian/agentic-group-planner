import "server-only";
import { ProposePurchaseInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const proposePurchaseTool = defineTool({
  name: "propose_purchase",
  description:
    "Ask the group to approve paying for a decided item. The server gets the quote and splits it into per-member shares with a cap; never state or supply an amount yourself.",
  input: ProposePurchaseInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("propose_purchase"),
});

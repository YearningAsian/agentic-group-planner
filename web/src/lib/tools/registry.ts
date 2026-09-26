import "server-only";
import type { ToolName } from "@agp/shared";
import type { ToolDefinition } from "./define-tool";
import { searchPlacesTool } from "./search-places/tool";
import { planDayTool } from "./plan-day/tool";
import { updateItemTool } from "./update-item/tool";
import { summarizeTool } from "./summarize/tool";
import { proposePurchaseTool } from "./propose-purchase/tool";

/** The agent's 5 tools, keyed by name. The runner hands exactly these to the model. */
export const toolRegistry = {
  search_places: searchPlacesTool,
  plan_day: planDayTool,
  update_item: updateItemTool,
  summarize: summarizeTool,
  propose_purchase: proposePurchaseTool,
} satisfies Record<ToolName, ToolDefinition>;

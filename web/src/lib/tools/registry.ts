import "server-only";
import type { ToolName } from "@agp/shared";
import type { ToolDefinition } from "./define-tool";
import { searchPlacesTool } from "./search-places/tool";
import { planDayTool } from "./plan-day/tool";
import { updateItemTool } from "./update-item/tool";
import { summarizeTool } from "./summarize/tool";
import { proposePurchaseTool } from "./propose-purchase/tool";
import { callRestaurantTool } from "./call-restaurant/tool";
import { generateRecapTool } from "./generate-recap/tool";

/** The agent's 7 tools, keyed by name. The runner hands exactly these to the model. */
export const toolRegistry = {
  search_places: searchPlacesTool,
  plan_day: planDayTool,
  update_item: updateItemTool,
  summarize: summarizeTool,
  propose_purchase: proposePurchaseTool,
  call_restaurant: callRestaurantTool,
  generate_recap: generateRecapTool,
} satisfies Record<ToolName, ToolDefinition>;

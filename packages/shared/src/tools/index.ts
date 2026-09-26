import type { z } from "zod";
import type { ToolName } from "../enums";
import { PlanDayInput } from "./plan-day";
import { ProposePurchaseInput } from "./propose-purchase";
import { SearchPlacesInput } from "./search-places";
import { SummarizeInput } from "./summarize";
import { UpdateItemInput } from "./update-item";

export * from "./plan-day";
export * from "./propose-purchase";
export * from "./search-places";
export * from "./summarize";
export * from "./update-item";

/** Each tool's input schema, keyed by tool name. */
export const toolInputs = {
  search_places: SearchPlacesInput,
  plan_day: PlanDayInput,
  update_item: UpdateItemInput,
  summarize: SummarizeInput,
  propose_purchase: ProposePurchaseInput,
} as const satisfies Record<ToolName, z.ZodType>;

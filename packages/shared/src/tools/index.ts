import type { z } from "zod";
import type { ToolName } from "../enums";
import { CallRestaurantInput } from "./call-restaurant";
import { GenerateRecapInput } from "./generate-recap";
import { PlanDayInput } from "./plan-day";
import { ProposePurchaseInput } from "./propose-purchase";
import { SearchPlacesInput } from "./search-places";
import { SummarizeInput } from "./summarize";
import { UpdateItemInput } from "./update-item";

export * from "./call-restaurant";
export * from "./generate-recap";
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
  call_restaurant: CallRestaurantInput,
  generate_recap: GenerateRecapInput,
} as const satisfies Record<ToolName, z.ZodType>;

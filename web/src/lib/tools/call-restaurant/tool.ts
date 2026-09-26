import "server-only";
import { CallRestaurantInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const callRestaurantTool = defineTool({
  name: "call_restaurant",
  description:
    "Phone a restaurant to book the dinner item for the group, with a preferred time inside a window of at most 3 hours. The call runs in the background; the outcome arrives later.",
  input: CallRestaurantInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("call_restaurant"),
});

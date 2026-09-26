import "server-only";
import { UpdateItemInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const updateItemTool = defineTool({
  name: "update_item",
  description:
    "Change one itinerary item: add a slot, mark it TBD, swap to another option (organizer only), ask for alternatives, or set who attends. Refer to items, options, and members by handle (I#, O#, M#).",
  input: UpdateItemInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("update_item"),
});

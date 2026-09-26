import "server-only";
import { SearchPlacesInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const searchPlacesTool = defineTool({
  name: "search_places",
  description:
    "Search for places (restaurants, activities, and more) for the trip, optionally filtered by category, dietary needs, and price level. Pass a P# or I# handle as `near` to bias toward a place or stop.",
  input: SearchPlacesInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("search_places"),
});

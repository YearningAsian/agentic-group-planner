import "server-only";
import { GenerateRecapInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const generateRecapTool = defineTool({
  name: "generate_recap",
  description:
    "Write the trip recap from the stops and photos after the trip, in the requested tone.",
  input: GenerateRecapInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("generate_recap"),
});

import "server-only";
import { SummarizeInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const summarizeTool = defineTool({
  name: "summarize",
  description:
    "Summarize the plan for the whole group, for one member, or for the next stop, including the money committed so far. The server computes every number.",
  input: SummarizeInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("summarize"),
});

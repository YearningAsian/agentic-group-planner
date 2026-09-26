import "server-only";
import { PlanDayInput } from "@agp/shared";
import { defineTool, notBuiltResult } from "../define-tool";

export const planDayTool = defineTool({
  name: "plan_day",
  description:
    "Plan the day with the optimizer: score options for up to 3 open itinerary slots, including split plans where members branch off and meet again, and post a plan card the group discusses in comments. Put any budget, dietary, or interest changes the group mentions in constraint_updates. Use mode \"replan\" after a booking changes the day. Never invent times or prices; the card carries them.",
  input: PlanDayInput,
  // Stub: its owner replaces the handler.
  handler: async () => notBuiltResult("plan_day"),
});

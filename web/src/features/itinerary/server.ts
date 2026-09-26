import "server-only";
import { notBuilt } from "@/lib/not-built";

// Server entry point for the itinerary feature.
export { type ApplyPlanInput, type ApplyPlanResult, applyPlan } from "./server/apply-plan";

// Stubs until their owners build them.
export const castVote = notBuilt("castVote");
export const supersedeItem = notBuilt("supersedeItem");

import "server-only";
import { notBuilt } from "@/lib/not-built";

// Server entry point.
export { mandateSummary } from "./lib/mandate-summary";
export { createMandate, type CreateMandateInput, type CreateMandateResult } from "./server/create-mandate";

// Stubs until the feature's owner builds them.
export const approveHold = notBuilt("approveHold");
export const declineHold = notBuilt("declineHold");
export const coverShortfall = notBuilt("coverShortfall");
export const finalizeMandate = notBuilt("finalizeMandate");
export const handlePriceChange = notBuilt("handlePriceChange");
export const onPlaceholderClaimed = notBuilt("onPlaceholderClaimed");

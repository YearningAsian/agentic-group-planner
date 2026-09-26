import "server-only";
import { notBuilt } from "@/lib/not-built";

// Server entry point.
export { mandateSummary } from "./lib/mandate-summary";
export { type ApproveHoldResult, approveHold, approverFor, type PaymentsDeps } from "./server/approve-hold";
export { createMandate, type CreateMandateInput, type CreateMandateResult } from "./server/create-mandate";
export { handleStripeEvent, type StripeEventOutcome } from "./server/handle-stripe-event";

// Stubs until the feature's owner builds them.
export const declineHold = notBuilt("declineHold");
export const coverShortfall = notBuilt("coverShortfall");
export const finalizeMandate = notBuilt("finalizeMandate");
export const handlePriceChange = notBuilt("handlePriceChange");
export const onPlaceholderClaimed = notBuilt("onPlaceholderClaimed");

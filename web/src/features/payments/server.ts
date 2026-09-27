import "server-only";
import { notBuilt } from "@/lib/not-built";

// Server entry point.
export { mandateSummary } from "./lib/mandate-summary";
export { type ApproveHoldResult, approveHold, approverFor, type PaymentsDeps } from "./server/approve-hold";
export { ensurePayer } from "./server/ensure-payer";
export { cancelByOrganizer } from "./server/cancel-by-organizer";
export { coverShortfall } from "./server/cover-shortfall";
export { createMandate, type CreateMandateInput, type CreateMandateResult } from "./server/create-mandate";
export { declineHold } from "./server/decline-hold";
export { expireMandates } from "./server/expire-mandates";
export { type FinalizeDeps, finalizeMandate } from "./server/finalize-mandate";
export { handleStripeEvent, type StripeEventOutcome } from "./server/handle-stripe-event";
export { onPlaceholderClaimed } from "./server/on-placeholder-claimed";
export { openCheckoutMandate, type CheckoutHold, type OpenCheckoutMandate } from "./server/open-checkout-mandate";
export { settleFrontedShare } from "./server/settle-fronted-share";

// Stubs until the feature's owner builds them.
export const handlePriceChange = notBuilt("handlePriceChange");

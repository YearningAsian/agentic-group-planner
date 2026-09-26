import { z } from "zod";
import { HoldStatus, MandateStatus } from "../enums";

/** `/api/mandates/:id/*` path parameters. */
export const MandateParams = z.object({ id: z.uuid() });
export type MandateParams = z.infer<typeof MandateParams>;

// The bodies are empty on purpose: the server decides every amount, and the organizer's approval
// always includes the shares they front. Strict, so a client that sends an amount learns it can't.

/** `POST /api/mandates/:id/approve` */
export const ApproveBody = z.strictObject({});
export type ApproveBody = z.infer<typeof ApproveBody>;
export const ApproveResponse = z.object({
  holds: z.array(z.object({ hold_id: z.uuid(), status: HoldStatus })),
});
export type ApproveResponse = z.infer<typeof ApproveResponse>;

/** `POST /api/mandates/:id/decline` */
export const DeclineBody = z.strictObject({});
export type DeclineBody = z.infer<typeof DeclineBody>;
export const DeclineResponse = z.object({ hold_status: HoldStatus, mandate_status: MandateStatus });
export type DeclineResponse = z.infer<typeof DeclineResponse>;

/** `POST /api/mandates/:id/cover` (organizer only) */
export const CoverBody = z.strictObject({});
export type CoverBody = z.infer<typeof CoverBody>;
export const CoverResponse = z.object({ mandate_status: MandateStatus });
export type CoverResponse = z.infer<typeof CoverResponse>;

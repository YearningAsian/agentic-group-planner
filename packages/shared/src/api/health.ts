import { z } from "zod";

/** One dependency's state. The route never fails on a dependency, so a monitor sees which one is down. */
export const HealthStatus = z.enum(["ok", "error"]);
export type HealthStatus = z.infer<typeof HealthStatus>;

/** `GET /api/health` (design §2.4): always 200 while the web app runs. */
export const HealthResponse = z.object({
  /** Answering at all means the web app is up. */
  web: z.literal("ok"),
  db: HealthStatus,
  optimizer: HealthStatus,
});
export type HealthResponse = z.infer<typeof HealthResponse>;

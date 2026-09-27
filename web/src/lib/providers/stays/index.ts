import "server-only";
import type { ServerEnv } from "@/lib/env/server";
import { getServerEnv } from "@/lib/env/server";
import { AppError } from "@/lib/reliability/app-error";
import { mockStaysProvider } from "./mock";
import { createDuffelStays } from "./real";
import type { StaysProvider } from "./types";

export type * from "./types";
export { createDuffelStays } from "./real";

export function getStaysProvider(
  env: Pick<ServerEnv, "STAYS_PROVIDER" | "DUFFEL_ACCESS_TOKEN"> = getServerEnv(),
): StaysProvider {
  if (env.STAYS_PROVIDER !== "real") return mockStaysProvider;
  if (!env.DUFFEL_ACCESS_TOKEN) {
    throw new AppError("internal", "DUFFEL_ACCESS_TOKEN is required when STAYS_PROVIDER=real.");
  }
  return createDuffelStays({ token: env.DUFFEL_ACCESS_TOKEN });
}

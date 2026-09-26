import "server-only";
import { AppError } from "@/lib/reliability";

// Write functions' raised codes map the same way everywhere (lib/reliability).
export { rpcError } from "@/lib/reliability";

/** A failed read on the payments path: transient as far as the caller can tell. */
export function readError(error: unknown, what = "the trip"): AppError {
  return new AppError("internal", `Couldn't read ${what}.`, { retryable: true, cause: error });
}

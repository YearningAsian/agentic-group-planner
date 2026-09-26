import "server-only";
import { NotBuiltError } from "@/lib/not-built";

/** Claims and runs one queued agent run. Stub until the runner is built. */
export async function startAgentRun(runId: string): Promise<void> {
  throw new NotBuiltError(`startAgentRun(${runId})`);
}

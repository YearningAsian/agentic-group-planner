/**
 * Runs once when a server instance starts. Validating the environment here makes a bad `.env`
 * fail the boot with the full list of problems, instead of failing on some later request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv } = await import("@/lib/env/server");
    getServerEnv();
  }
}

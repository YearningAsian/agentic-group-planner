import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const expireMandates = vi.fn();
// Obviously fake and at least 16 characters, like the real one.
const TOKEN = "x".repeat(24);
const env: { CRON_SECRET?: string } = { CRON_SECRET: TOKEN };

vi.mock("@/features/payments/server", () => ({ expireMandates }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env }));

const { GET } = await import("./route");

function call(authorization?: string) {
  const headers = authorization === undefined ? undefined : { authorization };
  return GET(new Request("http://localhost/api/cron/expire-mandates", { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  env.CRON_SECRET = TOKEN;
  expireMandates.mockResolvedValue({ expired: ["00000000-0000-4000-8000-0000000000e1"], failed: [] });
});

describe("GET /api/cron/expire-mandates", () => {
  it("401 without the bearer token, and expiry doesn't run", async () => {
    const response = await call();
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthenticated");
    expect(expireMandates).not.toHaveBeenCalled();
  });

  it("401 for a wrong token, a token without Bearer, or when CRON_SECRET isn't set", async () => {
    expect((await call("Bearer not-the-secret")).status).toBe(401);
    expect((await call(TOKEN)).status).toBe(401);
    env.CRON_SECRET = undefined;
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(expireMandates).not.toHaveBeenCalled();
  });

  it("200 with the token runs expiry once and returns the expired and failed mandate ids", async () => {
    const response = await call(`Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: ["00000000-0000-4000-8000-0000000000e1"], failed: [] });
    expect(expireMandates).toHaveBeenCalledTimes(1);
  });

  it("a failed run returns the error body, so the cron log shows it", async () => {
    expireMandates.mockRejectedValue(new AppError("provider_unavailable", "Stripe did not release the hold."));
    const response = await call(`Bearer ${TOKEN}`);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatchObject({ code: "provider_unavailable", retryable: true });
  });
});

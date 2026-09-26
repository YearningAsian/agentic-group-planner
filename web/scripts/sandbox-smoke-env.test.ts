import { describe, expect, it } from "vitest";
import { assertSandboxSmokeEnv } from "./sandbox-smoke-env";

const mock = { PAYMENTS_PROVIDER: "mock", STAYS_PROVIDER: "mock" };

describe("sandbox smoke provider guard", () => {
  it("runs on mock payments without credentials", () => {
    expect(() => assertSandboxSmokeEnv(mock)).not.toThrow();
  });

  it("allows Stripe test mode with its webhook signing secret", () => {
    expect(() => assertSandboxSmokeEnv({
      ...mock,
      PAYMENTS_PROVIDER: "real",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
    })).not.toThrow();
  });

  it("requires both test-mode Stripe credentials before a real smoke run", () => {
    expect(() => assertSandboxSmokeEnv({ ...mock, PAYMENTS_PROVIDER: "real" })).toThrow(/test Stripe key/);
    expect(() => assertSandboxSmokeEnv({
      ...mock,
      PAYMENTS_PROVIDER: "real",
      STRIPE_SECRET_KEY: "sk_test_example",
    })).toThrow(/webhook signing secret/);
  });

  it("refuses live Stripe and non-test Duffel credentials even under mock flags", () => {
    expect(() => assertSandboxSmokeEnv({ ...mock, STRIPE_SECRET_KEY: "sk_live_example" })).toThrow(/live Stripe key/);
    expect(() => assertSandboxSmokeEnv({ ...mock, DUFFEL_ACCESS_TOKEN: "duffel_live_example" })).toThrow(/non-test Duffel token/);
  });

  it("refuses an unsupported payments provider", () => {
    expect(() => assertSandboxSmokeEnv({ ...mock, PAYMENTS_PROVIDER: "other" })).toThrow(/PAYMENTS_PROVIDER/);
  });
});

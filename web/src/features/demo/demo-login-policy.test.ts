import { describe, expect, it } from "vitest";
import { demoLoginRefusal } from "./demo-login-policy";

const open = { demoMode: true, vercelEnv: undefined, allowDemoLogin: false, seedSecret: "s" };

describe("demoLoginRefusal", () => {
  it("allows dev mode off Vercel production", () => {
    expect(demoLoginRefusal(open)).toBeNull();
    expect(demoLoginRefusal({ ...open, vercelEnv: "preview" })).toBeNull();
  });

  it("refuses when demo mode is off, even with ALLOW_DEMO_LOGIN", () => {
    expect(demoLoginRefusal({ ...open, demoMode: false })).toBe("demo_mode_off");
    expect(demoLoginRefusal({ ...open, demoMode: false, allowDemoLogin: true })).toBe("demo_mode_off");
  });

  it("refuses on a production deploy unless ALLOW_DEMO_LOGIN is set", () => {
    expect(demoLoginRefusal({ ...open, vercelEnv: "production" })).toBe("production");
    expect(demoLoginRefusal({ ...open, vercelEnv: "production", allowDemoLogin: true })).toBeNull();
  });

  it("refuses without DEMO_SEED_SECRET, since no password can be derived", () => {
    expect(demoLoginRefusal({ ...open, seedSecret: undefined })).toBe("no_secret");
  });
});

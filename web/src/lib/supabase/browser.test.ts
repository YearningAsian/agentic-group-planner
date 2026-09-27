import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("tryGetBrowserClient", () => {
  it("returns null when public env is missing (SSG / Vercel preview without NEXT_PUBLIC_*)", async () => {
    const { tryGetBrowserClient } = await import("./browser");
    expect(tryGetBrowserClient()).toBeNull();
  });

  it("returns a client when public env is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    const { tryGetBrowserClient } = await import("./browser");
    expect(tryGetBrowserClient()?.from).toEqual(expect.any(Function));
  });
});

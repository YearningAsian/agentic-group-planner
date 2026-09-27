/**
 * @vitest-environment node
 */
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("SupabaseProvider", () => {
  it("renders during SSG when public env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "");

    const { SupabaseProvider: FreshProvider } = await import("./provider");
    const html = renderToString(
      <FreshProvider>
        <span>marketing shell</span>
      </FreshProvider>,
    );
    expect(html).toContain("marketing shell");
  });

  it("still creates the browser client when public env is present", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const { SupabaseProvider: FreshProvider } = await import("./provider");
    expect(() =>
      renderToString(
        <FreshProvider>
          <span>ready</span>
        </FreshProvider>,
      ),
    ).not.toThrow();
  });
});

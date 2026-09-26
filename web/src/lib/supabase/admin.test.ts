import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminClient, MissingSecretKeyError } from "./admin";

afterEach(() => vi.unstubAllEnvs());

describe("admin client", () => {
  it("getAdminClient throws a named error when SUPABASE_SECRET_KEY is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(() => getAdminClient()).toThrow(MissingSecretKeyError);
    expect(() => getAdminClient()).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it("returns a client once the key is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const client = getAdminClient();
    expect(typeof client.from).toBe("function");
    expect(getAdminClient()).toBe(client);
  });
});

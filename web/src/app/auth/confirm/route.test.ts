import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { verifyOtp } }) }));

const { GET } = await import("./route");

const ORIGIN = "http://localhost:3000";

function confirm(query: Record<string, string>) {
  const url = new URL("/auth/confirm", ORIGIN);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return GET(new NextRequest(url));
}

function location(response: Response): URL {
  const header = response.headers.get("location");
  if (!header) throw new Error(`expected a redirect, got ${response.status}`);
  return new URL(header, ORIGIN);
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyOtp.mockResolvedValue({ data: { user: { id: "user-1" }, session: {} }, error: null });
});

describe("GET /auth/confirm", () => {
  it("/auth/confirm verifies token_hash and redirects to next; a bad or used link goes to the error landing (/login?error=link once the login page exists)", async () => {
    const ok = await confirm({ token_hash: "hash-1", type: "email", next: "/trips" });
    expect(ok.status).toBeGreaterThanOrEqual(300);
    expect(ok.status).toBeLessThan(400);
    expect(location(ok).href).toBe(`${ORIGIN}/trips`);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "email" });
    // The response sets the session cookie, so no cache may keep it.
    expect(ok.headers.get("cache-control")).toContain("no-store");

    // A used or expired link: Supabase rejects the hash.
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Email link is invalid or has expired" } });
    const used = await confirm({ token_hash: "hash-1", type: "email", next: "/trips" });
    expect(location(used).href).toBe(`${ORIGIN}/login?error=link`);

    // A link with no hash, or another OTP type, never reaches Supabase.
    verifyOtp.mockClear();
    expect(location(await confirm({ type: "email", next: "/trips" })).href).toBe(`${ORIGIN}/login?error=link`);
    expect(location(await confirm({ token_hash: "hash-2", type: "recovery" })).href).toBe(`${ORIGIN}/login?error=link`);
    expect(verifyOtp).not.toHaveBeenCalled();

    // A thrown client error is a bad link too, not a 500.
    verifyOtp.mockRejectedValue(new TypeError("fetch failed"));
    expect(location(await confirm({ token_hash: "hash-3", type: "email" })).href).toBe(`${ORIGIN}/login?error=link`);
  });

  it("/auth/confirm ignores a next that isn't a same-origin path", async () => {
    const offOrigin = [
      "https://evil.test/trips",
      "//evil.test/trips",
      "/\\evil.test/trips",
      "\\\\evil.test",
      "/\t/evil.test",
      "javascript:alert(1)",
      "evil.test/trips",
      "trips",
      "",
    ];
    for (const next of offOrigin) {
      const target = location(await confirm({ token_hash: "hash-1", type: "email", next }));
      expect(target.origin, next).toBe(ORIGIN);
      expect(target.pathname, next).toBe("/trips");
    }

    // A same-origin path keeps its query, such as an invite page or a filtered lane view.
    const invite = location(await confirm({ token_hash: "hash-1", type: "email", next: "/invite/abc?join=1" }));
    expect(invite.href).toBe(`${ORIGIN}/invite/abc?join=1`);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getServerClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

const { GET } = await import("./route");

const ORIGIN = "http://localhost:3000";

function callback(query: Record<string, string>) {
  const url = new URL("/auth/callback", ORIGIN);
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
  exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
});

describe("GET /auth/callback", () => {
  it("/auth/callback verifies a token hash or exchanges a code, then redirects to a safe next; a failure goes to /login?error=link", async () => {
    const hashed = await callback({ token_hash: "hash-1", type: "signup", next: "/trips" });
    expect(location(hashed).href).toBe(`${ORIGIN}/trips`);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "signup" });
    expect(hashed.headers.get("cache-control")).toContain("no-store");

    const coded = await callback({ code: "pkce-1", next: "/home" });
    expect(location(coded).href).toBe(`${ORIGIN}/home`);
    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-1");

    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "expired" } });
    expect(location(await callback({ token_hash: "bad", type: "email" })).href).toBe(`${ORIGIN}/login?error=link`);

    expect(location(await callback({ next: "https://evil.example" })).href).toBe(`${ORIGIN}/login?error=link`);
  });
});

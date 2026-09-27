import { beforeEach, describe, expect, it, vi } from "vitest";

const env = { NEXT_PUBLIC_DEMO_MODE: true, DEMO_EMAIL_DOMAIN: "demo.agp.test" };
const generateLink = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env }));
vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ auth: { admin: { generateLink } } }) }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { verifyOtp } }) }));

const { demoSignIn, demoSignInSeeded } = await import("./demo-sign-in");

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_DEMO_MODE = true;
  generateLink.mockResolvedValue({
    data: { user: { id: "user-2" }, properties: { hashed_token: "hash-2", verification_type: "magiclink" } },
    error: null,
  });
  verifyOtp.mockResolvedValue({ data: { user: { id: "user-2" }, session: {} }, error: null });
});

describe("demoSignIn", () => {
  it("demoSignIn rejects when NEXT_PUBLIC_DEMO_MODE is not true", async () => {
    env.NEXT_PUBLIC_DEMO_MODE = false;

    await expect(demoSignIn("person2@demo.agp.test")).rejects.toMatchObject({ name: "AppError", code: "not_permitted" });
    expect(generateLink).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("signs in a seeded user by verifying a server-generated magic link, with no password", async () => {
    await expect(demoSignIn("Person2@demo.agp.test")).resolves.toEqual({ userId: "user-2" });

    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "person2@demo.agp.test" });
    // The session client stores the session cookie; the admin client never holds a session.
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-2", type: "email" });
  });

  it("rejects an email outside the demo domain, so dev mode can't sign in as a real account", async () => {
    for (const email of ["someone@example.com", "person2@demo.agp.test.evil.test", "not an email"]) {
      await expect(demoSignIn(email), email).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("a failed link or verification rejects with a retryable error", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Token has expired" } });
    await expect(demoSignIn("person1@demo.agp.test")).rejects.toMatchObject({ code: "internal", retryable: true });
  });

  it("signs in Person 1 on the demo domain", async () => {
    await expect(demoSignInSeeded("person1")).resolves.toEqual({ userId: "user-2" });
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "person1@demo.agp.test" });
  });
});

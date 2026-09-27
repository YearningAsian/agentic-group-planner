import { beforeEach, describe, expect, it, vi } from "vitest";

const updateProfile = vi.fn();
const getUser = vi.fn();
const client = { auth: { getUser } };

vi.mock("@/features/profile/server", () => ({ updateProfile }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => client }));

const { PATCH } = await import("./route");

const id = "00000000-0000-4000-8000-0000000000a4";

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/profile", {
      method: "PATCH",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  updateProfile.mockResolvedValue({ profile: { id, display_name: "Person 4", avatar_url: null } });
});

describe("PATCH /api/profile", () => {
  it("a name over 80 characters returns 400", async () => {
    const response = await patch({ display_name: "x".repeat(81) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "invalid_input", message: expect.stringContaining("display_name"), retryable: false },
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("rejects a blank name, a non-web avatar, server-owned fields, and an empty patch", async () => {
    for (const body of [{ display_name: "  " }, { avatar_url: "javascript:alert(1)" }, { stripe_customer_id: "cus_1" }, {}, "{not json"]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("updates with the caller's session and returns { profile }; without a session it's a 401", async () => {
    const response = await patch({ display_name: " Person 4 ", avatar_url: null });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { id, display_name: "Person 4", avatar_url: null } });
    expect(updateProfile).toHaveBeenCalledWith(client, { displayName: "Person 4", avatarUrl: null });

    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const signedOut = await patch({ display_name: "Person 4" });
    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error.code).toBe("unauthenticated");
  });
});

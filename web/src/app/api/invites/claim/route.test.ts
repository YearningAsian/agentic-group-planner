import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const claimInvite = vi.fn();
const afterClaim = vi.fn();
const getUser = vi.fn();
const client = { auth: { getUser } };

vi.mock("@/features/invite/server", () => ({ claimInvite, afterClaim }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => client }));

const { POST } = await import("./route");

const token = "AbCdEfGhIjKlMnOpQrS_-";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/invites/claim", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-4" } }, error: null });
  afterClaim.mockResolvedValue({ cardMessageId: "card", pendingMandateIds: [] });
});

describe("POST /api/invites/claim", () => {
  it("claims with the caller's session and returns { trip_slug, member_id }", async () => {
    claimInvite.mockResolvedValue({ tripSlug: "abcdefghijk", memberId: "00000000-0000-4000-8000-000000000004" });

    const response = await post({ token });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ trip_slug: "abcdefghijk", member_id: "00000000-0000-4000-8000-000000000004" });
    expect(claimInvite).toHaveBeenCalledWith(client, token);
    expect(afterClaim).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000004");
  });

  it("a failed after-claim step still returns the committed claim", async () => {
    claimInvite.mockResolvedValue({ tripSlug: "abcdefghijk", memberId: "00000000-0000-4000-8000-000000000004" });
    afterClaim.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await post({ token });

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("a malformed body or token is a 400 with the error shape", async () => {
    for (const body of ["{not json", {}, { token: "short" }, { token: `${token}x` }]) {
      const response = await post(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await response.json()).error).toMatchObject({ code: "invalid_input", retryable: false });
    }
    expect(claimInvite).not.toHaveBeenCalled();
    expect(afterClaim).not.toHaveBeenCalled();
  });

  it("without a session it returns 401, and a used invite returns 409 with its message", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const signedOut = await post({ token });
    expect(signedOut.status).toBe(401);
    expect((await signedOut.json()).error.code).toBe("unauthenticated");
    expect(claimInvite).not.toHaveBeenCalled();

    getUser.mockResolvedValue({ data: { user: { id: "user-5" } }, error: null });
    claimInvite.mockRejectedValue(new AppError("conflict", "This invite was already used."));
    const used = await post({ token });
    expect(used.status).toBe(409);
    expect(await used.json()).toEqual({ error: { code: "conflict", message: "This invite was already used.", retryable: false } });
  });
});

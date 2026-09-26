import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const approveHold = vi.fn();
const approverFor = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/payments/server", () => ({ approveHold, approverFor }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));

const { POST } = await import("./route");

const mandateId = "00000000-0000-4000-8000-0000000000e1";

function approve(body: string | undefined = "{}", id = mandateId) {
  return POST(new Request(`http://localhost/api/mandates/${id}/approve`, { method: "POST", body }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "profile-1" } }, error: null });
  approverFor.mockResolvedValue("member-1");
});

describe("POST /api/mandates/:id/approve", () => {
  it("403 for a non-member", async () => {
    approverFor.mockRejectedValue(new AppError("not_permitted", "You're not a member of this trip."));
    const response = await approve();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toEqual({ code: "not_permitted", message: "You're not a member of this trip.", retryable: false });
    expect(approverFor).toHaveBeenCalledWith({ mandateId, profileId: "profile-1" });
    expect(approveHold).not.toHaveBeenCalled();
  });

  it("401 without a session, 400 for a body that names anything or a bad id", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await approve()).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: "profile-1" } }, error: null });
    expect((await approve(JSON.stringify({ amount_cents: 9600 }))).status).toBe(400);
    expect((await approve("{}", "not-a-uuid")).status).toBe(400);
    expect(approveHold).not.toHaveBeenCalled();
  });

  it("approves as the caller's member and returns the holds; an empty body counts as {}", async () => {
    approveHold.mockResolvedValue({ holds: [{ hold_id: "00000000-0000-4000-8000-0000000000f1", status: "authorized" }], satisfied: false });
    const response = await approve("");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ holds: [{ hold_id: "00000000-0000-4000-8000-0000000000f1", status: "authorized" }] });
    expect(approveHold).toHaveBeenCalledWith({ mandateId, memberId: "member-1" });
  });
});

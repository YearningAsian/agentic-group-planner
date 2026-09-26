import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const declineHold = vi.fn();
const approverFor = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/payments/server", () => ({ declineHold, approverFor }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));

const { POST } = await import("./route");

const mandateId = "00000000-0000-4000-8000-0000000000e1";

function decline(body: string | undefined = "{}", id = mandateId) {
  return POST(new Request(`http://localhost/api/mandates/${id}/decline`, { method: "POST", body }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "profile-2" } }, error: null });
  approverFor.mockResolvedValue("member-2");
});

describe("POST /api/mandates/:id/decline", () => {
  it("declines as the caller's member and returns both statuses", async () => {
    declineHold.mockResolvedValue({ hold_status: "declined", mandate_status: "partially_declined" });
    const response = await decline("");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hold_status: "declined", mandate_status: "partially_declined" });
    expect(declineHold).toHaveBeenCalledWith({ mandateId, memberId: "member-2" });
  });

  it("401 without a session, 403 for a non-member, 400 for a body that names anything", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await decline()).status).toBe(401);
    approverFor.mockRejectedValueOnce(new AppError("not_permitted", "Only members of this trip can approve its purchases."));
    expect((await decline()).status).toBe(403);
    expect((await decline(JSON.stringify({ reason: "too pricey" }))).status).toBe(400);
    expect(declineHold).not.toHaveBeenCalled();
  });

  it("a member who already approved gets 409", async () => {
    declineHold.mockRejectedValue(new AppError("conflict", "You've already approved this purchase."));
    expect((await decline()).status).toBe(409);
  });
});

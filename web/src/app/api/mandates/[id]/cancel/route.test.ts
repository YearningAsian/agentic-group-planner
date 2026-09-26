import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const cancelByOrganizer = vi.fn();
const approverFor = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/payments/server", () => ({ cancelByOrganizer, approverFor }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));

const { POST } = await import("./route");

const mandateId = "00000000-0000-4000-8000-0000000000e1";

function cancel(body: string | undefined = "{}") {
  return POST(new Request(`http://localhost/api/mandates/${mandateId}/cancel`, { method: "POST", body }), {
    params: Promise.resolve({ id: mandateId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "profile-1" } }, error: null });
  approverFor.mockResolvedValue("member-1");
});

describe("POST /api/mandates/:id/cancel", () => {
  it("cancels as the caller's member and returns cancelled", async () => {
    cancelByOrganizer.mockResolvedValue({ mandate_status: "cancelled" });
    const response = await cancel();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mandate_status: "cancelled" });
    expect(cancelByOrganizer).toHaveBeenCalledWith({ mandateId, memberId: "member-1" });
  });

  it("403 for a member who isn't the organizer, 409 once booking has started", async () => {
    cancelByOrganizer.mockRejectedValueOnce(new AppError("not_permitted", "Only the organizer can cancel a purchase."));
    expect((await cancel()).status).toBe(403);
    cancelByOrganizer.mockRejectedValueOnce(new AppError("conflict", "This purchase is already being booked."));
    expect((await cancel()).status).toBe(409);
  });
});

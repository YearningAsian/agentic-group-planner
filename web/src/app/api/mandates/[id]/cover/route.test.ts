import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const coverShortfall = vi.fn();
const approverFor = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/payments/server", () => ({ coverShortfall, approverFor }));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));

const { POST } = await import("./route");

const mandateId = "00000000-0000-4000-8000-0000000000e1";

function cover(body: string | undefined = "{}") {
  return POST(new Request(`http://localhost/api/mandates/${mandateId}/cover`, { method: "POST", body }), {
    params: Promise.resolve({ id: mandateId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "profile-1" } }, error: null });
  approverFor.mockResolvedValue("member-1");
});

describe("POST /api/mandates/:id/cover", () => {
  it("covers as the caller's member and returns the mandate status", async () => {
    coverShortfall.mockResolvedValue({ mandate_status: "captured" });
    const response = await cover();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mandate_status: "captured" });
    expect(coverShortfall).toHaveBeenCalledWith({ mandateId, memberId: "member-1" });
  });

  it("403 for a member who isn't the organizer, 422 for a declined card, 400 for an amount", async () => {
    coverShortfall.mockRejectedValueOnce(new AppError("not_permitted", "Only the organizer can cover a shortfall."));
    expect((await cover()).status).toBe(403);
    coverShortfall.mockRejectedValueOnce(new AppError("domain_rule", "Your card was declined, so the shortfall isn't covered."));
    expect((await cover()).status).toBe(422);
    coverShortfall.mockClear();
    expect((await cover(JSON.stringify({ amount_cents: 4800 }))).status).toBe(400);
    expect(coverShortfall).not.toHaveBeenCalled();
  });
});

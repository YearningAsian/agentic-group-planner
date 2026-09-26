import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/reliability";

const buildItineraryExport = vi.fn();
const getUser = vi.fn();

vi.mock("@/features/itinerary/server", async () => ({
  buildItineraryExport,
  toIcs: (await import("@/features/itinerary/server/build-itinerary-export")).toIcs,
}));
vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => ({ auth: { getUser } }) }));

const { GET } = await import("./route");

const tripId = "00000000-0000-4000-8000-000000000100";
const get = (query = "", id = tripId) =>
  GET(new Request(`http://localhost/api/trips/${id}/itinerary${query}`), { params: Promise.resolve({ id }) });

const itinerary = {
  trip: { id: tripId, title: "Saturday in Atlanta", city: "Atlanta", trip_date: "2026-10-03", timezone: "America/New_York" },
  member: { member_id: "00000000-0000-4000-8000-000000000002", display_name: "Person 2" },
  stops: [],
  totals: { committed_cents: 0, paid_cents: 0, to_approve: 0, status: "none" },
};

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
});

describe("GET /api/trips/:id/itinerary", () => {
  it("the download route returns 403 for a non-member", async () => {
    buildItineraryExport.mockRejectedValue(new AppError("not_permitted", "You're not a member of this trip."));
    const response = await get("?format=ics");
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("not_permitted");
  });

  it("serves the member's schedule as a calendar file", async () => {
    buildItineraryExport.mockResolvedValue(itinerary);
    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="saturday-in-atlanta-person-2\.ics"/);
    expect(await response.text()).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(buildItineraryExport).toHaveBeenCalledWith(expect.anything(), { tripId, memberId: "me" });
  });

  it("rejects a bad trip id, member, or format, and requires a session", async () => {
    expect((await get("", "not-a-uuid")).status).toBe(400);
    expect((await get("?member=someone")).status).toBe(400);
    expect((await get("?format=pdf")).status).toBe(400);
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await get()).status).toBe(401);
  });
});

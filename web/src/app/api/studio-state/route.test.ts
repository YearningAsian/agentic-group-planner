import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const maybeSingle = vi.fn();
const upsert = vi.fn();
const client = {
  auth: { getUser },
  from: vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
    upsert,
  })),
};

vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => client }));

const { GET, PUT } = await import("./route");

const id = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  maybeSingle.mockResolvedValue({ data: null, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("studio state", () => {
  it("returns an empty document when the user has not saved", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      activeTripId: null,
      trips: [],
      profile: { homeAddress: "", homeLat: null, homeLng: null },
    });
  });

  it("rejects a save when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await PUT(
      new Request("http://localhost/api/studio-state", {
        method: "PUT",
        body: JSON.stringify({
          activeTripId: null,
          trips: [],
          profile: { homeAddress: "", homeLat: null, homeLng: null },
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upserts the document under the session user, not a body id", async () => {
    const response = await PUT(
      new Request("http://localhost/api/studio-state", {
        method: "PUT",
        body: JSON.stringify({
          activeTripId: "trip-1",
          trips: [{ id: "trip-1" }],
          profile: { homeAddress: "Lisbon", homeLat: 1, homeLng: 2 },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith({
      profile_id: id,
      active_trip_id: "trip-1",
      trips: [{ id: "trip-1" }],
      profile: { homeAddress: "Lisbon", homeLat: 1, homeLng: 2 },
    });
  });
});

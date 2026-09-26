import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const profileRow = vi.fn();
const boardRow = vi.fn();
const upsertProfile = vi.fn();
const updateBoard = vi.fn();

const client = {
  auth: { getUser },
  from: vi.fn((table: string) => {
    if (table === "studio_board") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: boardRow }) }),
        update: (payload: unknown) => ({
          eq: () => updateBoard(payload),
        }),
      };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: profileRow }) }),
      upsert: upsertProfile,
    };
  }),
};

vi.mock("@/lib/supabase/server", () => ({ getServerClient: async () => client }));

const { GET, PUT } = await import("./route");

const id = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  profileRow.mockResolvedValue({ data: null, error: null });
  boardRow.mockResolvedValue({ data: null, error: null });
  upsertProfile.mockResolvedValue({ error: null });
  updateBoard.mockResolvedValue({ error: null });
});

describe("studio state", () => {
  it("returns an empty document when nothing has been saved", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      activeTripId: null,
      trips: [],
      profile: { homeAddress: "", homeLat: null, homeLng: null },
    });
  });

  it("returns the shared trips and only this user's profile", async () => {
    boardRow.mockResolvedValue({
      data: { active_trip_id: "trip-1", trips: [{ id: "trip-1", destinationQuery: "Lisbon" }] },
      error: null,
    });
    profileRow.mockResolvedValue({
      data: { profile: { homeAddress: "Home", homeLat: 1, homeLng: 2 } },
      error: null,
    });
    const response = await GET();
    expect(await response.json()).toEqual({
      activeTripId: "trip-1",
      trips: [{ id: "trip-1", destinationQuery: "Lisbon" }],
      profile: { homeAddress: "Home", homeLat: 1, homeLng: 2 },
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
    expect(updateBoard).not.toHaveBeenCalled();
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it("writes trips to the shared board and the profile under the session user", async () => {
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
    expect(updateBoard).toHaveBeenCalledWith({
      active_trip_id: "trip-1",
      trips: [{ id: "trip-1" }],
    });
    expect(upsertProfile).toHaveBeenCalledWith({
      profile_id: id,
      profile: { homeAddress: "Lisbon", homeLat: 1, homeLng: 2 },
    });
  });
});

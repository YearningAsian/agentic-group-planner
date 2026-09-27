import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { previewInvite } = vi.hoisted(() => ({ previewInvite: vi.fn() }));
vi.mock("@/features/invite/server", () => ({ previewInvite }));
vi.mock("./claim-button", () => ({ ClaimButton: () => <button>Join trip</button> }));

import JoinPage from "./page";

const params = Promise.resolve({ token: "inviteToken1234567890_" });

beforeEach(() => vi.clearAllMocks());

describe("join by invite token", () => {
  it("shows only the invited lane and no internal trip ID", async () => {
    previewInvite.mockResolvedValue({
      status: "open",
      trip: { title: "Saturday in Atlanta", trip_date: "2026-10-03" },
      lane: { display_name: "Person 4", lane_color: "lane-4", stops: [{ label: "Dinner", starts: "19:00", ends: "20:30", place_name: null }] },
    });
    const html = renderToStaticMarkup(await JoinPage({ params }));
    expect(html).toContain("Saturday in Atlanta");
    expect(html).toContain("Person 4");
    expect(html).toContain("Dinner");
    expect(html).not.toContain("trip_id");
    expect(previewInvite).toHaveBeenCalledWith("inviteToken1234567890_");
  });

  it("shows the same generic result for a missing invite", async () => {
    previewInvite.mockResolvedValue({ status: "not_found" });
    expect(renderToStaticMarkup(await JoinPage({ params }))).toContain("Invite not found");
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ClaimButton } from "./claim-button";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("invite claim", () => {
  it("claims with the invite token and navigates by public slug", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trip_slug: "R9dZ7wYk2_A" }) });
    vi.stubGlobal("fetch", fetch);
    render(<ClaimButton token="inviteToken1234567890_" />);
    fireEvent.click(screen.getByRole("button", { name: "Join trip" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/trip/R9dZ7wYk2_A"));
    expect(fetch).toHaveBeenCalledWith("/api/invites/claim", expect.objectContaining({ method: "POST" }));
  });

  it("shows a sign-in message if there is no session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    render(<ClaimButton token="inviteToken1234567890_" />);
    fireEvent.click(screen.getByRole("button", { name: "Join trip" }));
    expect(await screen.findByText("Sign in, then open this invite again.")).toBeTruthy();
  });
});

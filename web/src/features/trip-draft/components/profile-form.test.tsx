import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_KEY } from "@/features/trip-draft/profile-db";
import { ProfileForm } from "./profile-form";

describe("ProfileForm", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("saves a selected suggestion with coordinates, not free text", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            suggestions: [{ label: "123 Mission St, San Francisco, CA 94105, United States", lat: 37.7935, lng: -122.396 }],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<ProfileForm debounceMs={0} />);
    await user.type(screen.getByRole("combobox", { name: /home address/i }), "mission");
    await screen.findByRole("option", { name: /123 mission st/i });
    await user.click(screen.getByRole("option", { name: /123 mission st/i }));
    await user.click(screen.getByRole("button", { name: /save address/i }));

    expect(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}")).toEqual({
      homeAddress: "123 Mission St, San Francisco, CA 94105, United States",
      homeLat: 37.7935,
      homeLng: -122.396,
    });
    expect(screen.getByText(/home address saved/i)).toBeInTheDocument();
  });

  it("does not save until a suggestion is picked", async () => {
    const user = userEvent.setup();
    render(<ProfileForm debounceMs={0} />);
    expect(screen.getByRole("button", { name: /save address/i })).toBeDisabled();
    await user.type(screen.getByRole("combobox", { name: /home address/i }), "not an address");
    expect(screen.getByRole("button", { name: /save address/i })).toBeDisabled();
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
  });
});

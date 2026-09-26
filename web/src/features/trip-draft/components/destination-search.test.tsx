import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DestinationSearch } from "./destination-search";
import type { PlaceSuggestion } from "@/lib/providers/place-suggestions/types";

function Harness({ onSelect }: { onSelect: (place: PlaceSuggestion) => void }) {
  const [value, setValue] = useState("");
  return <DestinationSearch value={value} onQueryChange={setValue} onSelect={onSelect} debounceMs={0} />;
}

describe("DestinationSearch", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists Duffel suggestions and reports the chosen IATA codes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            suggestions: [
              {
                kind: "city",
                name: "London",
                iataCode: "LON",
                lat: 51.5,
                lng: -0.12,
                airports: [
                  { iataCode: "LHR", name: "Heathrow" },
                  { iataCode: "LGW", name: "Gatwick" },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<Harness onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox", { name: /destination/i }), "lon");
    await screen.findByRole("option", { name: /london \(lon\)/i });
    await user.click(screen.getByRole("option", { name: /london \(lon\)/i }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "London",
        iataCode: "LON",
        airports: [
          { iataCode: "LHR", name: "Heathrow" },
          { iataCode: "LGW", name: "Gatwick" },
        ],
      }),
    );
  });
});

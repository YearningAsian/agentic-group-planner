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
    await screen.findByRole("option", { name: /^london$/i });
    await user.click(screen.getByRole("option", { name: /^london$/i }));

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

  it("hides airport suggestions so the picker stays on places", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            suggestions: [
              {
                kind: "city",
                name: "Lisbon",
                iataCode: "LIS",
                lat: 38.72,
                lng: -9.13,
                airports: [{ iataCode: "LIS", name: "Humberto Delgado Airport" }],
              },
              {
                kind: "airport",
                name: "Lisbon Humberto Delgado Airport",
                cityName: "Lisbon",
                iataCode: "LIS",
                lat: 38.77,
                lng: -9.13,
                airports: [{ iataCode: "LIS", name: "Lisbon Humberto Delgado Airport" }],
              },
              {
                kind: "airport",
                name: "Heathrow",
                iataCode: "LHR",
                lat: 51.47,
                lng: -0.45,
                airports: [{ iataCode: "LHR", name: "Heathrow" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<Harness onSelect={vi.fn()} />);
    await user.type(screen.getByRole("combobox", { name: /destination/i }), "lis");

    expect(await screen.findByRole("option", { name: /^lisbon$/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /heathrow/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /humberto/i })).not.toBeInTheDocument();
  });

  it("offers the city name when Duffel only returns the airport", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            suggestions: [
              {
                kind: "airport",
                name: "Lisbon Humberto Delgado Airport",
                cityName: "Lisbon",
                iataCode: "LIS",
                lat: 38.77,
                lng: -9.13,
                airports: [{ iataCode: "LIS", name: "Lisbon Humberto Delgado Airport" }],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    render(<Harness onSelect={onSelect} />);
    await user.type(screen.getByRole("combobox", { name: /destination/i }), "lis");
    await user.click(await screen.findByRole("option", { name: /^lisbon$/i }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "Lisbon", iataCode: "LIS" }));
  });
});

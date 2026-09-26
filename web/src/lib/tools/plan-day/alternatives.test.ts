import { describe, expect, it } from "vitest";
import { offerablePlaces } from "./alternatives";

const place = (id: string) => ({ id });
const item = (over: Partial<{ id: string; status: string; pinned: boolean; place_id: string | null }>) => ({
  id: "item",
  status: "voting",
  pinned: false,
  place_id: null,
  ...over,
});

describe("offerablePlaces", () => {
  it("drops the places an item already offered, so request_alternatives gets new ones", () => {
    const places = [place("cafe"), place("diner"), place("deli")];
    expect(offerablePlaces(places, [item({})], new Set(["cafe", "diner"])).map((p) => p.id)).toEqual(["deli"]);
  });

  it("keeps a booked or pinned stop's place, which rides along as context", () => {
    const places = [place("cafe"), place("aquarium")];
    const items = [item({ id: "dinner", status: "booked", place_id: "aquarium" }), item({ id: "lunch", pinned: true, place_id: "cafe" })];
    expect(offerablePlaces(places, items, new Set(["cafe", "aquarium"])).map((p) => p.id)).toEqual(["cafe", "aquarium"]);
  });

  it("with nothing excluded, every place stays", () => {
    const places = [place("cafe"), place("diner")];
    expect(offerablePlaces(places, [], undefined)).toEqual(places);
  });
});

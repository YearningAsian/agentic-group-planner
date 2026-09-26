import { describe, expect, it } from "vitest";
import { SearchStaysInput } from "./search-stays";

describe("search_stays input", () => {
  it("takes an item handle and defaults to five results", () => {
    expect(SearchStaysInput.parse({ item_handle: "I3" })).toEqual({ item_handle: "I3", max_results: 5 });
  });

  it("refuses another kind of handle and more than six results", () => {
    expect(SearchStaysInput.safeParse({ item_handle: "P3" }).success).toBe(false);
    expect(SearchStaysInput.safeParse({ item_handle: "I3", max_results: 7 }).success).toBe(false);
  });
});

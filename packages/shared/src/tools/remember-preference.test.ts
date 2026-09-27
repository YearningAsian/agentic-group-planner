import { describe, expect, it } from "vitest";
import { RememberPreferenceInput } from "./remember-preference";

describe("remember_preference input", () => {
  it("needs at least one dietary need, interest, or note", () => {
    expect(RememberPreferenceInput.safeParse({}).success).toBe(false);
    expect(RememberPreferenceInput.safeParse({ dietary: [] }).success).toBe(false);
    expect(RememberPreferenceInput.parse({ dietary: ["vegetarian"], interests: ["art"], note: "  hates early starts  " })).toEqual({
      dietary: ["vegetarian"],
      interests: ["art"],
      note: "hates early starts",
    });
  });

  it("rejects unknown diets and long or messy interests", () => {
    expect(RememberPreferenceInput.safeParse({ dietary: ["pescatarian"] }).success).toBe(false);
    expect(RememberPreferenceInput.safeParse({ interests: ["a".repeat(41)] }).success).toBe(false);
    expect(RememberPreferenceInput.safeParse({ interests: ["street-food"] }).success).toBe(false);
    expect(RememberPreferenceInput.safeParse({ note: "x".repeat(201) }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { chatCityDestination } from "./trip-draft-fixtures";

describe("chatCityDestination", () => {
  it("matches a city name to a new destination", () => {
    expect(chatCityDestination("Lisbon", null)?.id).toBe("lisbon");
  });

  it("is case- and whitespace-tolerant", () => {
    expect(chatCityDestination("  KYOTO ", null)?.id).toBe("kyoto");
  });

  it("returns null when the city is already selected", () => {
    expect(chatCityDestination("Lisbon", "lisbon")).toBeNull();
  });

  it("returns null for unknown text", () => {
    expect(chatCityDestination("show something quieter", "lisbon")).toBeNull();
  });
});

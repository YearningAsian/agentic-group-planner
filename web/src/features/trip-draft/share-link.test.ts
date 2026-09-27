import { describe, expect, it } from "vitest";
import { itineraryShareUrl, randomShareCode } from "./share-link";

describe("itinerary share links", () => {
  it("mints a short code and a public demo URL on localhost", () => {
    const code = randomShareCode();
    expect(code).toMatch(/^[a-z2-9]{6}$/);
    expect(itineraryShareUrl("http://localhost:3000", code)).toBe(`https://grouptrip.app/i/${code}`);
    expect(itineraryShareUrl("", code)).toBe(`https://grouptrip.app/i/${code}`);
  });

  it("keeps a deployed origin", () => {
    expect(itineraryShareUrl("https://demo.example.com", "k7m2qx")).toBe("https://demo.example.com/i/k7m2qx");
  });
});

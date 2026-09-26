import { describe, expect, it } from "vitest";
import { leadGuestFrom } from "./lead-guest";

describe("leadGuestFrom", () => {
  it("splits the display name at its first space and keeps the account's email and phone", () => {
    expect(leadGuestFrom({ displayName: "Ada King Lovelace", email: "ada@example.com", phone: "+14045550100" })).toEqual({
      givenName: "Ada",
      familyName: "King Lovelace",
      email: "ada@example.com",
      phoneNumber: "+14045550100",
    });
  });

  it("repeats a one-word name as the family name, because hotels need both", () => {
    expect(leadGuestFrom({ displayName: "  Cher ", email: "c@example.com", phone: "+14045550101" })).toMatchObject({
      givenName: "Cher",
      familyName: "Cher",
    });
  });

  it("has no guest without an email or a phone number", () => {
    expect(leadGuestFrom({ displayName: "Ada", email: null, phone: "+14045550100" })).toBeNull();
    expect(leadGuestFrom({ displayName: "Ada", email: "ada@example.com", phone: "" })).toBeNull();
  });
});

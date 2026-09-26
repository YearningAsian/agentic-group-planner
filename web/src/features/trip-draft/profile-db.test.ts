// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { PROFILE_KEY, loadProfile, saveProfile } from "./profile-db";

describe("profile-db", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads an empty home address when nothing is stored", () => {
    expect(loadProfile()).toEqual({ homeAddress: "", homeLat: null, homeLng: null });
  });

  it("saves and loads a resolved address with coordinates", () => {
    saveProfile({
      homeAddress: "123 Mission St, San Francisco, CA 94105, United States",
      homeLat: 37.7935,
      homeLng: -122.396,
    });
    expect(loadProfile()).toEqual({
      homeAddress: "123 Mission St, San Francisco, CA 94105, United States",
      homeLat: 37.7935,
      homeLng: -122.396,
    });
    expect(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}")).toMatchObject({
      homeAddress: "123 Mission St, San Francisco, CA 94105, United States",
    });
  });
});

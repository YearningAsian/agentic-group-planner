import { describe, expect, it } from "vitest";
import { chatCityDestination, destinationById, flightsFor } from "./trip-draft-fixtures";

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

  it("prices a connection below the nonstops, in dollars from New York", () => {
    const london = flightsFor("london");
    const nonstops = london.filter((fare) => fare.stops === "Nonstop").map((fare) => fare.price);
    const connection = london.find((fare) => fare.stops === "1 stop");
    expect(Math.min(...nonstops)).toBeGreaterThan(connection?.price ?? 0);
    expect(connection?.price).toBe(472);
    expect(flightsFor("chicago").find((fare) => fare.stops === "Nonstop")?.duration).toBe("2h 40m");
    expect(flightsFor("tokyo").every((fare) => fare.price > 800)).toBe(true);
    expect(destinationById("london")?.code).toBe("LHR");
  });
});

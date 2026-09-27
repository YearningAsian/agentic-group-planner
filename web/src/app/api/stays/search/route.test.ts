import { describe, expect, it } from "vitest";

describe("GET /api/stays/search", () => {
  it("asks for dates instead of searching when the range is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/stays/search?destinationId=lisbon"));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown destination", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=not-a-city&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(400);
  });

  it("returns the sample stays for a catalog city", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=lisbon&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stays: { id: string; name: string; nightlyAmount: number }[] };
    expect(body.stays.map((stay) => stay.name)).toEqual(["Alfama townhouse", "Tile-roof flat", "River-view loft"]);
    expect(body.stays[0]).toMatchObject({ id: "lisbon-stay-0", nightlyAmount: 168, currency: "USD" });
  });

  it("uses the nearest catalog city when the pin is inside that city", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/stays/search?lat=38.71&lng=-9.13&label=Alfama&checkIn=2026-06-01&checkOut=2026-06-04&adults=2",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stays: { name: string }[] };
    expect(body.stays[0]?.name).toBe("Alfama townhouse");
  });

  it("returns the sample stays when the place is a catalog city without coordinates", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/stays/search?place=Tokyo&iata=TYO&checkIn=2026-06-01&checkOut=2026-06-04&adults=2",
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { stays: { name: string; id: string }[] };
    expect(body.stays.map((stay) => stay.name)).toEqual(["Shinjuku hotel", "Asakusa inn", "Shibuya rooms"]);
    expect(body.stays[0]?.id).toBe("tokyo-stay-0");
  });
});

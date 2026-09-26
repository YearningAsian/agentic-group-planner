import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();

vi.mock("@/lib/providers/stays", () => ({
  getStaysProvider: () => ({ search }),
}));

describe("GET /api/stays/search", () => {
  beforeEach(() => {
    search.mockReset();
  });

  it("asks for dates instead of searching when the range is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/stays/search?destinationId=lisbon"));
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects an unknown destination", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=not-a-city&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("searches the fixture city's coordinates within 5 km", async () => {
    search.mockResolvedValue([{ id: "acc_1", name: "Duffel Test Hotel" }]);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/stays/search?destinationId=lisbon&checkIn=2026-06-01&checkOut=2026-06-04&adults=2"),
    );
    expect(response.status).toBe(200);
    expect(search).toHaveBeenCalledWith({
      lat: 38.7223,
      lng: -9.1393,
      radiusKm: 5,
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      adults: 2,
    });
    await expect(response.json()).resolves.toEqual({ stays: [{ id: "acc_1", name: "Duffel Test Hotel" }] });
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { maybeSingle, eq, from, getServerClient, notFound } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const getServerClient = vi.fn(async () => ({ from }));
  const notFound = vi.fn((): never => { throw new Error("NEXT_NOT_FOUND"); });
  return { maybeSingle, eq, from, getServerClient, notFound };
});

vi.mock("@/lib/supabase/server", () => ({ getServerClient }));
vi.mock("next/navigation", () => ({ notFound }));

import TripPage from "./page";
import RecapPage from "./recap/page";

const params = Promise.resolve({ slug: "R9dZ7wYk2_A" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public trip slug pages", () => {
  it.each(["missing slug", "non-member"])("returns the same 404 for a %s", async () => {
    // RLS returns no row for a non-member, exactly as it does for a missing slug.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(TripPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(RecapPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(from).toHaveBeenCalledWith("trips");
    expect(eq).toHaveBeenCalledWith("slug", "R9dZ7wYk2_A");
    expect(notFound).toHaveBeenCalledTimes(2);
  });

  it("renders a member's trip at its public slug", async () => {
    maybeSingle.mockResolvedValue({
      data: { id: "00000000-0000-4000-8000-000000000100", slug: "R9dZ7wYk2_A", title: "Saturday in Atlanta", city: "Atlanta", trip_date: "2026-10-03", timezone: "America/New_York" },
      error: null,
    });
    const html = renderToStaticMarkup(await TripPage({ params }));
    expect(html).toContain("Saturday in Atlanta");
    expect(html).toContain("/trip/R9dZ7wYk2_A/recap");
    expect(html).not.toContain("00000000-0000-4000-8000-000000000100");
  });
});

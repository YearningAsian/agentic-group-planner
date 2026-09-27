import { describe, expect, it } from "vitest";
import { isPublicPath, resolveAuthGate, safeNextPath } from "./auth-routes";

describe("safeNextPath", () => {
  it("keeps same-origin paths and drops absolute, protocol-relative, and backslash targets", () => {
    expect(safeNextPath("/trips")).toBe("/trips");
    expect(safeNextPath("/trip/abc12345678?tab=map")).toBe("/trip/abc12345678?tab=map");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example/trips")).toBeNull();
    expect(safeNextPath("/\\evil.example/trips")).toBeNull();
    expect(safeNextPath("\\evil.example")).toBeNull();
    expect(safeNextPath("trips")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});

describe("isPublicPath", () => {
  it("allows marketing, auth, join, and API paths", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/join/token")).toBe(true);
    expect(isPublicPath("/i/k7m2qx")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/trips")).toBe(false);
    expect(isPublicPath("/home")).toBe(false);
    expect(isPublicPath("/studio")).toBe(false);
  });
});

describe("resolveAuthGate", () => {
  it("a signed-out app route redirects to /login with next; a signed-in /login or /signup redirects to /trips; public paths pass", () => {
    expect(resolveAuthGate({ pathname: "/trips", signedIn: false })).toEqual({
      type: "redirect",
      to: "/login?next=%2Ftrips",
    });
    expect(resolveAuthGate({ pathname: "/login", signedIn: true })).toEqual({
      type: "redirect",
      to: "/trips",
    });
    expect(resolveAuthGate({ pathname: "/signup", signedIn: true })).toEqual({
      type: "redirect",
      to: "/trips",
    });
    expect(resolveAuthGate({ pathname: "/", signedIn: false })).toEqual({ type: "pass" });
    expect(resolveAuthGate({ pathname: "/", signedIn: true })).toEqual({ type: "pass" });
    expect(resolveAuthGate({ pathname: "/login", signedIn: false })).toEqual({ type: "pass" });
  });
});

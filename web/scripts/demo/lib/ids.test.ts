import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inviteTokenFor, uuidFor } from "./ids";

afterEach(() => vi.unstubAllEnvs());

describe("seed ids", () => {
  it("uuidFor is stable for the same batch and name, and differs across batches", () => {
    const a = uuidFor("demo", "trip:saturday");
    expect(a).toBe(uuidFor("demo", "trip:saturday"));
    expect(a).not.toBe(uuidFor("dev-vo", "trip:saturday"));
    expect(a).not.toBe(uuidFor("demo", "trip:picnic"));
    // A real version-5 UUID, so Postgres and Zod both accept it.
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("matches the RFC 4122 v5 reference value", () => {
    // uuidv5("www.example.com", DNS namespace) from RFC 4122 test vectors.
    expect(uuidFor.fromNamespace("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("inviteTokenFor returns 21 URL-safe characters, is stable per batch, and changes with DEMO_SEED_SECRET", () => {
    vi.stubEnv("DEMO_SEED_SECRET", "first-secret");
    const token = inviteTokenFor("demo");
    expect(token).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(inviteTokenFor("demo")).toBe(token);
    expect(inviteTokenFor("dev-vo")).not.toBe(token);
    vi.stubEnv("DEMO_SEED_SECRET", "second-secret");
    expect(inviteTokenFor("demo")).not.toBe(token);
    vi.stubEnv("DEMO_SEED_SECRET", "");
    expect(() => inviteTokenFor("demo")).toThrow(/DEMO_SEED_SECRET/);
  });

  it("the seeded trip keeps a fixed, valid public slug", () => {
    const fixture = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/saturday-trip.json"), "utf8")) as {
      trip: { slug?: string };
    };
    expect(fixture.trip.slug).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });
});

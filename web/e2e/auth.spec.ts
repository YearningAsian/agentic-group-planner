import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("auth pages", () => {
  test("a wrong password shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/wrong email or password|try again|confirm your email|too many/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("?next=https://evil.example is ignored after login form redirect target", async ({ page }) => {
    await page.goto("/login?next=https://evil.example");
    // The form posts next through the server action; the page should still render (no open redirect on load).
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(page.url()).toContain("/login");
    expect(page.url()).not.toContain("evil.example");
  });

  test("a signed-out visit to an app route redirects to /login", async ({ page }) => {
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("instant login cards are hidden when demo mode is off", async ({ page }) => {
    // This project builds with NEXT_PUBLIC_DEMO_MODE from env. When true, cards show; when the
    // action is called with demo off it refuses. Assert presence only in demo builds.
    await page.goto("/login");
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      await expect(page.getByRole("heading", { name: "Try it as someone in the group" })).toBeVisible();
    } else {
      await expect(page.getByRole("heading", { name: "Try it as someone in the group" })).toHaveCount(0);
    }
  });

  test("each instant login lands in the trips home as the right person", async ({ page }) => {
    test.skip(process.env.NEXT_PUBLIC_DEMO_MODE !== "true", "demo mode off");
    for (const person of ["Person 1", "Person 2", "Person 3"] as const) {
      await page.goto("/login#demo");
      await page.getByRole("button", { name: new RegExp(`Sign in as ${person}`) }).click();
      await expect(page).toHaveURL(/\/trips/, { timeout: 20_000 });
      await page.goto("/login");
      // Signed-in visits to /login redirect to trips.
      await expect(page).toHaveURL(/\/trips/, { timeout: 10_000 });
      // Sign out via cookie clear for the next person.
      await page.context().clearCookies();
    }
  });

  test("signup form validates and can submit", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByLabel("Display name").fill("Test Traveler");
    await page.getByLabel("Email").fill(`e2e-${Date.now()}@example.com`);
    await page.getByLabel("Password").fill("longenough1");
    await page.getByRole("button", { name: "Create account" }).click();
    // Either trips home (confirmation off) or check-email state.
    await expect(
      page.getByRole("heading", { name: /Check your email|Trips/i }).or(page.getByText(/trips/i).first()),
    ).toBeVisible({ timeout: 20_000 });
  });

  for (const path of ["/login", "/signup"] as const) {
    test(`axe accessibility on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

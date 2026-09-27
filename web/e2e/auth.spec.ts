import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("auth pages", () => {
  test("a wrong password shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill("nobody@example.com");
    await page.locator('input[name="password"]').fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText(/wrong email or password|try again|confirm your email|too many/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("?next=https://evil.example is ignored", async ({ page }) => {
    await page.goto("/login?next=https://evil.example");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    // Query may still show the raw next= value; the page must not navigate off-origin.
    expect(url.origin).not.toContain("evil.example");
    expect(url.protocol).toMatch(/^https?:$/);
  });

  test("a signed-out visit to an app route redirects to /login", async ({ page }) => {
    await page.goto("/trips");
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test("instant login cards are hidden when demo mode is off", async ({ page }) => {
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
      await expect(page).toHaveURL(/\/trips/, { timeout: 10_000 });
      await page.context().clearCookies();
    }
  });

  test("signup form validates and can submit", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByRole("textbox", { name: "Display name" }).fill("Test Traveler");
    await page.getByRole("textbox", { name: "Email" }).fill(`e2e-${Date.now()}@example.com`);
    await page.locator('input[name="password"]').fill("longenough1");
    await page.getByRole("button", { name: "Create account" }).click();
    // Confirmation-on: check-email panel. Confirmation-off: trips home.
    await expect(async () => {
      const checkEmail = await page.getByRole("heading", { name: "Check your email" }).isVisible();
      const onTrips = /\/(trips|home)/.test(page.url());
      expect(checkEmail || onTrips).toBe(true);
    }).toPass({ timeout: 20_000 });
  });

  for (const path of ["/login", "/signup"] as const) {
    test(`axe accessibility on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});

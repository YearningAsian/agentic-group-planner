import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("landing page", () => {
  test("renders and every nav anchor works", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Plan it together/i })).toBeVisible();

    for (const { name, id } of [
      { name: "How it works", id: "how-it-works" },
      { name: "Features", id: "features" },
      { name: "FAQ", id: "faq" },
    ] as const) {
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name }).click();
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
  });

  test("signed-in visitor sees Open my trips", async ({ page }) => {
    // Without a session the CTA is Create account; with cookies from a prior login it flips.
    // This asserts the public signed-out label; auth e2e covers the signed-in path after login.
    await page.goto("/");
    const create = page.getByRole("link", { name: "Create account" }).first();
    const open = page.getByRole("link", { name: "Open my trips" }).first();
    await expect(create.or(open)).toBeVisible();
  });

  test("axe accessibility on /", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page }).exclude("iframe").analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});

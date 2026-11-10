import { expect, test } from "@playwright/test";

test("parent setup, child build, redirect, audit", async ({ page }) => {
  // 1. wizard
  await page.goto("/parent");
  await page.getByLabel("PIN (6 digits)").fill("123456");
  await page.getByLabel("Repeat PIN").fill("123456");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Child's name").fill("Sam");
  await page.getByRole("radio").first().click();
  await page.getByLabel("Age").fill("7");
  await page.getByRole("button", { name: "Next" }).click();
  // FAKE_PROVIDERS: the server refuses keys (409), so the page offers Test without one
  await expect(page.getByLabel("openai key")).toHaveCount(0);
  await page.locator(".field", { hasText: "openai" }).getByRole("button", { name: "Test" }).click();
  await expect(page.getByText("Works: 1 models")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Builder provider").selectOption("openai");
  await page.getByLabel("Checker provider").selectOption("openai");
  await page.getByLabel("Moderation (Layer 2)").selectOption("openai");
  // no model is picked for the parent: Next stays disabled until both are chosen
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  await page.getByLabel("Builder model").selectOption("fake-model");
  await page.getByLabel("Checker model").selectOption("fake-model");
  await page.getByRole("button", { name: "Test build" }).click();
  await expect(page.getByText("Works! It built: Red Tower")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Finish" }).click();

  // the default hours (08:00-19:00) would make the test depend on the clock
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Allowed from").fill("00:00");
  await page.getByLabel("Allowed until").fill("23:59");
  await page.getByRole("button", { name: /^Save Sam/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // 2-4. child builds
  await page.goto("/");
  await page.getByLabel("What do you want to build?").fill("a red tower");
  await page.getByRole("button", { name: "Build!" }).click();
  await expect(page.locator(".viewer canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Red Tower" })).toBeVisible();

  // 5. blocked word
  await page.getByLabel("What do you want to build?").fill("gun");
  await page.getByRole("button", { name: "Build!" }).click();
  await expect(page.getByText(/^Let's build something else!/)).toBeVisible();

  // 6. audit
  await page.goto("/parent");
  if (await page.getByLabel("PIN").isVisible()) {
    await page.getByLabel("PIN").fill("123456");
    await page.getByRole("button", { name: "Unlock" }).click();
  }
  const rows = page.locator("ul.rows li");
  await expect(rows.filter({ hasText: "a red tower" }).filter({ hasText: "shown" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "gun" })).toHaveClass("bad");
});

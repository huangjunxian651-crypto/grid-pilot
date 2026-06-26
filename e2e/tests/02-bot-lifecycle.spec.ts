import { test, expect } from "@playwright/test";

test.describe("Bot Lifecycle", () => {
  test("bots page displays config list", async ({ page }) => {
    await page.goto("/bots");
    await expect(page).toHaveURL(/\/bots/);

    // Verify page has expected content: heading, tabs, list area
    await expect(page.getByRole("heading", { name: /bots|机器人/i })).toBeVisible();

    // Tab filters should be present
    await expect(page.getByRole("button", { name: /all|全部/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /running|运行中/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /trailing|尾随/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sleeping|休眠/i })).toBeVisible();

    // New bot button should be present
    await expect(page.getByRole("button", { name: /new bot|新建机器人/i })).toBeVisible();
  });

  test("new bot page has form", async ({ page }) => {
    await page.goto("/bots/new");
    await expect(page).toHaveURL(/\/bots\/new/);

    // Verify wizard/form is present
    await expect(page.getByRole("heading", { name: /create new bot|创建新机器人/i })).toBeVisible();

    // Step indicators should be present
    // Use page content check to avoid matching "Next" buttons
    const pageContent = await page.content();
    expect(pageContent).toMatch(/交易所与标的|Exchange & Symbol/);
    expect(pageContent).toMatch(/箱体与网格|Box & Grid/);
    expect(pageContent).toMatch(/止损缓冲区|Stop-Loss Buffer/);
    expect(pageContent).toMatch(/复核并激活|Review & Activate/);

    // Cancel button should be present
    await expect(page.getByRole("button", { name: /cancel|取消/i })).toBeVisible();
  });

  test("navigate to bot detail", async ({ page }) => {
    await page.goto("/bots");
    await expect(page).toHaveURL(/\/bots/);

    // If there are bots, click on the first one (exclude /bots/new link)
    const botCards = page.locator("a[href^='/bots/']:not([href='/bots/new'])");
    const count = await botCards.count();

    if (count > 0) {
      // Click the first bot card/link
      await botCards.first().click();

      // Verify navigation to detail page
      await expect(page).toHaveURL(/\/bots\/.+/);

      // Verify detail page content
      await expect(page.locator("h1")).toBeVisible();
    } else {
      // No bots available — skip this part of the test
      test.skip(true, "No bots available to navigate to detail page");
    }
  });
});

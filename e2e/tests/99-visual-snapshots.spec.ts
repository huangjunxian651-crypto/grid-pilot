import { test, expect } from "@playwright/test";

const TARGET_BOT_ID = "cmpmlmz7t000aat1tzmosmp5o";

/**
 * Visual Snapshot Tests
 *
 * Captures screenshots of key pages for manual verification.
 */
test.describe("Visual Snapshots", () => {
  test("bots list page screenshot", async ({ page }) => {
    await page.goto("/bots");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/bots/);
    await page.screenshot({ path: "/home/jessie/Workspace/grid-pilot/e2e//tmp/gridpilot-screenshots/bots-list.png", fullPage: true });
  });

  test("bot detail page V1 screenshot", async ({ page }) => {
    await page.goto(`/bots/${TARGET_BOT_ID}`);
    await page.waitForSelector("h1", { timeout: 10000 });
    await page.screenshot({ path: "/tmp/gridpilot-screenshots/bot-detail-v1.png", fullPage: true });
  });

  test("bot detail page V2 screenshot", async ({ page }) => {
    await page.goto(`/bots/${TARGET_BOT_ID}`);
    await page.waitForSelector("h1", { timeout: 10000 });

    // Switch to V2
    const v2Btn = page.getByRole("button", { name: "V2" });
    await v2Btn.click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: "/tmp/gridpilot-screenshots/bot-detail-v2.png", fullPage: true });
  });

  test("bot detail page V3 screenshot", async ({ page }) => {
    await page.goto(`/bots/${TARGET_BOT_ID}`);
    await page.waitForSelector("h1", { timeout: 10000 });

    // Switch to V3
    const v3Btn = page.getByRole("button", { name: "V3" });
    await v3Btn.click();
    await page.waitForTimeout(500);

    await page.screenshot({ path: "/tmp/gridpilot-screenshots/bot-detail-v3.png", fullPage: true });
  });

  test("new bot page screenshot", async ({ page }) => {
    await page.goto("/bots/new");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "/tmp/gridpilot-screenshots/new-bot.png", fullPage: true });
  });
});

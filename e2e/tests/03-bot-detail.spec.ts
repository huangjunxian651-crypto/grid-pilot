import { test, expect } from "@playwright/test";

const TARGET_BOT_ID = "cmpmlmz7t000aat1tzmosmp5o";

/**
 * Bot Detail Page Tests
 *
 * Tests the bot detail page at /bots/:id for the target bot.
 * These tests assume the user is authenticated (via storageState from auth.setup).
 */
test.describe("Bot Detail Page", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to target bot page
    await page.goto(`/bots/${TARGET_BOT_ID}`);
    // Wait for page to load (either content or not-found)
    await page.waitForLoadState("networkidle");
  });

  test("page loads with bot data", async ({ page }) => {
    // Check we are on the bot detail page
    await expect(page).toHaveURL(`/bots/${TARGET_BOT_ID}`);

    // Should NOT show "not found" or "loading" indefinitely
    const notFound = page.getByText(/not found|未找到/i);
    const loading = page.getByText(/^loading|加载中/i);

    // Wait up to 10s for content to load
    await expect(loading).not.toBeVisible({ timeout: 10000 }).catch(() => {
      // loading may already be gone
    });

    // If bot exists, verify key content
    const botNotFound = await notFound.isVisible().catch(() => false);
    if (botNotFound) {
      test.skip(true, "Target bot not found in database");
      return;
    }

    // Verify bot header content
    await expect(page.getByRole("heading")).toBeVisible();

    // Verify symbol is displayed (ETH/USDT for target bot)
    const heading = page.locator("h1");
    await expect(heading).toBeVisible();
  });

  test("displays KPI metrics row", async ({ page }) => {
    const notFound = page.getByText(/not found|未找到/i);
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Target bot not found");
      return;
    }

    // KPI row should be visible after loading
    // The KPIs are in a grid container; check for key labels
    const kpiContainer = page.locator(".grid").first();
    await expect(kpiContainer).toBeVisible({ timeout: 10000 });
  });

  test("variant switcher toggles V1/V2/V3 layouts", async ({ page }) => {
    const notFound = page.getByText(/not found|未找到/i);
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Target bot not found");
      return;
    }

    // Wait for content to load
    await page.waitForSelector("h1", { timeout: 10000 });

    // Find variant buttons (V1, V2, V3)
    const v1Btn = page.getByRole("button", { name: "V1" });
    const v2Btn = page.getByRole("button", { name: "V2" });
    const v3Btn = page.getByRole("button", { name: "V3" });

    // All variant buttons should be present
    await expect(v1Btn).toBeVisible();
    await expect(v2Btn).toBeVisible();
    await expect(v3Btn).toBeVisible();

    // V1 is default active (has different background)
    // Click V2
    await v2Btn.click();
    await page.waitForTimeout(300);

    // Click V3
    await v3Btn.click();
    await page.waitForTimeout(300);

    // Click back to V1
    await v1Btn.click();
    await page.waitForTimeout(300);

    // Page should still show the bot header after switching
    await expect(page.locator("h1")).toBeVisible();
  });

  test("action buttons are present and functional", async ({ page }) => {
    const notFound = page.getByText(/not found|未找到/i);
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Target bot not found");
      return;
    }

    await page.waitForSelector("h1", { timeout: 10000 });

    // Sync State button
    const syncBtn = page.getByRole("button", { name: /sync state|同步状态/i });
    await expect(syncBtn).toBeVisible();

    // Pause button
    const pauseBtn = page.getByRole("button", { name: /pause|暂停/i });
    await expect(pauseBtn).toBeVisible();

    // Edit Config button
    const editBtn = page.getByRole("button", { name: /edit config|编辑配置/i });
    await expect(editBtn).toBeVisible();

    // Stop/Liquidate button
    const stopBtn = page.getByRole("button", { name: /stop|liquidate|停止|平仓/i });
    await expect(stopBtn).toBeVisible();

    // Test Pause button shows toast
    await pauseBtn.click();
    // Toast should appear (sonner toast container)
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 5000 });

    // Test Edit Config button shows toast
    await editBtn.click();
    await expect(page.locator("[data-sonner-toast]").first()).toBeVisible({ timeout: 5000 });
  });

  test("stop bot confirmation modal", async ({ page }) => {
    const notFound = page.getByText(/not found|未找到/i);
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Target bot not found");
      return;
    }

    await page.waitForSelector("h1", { timeout: 10000 });

    // Click stop button
    const stopBtn = page.getByRole("button", { name: /stop|liquidate|停止|平仓/i });
    await stopBtn.click();

    // Modal should appear
    const modal = page.locator("div").filter({ hasText: /cancel grid|cancel algo|close pos|end session/i }).first();
    // Wait for modal to appear
    await page.waitForTimeout(500);

    // Look for the cancel button in modal
    const cancelBtn = page.getByRole("button", { name: /cancel|取消/i });
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });

    // Click cancel to close modal
    await cancelBtn.click();

    // Modal should close
    await expect(cancelBtn).not.toBeVisible({ timeout: 5000 });
  });

  test("page panels render correctly", async ({ page }) => {
    const notFound = page.getByText(/not found|未找到/i);
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Target bot not found");
      return;
    }

    await page.waitForSelector("h1", { timeout: 10000 });

    // Check for key panel labels (using uppercase text matchers for i18n keys)
    // These are panel headers with uppercase styling
    const pageContent = await page.content();

    // Should contain some bot-related content
    expect(pageContent).toContain("ETH");

    // Check FSM timeline is present (i18n translated states)
    const fsmStatesZh = ["追踪建仓", "运行中", "平仓中", "已平仓"];
    const fsmStatesEn = ["Trailing Entry", "Running", "Liquidating", "Liquidated"];
    const hasFsm = fsmStatesZh.some((s) => pageContent.includes(s)) ||
                   fsmStatesEn.some((s) => pageContent.includes(s));
    expect(hasFsm).toBe(true);
  });

  test("API data matches page display", async ({ page }) => {
    // Fetch bot data directly from API
    const apiResponse = await page.request.get(`/api/grid-bot/sessions/${TARGET_BOT_ID}`);

    if (apiResponse.status() === 401) {
      test.skip(true, "Authentication required - run auth.setup first");
      return;
    }

    if (apiResponse.status() === 404) {
      test.skip(true, "Target bot not found in API");
      return;
    }

    expect(apiResponse.ok()).toBe(true);
    const session = await apiResponse.json();

    // Navigate to page
    await page.goto(`/bots/${TARGET_BOT_ID}`);
    await page.waitForSelector("h1", { timeout: 10000 });

    // Verify symbol is displayed on page
    const symbol = session.box?.symbol || "";
    if (symbol) {
      const heading = page.locator("h1");
      await expect(heading).toContainText(symbol.split("/")[0]);
    }

    // Verify state is displayed (check both Chinese and English translations)
    const state = session.state;
    const pageContent = await page.content();
    const stateTranslations: Record<string, string[]> = {
      TRAILING_ENTRY: ["追踪建仓", "Trailing Entry"],
      RUNNING: ["运行中", "Running"],
      LIQUIDATING: ["平仓中", "Liquidating"],
      LIQUIDATED: ["已平仓", "Liquidated"],
      SLEEPING: ["休眠中", "Sleeping"],
    };
    const translations = stateTranslations[state] || [state];
    const hasState = translations.some((t) => pageContent.includes(t));
    expect(hasState).toBe(true);
  });
});

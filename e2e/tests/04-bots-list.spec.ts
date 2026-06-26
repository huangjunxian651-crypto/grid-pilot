import { test, expect } from "@playwright/test";

/**
 * Bots List Page Tests
 *
 * Tests the bots listing page at /bots.
 */
test.describe("Bots List Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/bots");
    await page.waitForLoadState("networkidle");
  });

  test("page loads with heading and tabs", async ({ page }) => {
    await expect(page).toHaveURL(/\/bots/);

    // Verify page has content (heading or title area)
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // Tab filters should be present
    await expect(page.getByRole("button", { name: /all|全部/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /running|运行中/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /trailing|尾随/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sleeping|休眠/i })).toBeVisible();

    // New bot button should be present
    await expect(page.getByRole("button", { name: /new bot|新建机器人/i })).toBeVisible();
  });

  test("tab filtering works", async ({ page }) => {
    // Get tab buttons
    const allTab = page.getByRole("button", { name: /all|全部/i });
    const runningTab = page.getByRole("button", { name: /running|运行中/i });
    const trailingTab = page.getByRole("button", { name: /trailing|尾随/i });
    const sleepingTab = page.getByRole("button", { name: /sleeping|休眠/i });

    // Click each tab and verify page doesn't error
    await runningTab.click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await trailingTab.click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1, h2").first()).toBeVisible();

    await sleepingTab.click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1, h2").first()).toBeVisible();

    // Back to all
    await allTab.click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("bot cards display session info", async ({ page }) => {
    // Check if there are any bot cards (exclude the /bots/new link)
    const botCards = page.locator("a[href^='/bots/']:not([href='/bots/new'])");
    const count = await botCards.count();

    if (count === 0) {
      // No bots - verify empty state
      const noBots = page.getByText(/no bots|没有机器人/i);
      await expect(noBots).toBeVisible();
      return;
    }

    // Verify first card has expected elements
    const firstCard = botCards.first();
    await expect(firstCard).toBeVisible();

    // Card should contain exchange info, symbol, direction
    const cardText = await firstCard.textContent() || "";
    expect(cardText.length).toBeGreaterThan(0);

    // Should have some form of state indicator (Chinese or English translations)
    expect(cardText).toMatch(/追踪建仓|运行中|休眠中|平仓中|已平仓|Trailing Entry|Running|Sleeping|Liquidating|Liquidated/i);
  });

  test("navigate to bot detail from list", async ({ page }) => {
    const botCards = page.locator("a[href^='/bots/']:not([href='/bots/new'])");
    const count = await botCards.count();

    if (count === 0) {
      test.skip(true, "No bots to navigate to");
      return;
    }

    // Click first bot card
    const firstCard = botCards.first();
    const href = await firstCard.getAttribute("href");
    expect(href).toMatch(/\/bots\/.+/);

    await firstCard.click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/\/bots\/.+/);

    // Detail page should have heading
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("new bot button navigates to creation page", async ({ page }) => {
    const newBotBtn = page.getByRole("button", { name: /new bot|新建机器人/i });
    await newBotBtn.click();

    // Should navigate to /bots/new
    await expect(page).toHaveURL(/\/bots\/new/);

    // Verify creation form is present
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("API data consistency with page display", async ({ page }) => {
    // Fetch sessions from API
    const apiResponse = await page.request.get("/api/grid-bot/sessions");

    if (apiResponse.status() === 401) {
      test.skip(true, "Authentication required");
      return;
    }

    expect(apiResponse.ok()).toBe(true);
    const data = await apiResponse.json();
    const sessions = data.data || [];

    // Count bot cards on page (exclude /bots/new link)
    const botCards = page.locator("a[href^='/bots/']:not([href='/bots/new'])");
    const pageCount = await botCards.count();

    // The page count should match or be consistent with API
    // (filter may be applied, so exact match not guaranteed)
    if (sessions.length > 0) {
      expect(pageCount).toBeGreaterThan(0);
    }
  });
});

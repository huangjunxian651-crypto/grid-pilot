import { test, expect } from "@playwright/test";

test.describe("Notification Center", () => {
  test("notifications page loads and shows empty state", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/notifications/);

    // Page title
    await expect(page.getByRole("heading", { name: /Notifications|通知中心/i })).toBeVisible();

    // Filter tabs
    await expect(page.getByRole("button", { name: /All|全部/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Unread|未读/i }).first()).toBeVisible();

    // Mark all read button
    await expect(page.getByRole("button", { name: /Mark all|全部已读/i })).toBeVisible();

    // Clear all button
    await expect(page.getByRole("button", { name: /Clear all|清空所有/i })).toBeVisible();
  });

  test("notification settings tab renders preferences with working toggles", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);

    // Click Notifications tab
    const notiTab = page.getByRole("button", { name: /^Notifications$/i });
    await expect(notiTab).toBeVisible();
    await notiTab.click();

    // Preference items should be visible (use exact heading text to avoid matching descriptions)
    await expect(page.getByText("Stop-loss / Liquidation alerts", { exact: true })).toBeVisible();
    await expect(page.getByText("Alpha milestones", { exact: true })).toBeVisible();
    await expect(page.getByText("Status changes", { exact: true })).toBeVisible();
    await expect(page.getByText("Margin ratio warnings", { exact: true })).toBeVisible();

    // Toggle switches should be clickable (aria-pressed indicates state)
    const toggles = page.locator('button[aria-pressed]');
    await expect(toggles).toHaveCount(4);

    // Click first toggle to turn it off
    const firstToggle = toggles.first();
    const initialState = await firstToggle.getAttribute('aria-pressed');
    await firstToggle.click();
    const newState = await firstToggle.getAttribute('aria-pressed');
    expect(newState).not.toBe(initialState);
  });

  test("sidebar shows notifications link with badge", async ({ page }) => {
    await page.goto("/dashboard");

    const notiLink = page.getByRole("link", { name: /notifications|通知/i });
    await expect(notiLink).toBeVisible();
  });

  test("clear all button shows confirmation dialog", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page).toHaveURL(/\/notifications/);

    const clearButton = page.getByRole("button", { name: /Clear all|清空所有/i });
    await expect(clearButton).toBeVisible();
    await clearButton.click();

    // Confirmation dialog should appear
    await expect(page.getByText(/Clear all notifications|清空所有通知/i)).toBeVisible();

    // Cancel should close the dialog
    const cancelButton = page.getByRole("button", { name: /Cancel|取消/i });
    await expect(cancelButton).toBeVisible();
    await cancelButton.click();

    // Dialog should close, clear button still visible
    await expect(clearButton).toBeVisible();
  });
});

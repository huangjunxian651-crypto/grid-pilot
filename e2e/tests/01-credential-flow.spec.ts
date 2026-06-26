import { test, expect } from "@playwright/test";

test.describe("Credential Management", () => {
  test("navigate through all pages", async ({ page }) => {
    await page.goto("/dashboard");

    // Dashboard
    await expect(page).toHaveURL(/\/dashboard/);

    // Bots (navigate directly to avoid multiple link matches)
    await page.goto("/bots");
    await expect(page).toHaveURL(/\/bots/);

    // History
    await page.getByRole("link", { name: /history|历史/i }).click();
    await expect(page).toHaveURL(/\/history/);

    // AI
    await page.getByRole("link", { name: /ai/i }).click();
    await expect(page).toHaveURL(/\/ai/);

    // Keys
    await page.getByRole("link", { name: /keys|密钥/i }).click();
    await expect(page).toHaveURL(/\/keys/);

    // Notifications
    await page.getByRole("link", { name: /notifications|通知/i }).click();
    await expect(page).toHaveURL(/\/notifications/);

    // Settings
    await page.getByRole("link", { name: /settings|设置/i }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("keys page has add button", async ({ page }) => {
    await page.goto("/keys");
    await expect(page).toHaveURL(/\/keys/);

    const addButton = page.getByRole("button", { name: /add credential|添加凭据/i });
    await expect(addButton).toBeVisible();
  });

  test("create and delete credential flow", async ({ page }) => {
    // Handle confirm dialog before any action that might trigger it
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/keys");
    await expect(page).toHaveURL(/\/keys/);

    // Click add button to open the form
    const addButton = page.getByRole("button", { name: /add credential|添加凭据/i });
    await addButton.click();

    // Wait for form to appear (check for form Card)
    await expect(page.getByRole("button", { name: /save|保存/i })).toBeVisible();

    // Fill form fields using input locators (Field component labels are divs, not label elements)
    // The form has: exchange (select), accountId, label, apiKey, apiSecret, passphrase
    const textInputs = page.locator('input[type="text"]');
    const passwordInputs = page.locator('input[type="password"]');

    // Fill account ID (first text input)
    await textInputs.nth(0).fill("test-account-001");
    // Fill label (second text input)
    await textInputs.nth(1).fill("Test Account");
    // Fill API Key (third text input)
    await textInputs.nth(2).fill("test-api-key-12345");
    // Fill API Secret (first password input)
    await passwordInputs.nth(0).fill("test-api-secret-67890");

    // Submit the form
    const saveButton = page.getByRole("button", { name: /save|保存/i });
    await saveButton.click();

    // Wait for form to close and credential to appear in the list
    await expect(page.getByText("Test Account")).toBeVisible();

    // Delete the credential — the delete button is the second icon button in the row
    const credentialRow = page.locator("tr", { hasText: "Test Account" });
    const deleteBtn = credentialRow.locator("button").nth(1);
    await deleteBtn.click();

    // Wait for credential to be removed
    await expect(page.getByText("Test Account")).not.toBeVisible();
  });
});

import { test as setup, expect } from "@playwright/test";

const authFile = "../playwright/.auth/user.json";

setup("authenticate", async ({ page }) => {
  // Read test credentials from environment variables
  const testEmail = process.env.TEST_EMAIL;
  const testPassword = process.env.TEST_PASSWORD;

  if (!testEmail || !testPassword) {
    setup.skip(true, "TEST_EMAIL and TEST_PASSWORD environment variables must be set");
    return;
  }

  // Navigate to login page
  await page.goto("/login");

  // Fill in login form
  // The login page uses Field component with <input> (not textbox role)
  // Support both Chinese (default) and English labels
  await page.locator('input[type="text"]').first().fill(testEmail);
  await page.locator('input[type="password"]').fill(testPassword);

  // Submit form
  await page.getByRole("button", { name: /登录|sign in/i }).click();

  // Wait for redirect to dashboard (auth success)
  await expect(page).toHaveURL(/\/dashboard/);

  // Verify user is authenticated by checking auth state
  const authUser = await page.evaluate(async () => {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.ok) return res.json();
    return null;
  });

  expect(authUser).not.toBeNull();
  expect(authUser.email).toBe(testEmail);

  // Save authentication state for other tests
  await page.context().storageState({ path: authFile });
});

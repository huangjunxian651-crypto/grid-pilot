import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Only run .spec.ts files, exclude vitest .test.ts files
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  // Global setup: clean test database before running tests
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.BASE_URL || "http://192.168.8.100:3300",
    trace: "on-first-retry",
    // Use system Chrome since browser download may fail in some environments
    channel: "chrome",
  },
  // Auto-start API and Web servers for E2E tests (using test database)
  webServer: [
    {
      command: "cd ../apps/api && dotenv -e ../../.env.test -- pnpm dev",
      url: "http://localhost:3301/auth/me",
      timeout: 30000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "cd ../apps/web && dotenv -e ../../.env.test -- pnpm dev",
      url: "http://localhost:3300/login",
      timeout: 30000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    // Authentication setup project
    {
      name: "setup",
      testMatch: "auth.setup.ts",
    },
    // Main test projects that depend on setup
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        // Use saved auth state from setup
        storageState: "../playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});

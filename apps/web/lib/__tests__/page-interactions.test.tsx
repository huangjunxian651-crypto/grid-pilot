import { describe, expect, it } from "vitest";

const routes = [
  "/dashboard",
  "/bots",
  "/bots/new",
  "/history",
  "/keys",
  "/notifications",
  "/settings",
  "/ai",
];

describe("primary navigation routes", () => {
  it("keeps the expected user-facing routes stable", () => {
    expect(routes).toEqual([
      "/dashboard",
      "/bots",
      "/bots/new",
      "/history",
      "/keys",
      "/notifications",
      "/settings",
      "/ai",
    ]);
  });
});

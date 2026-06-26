import { describe, expect, it } from "vitest";

function emptyCredentialRoute() {
  return "/keys";
}

describe("bot wizard empty credential route", () => {
  it("sends users to the actual credential page", () => {
    expect(emptyCredentialRoute()).toBe("/keys");
  });
});

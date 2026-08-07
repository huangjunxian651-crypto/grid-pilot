import { describe, it, expect } from "vitest";
import { hasActiveLiveRobots } from "../shell-live-banner";

describe("hasActiveLiveRobots", () => {
  it("false when no robots", () => {
    expect(hasActiveLiveRobots([])).toBe(false);
  });

  it("false when only demo robots exist", () => {
    expect(hasActiveLiveRobots([{ environment: "demo", endedAt: null }])).toBe(false);
  });

  it("false when live robot is archived (endedAt set)", () => {
    expect(hasActiveLiveRobots([{ environment: "live", endedAt: "2026-08-01T00:00:00Z" }])).toBe(false);
  });

  it("true when an unarchived live robot exists", () => {
    expect(hasActiveLiveRobots([{ environment: "demo", endedAt: null }, { environment: "live", endedAt: null }])).toBe(true);
  });
});

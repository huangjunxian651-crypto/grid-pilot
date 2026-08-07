import { describe, it, expect } from "vitest";
import { xAxisMinTickGap } from "../_metrics-detail";

const DAY_MS = 24 * 3600_000;

describe("xAxisMinTickGap（评价页明细图 X 轴 tick 间隔）", () => {
  it("span > 3 天（7d/30d 窗口，标签折叠为 M/D）：间隔放宽为 96，避免重复日标签", () => {
    expect(xAxisMinTickGap(7 * DAY_MS)).toBe(96);
    expect(xAxisMinTickGap(30 * DAY_MS)).toBe(96);
  });

  it("span ≤ 3 天（24h 窗口，HH:MM 标签）：保持默认 48", () => {
    expect(xAxisMinTickGap(DAY_MS)).toBe(48);
    expect(xAxisMinTickGap(3 * DAY_MS)).toBe(48);
    expect(xAxisMinTickGap(0)).toBe(48);
  });
});

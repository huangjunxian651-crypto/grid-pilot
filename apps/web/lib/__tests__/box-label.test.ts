import { describe, it, expect } from "vitest";
import { boxLabel } from "../store";

describe("boxLabel", () => {
  it("LONG 派生方向+价格区间", () => {
    const label = boxLabel({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5 });
    expect(label).toContain("2800");
    expect(label).toMatch(/做多|LONG|↑/);
  });
  it("SHORT 也能派生", () => {
    const label = boxLabel({ direction: "SHORT", takeProfitPrice: 2200, mainGridCount: 100, mainGridStep: 2, stopLossGridCount: 4, stopLossGridStep: 2 });
    expect(label).toMatch(/做空|SHORT|↓/);
  });
  it("用真实 isolationStep（缺省回退 stopLossGridStep）", () => {
    const withIso = boxLabel({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5, isolationStep: 50 });
    const fallback = boxLabel({ direction: "LONG", takeProfitPrice: 2800, mainGridCount: 235, mainGridStep: 2.5, stopLossGridCount: 4, stopLossGridStep: 2.5 });
    // 不同 isolationStep 应改变下边界（隔离带影响 boxDepth），故标签不同
    expect(withIso).not.toBe(fallback);
  });
});

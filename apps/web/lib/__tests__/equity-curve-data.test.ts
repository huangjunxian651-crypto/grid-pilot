import { describe, it, expect } from "vitest";
import { mergeHistorySeries } from "../equity-curve-data";

describe("mergeHistorySeries（权益/Alpha 双序列按时间对齐）", () => {
  it("空输入 → 空", () => {
    expect(mergeHistorySeries([], [])).toEqual([]);
  });

  it("同 t 合并到一行，缺失侧为 undefined（recharts 自动断点）", () => {
    const eq = [
      { t: 0, equity: 100 },
      { t: 300, equity: 110 },
    ];
    const al = [
      { t: 300, alpha: 1.5 },
      { t: 600, alpha: 2 },
    ];
    expect(mergeHistorySeries(eq, al)).toEqual([
      { t: 0, equity: 100, alpha: undefined },
      { t: 300, equity: 110, alpha: 1.5 },
      { t: 600, equity: undefined, alpha: 2 },
    ]);
  });

  it("输出按 t 升序", () => {
    const merged = mergeHistorySeries([{ t: 600, equity: 1 }], [{ t: 0, alpha: 2 }]);
    expect(merged.map((p) => p.t)).toEqual([0, 600]);
  });
});

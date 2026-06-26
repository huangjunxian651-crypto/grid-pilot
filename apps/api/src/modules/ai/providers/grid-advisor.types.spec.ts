import { describe, it, expect } from "vitest";
import { GRID_RECS_SCHEMA, buildSystemPrompt, buildUserPrompt } from "./grid-advisor.types";

describe("grid-advisor.types", () => {
  it("系统提示词包含网格几何/目标/输出约束关键事实", () => {
    const s = buildSystemPrompt();
    expect(s).toContain("takeProfitPrice");
    expect(s).toContain("mainGridCount");
    expect(s).toContain("stopLoss");
    expect(s).toContain("boxLowPrice");
    expect(s.toLowerCase()).toContain("buy low");
    expect(s).toContain("2");
    expect(s).toContain("confidence");
  });

  it("用户提示词嵌入 symbol/direction/现价/窗口/VPVR", () => {
    const u = buildUserPrompt({
      symbol: "ETH/USDT", direction: "LONG", currentPrice: 2500,
      windows: { "30": { days: 30 } as any }, vpvr: { priceLow: 2000, priceHigh: 3000, bins: [1, 2] },
    } as any);
    expect(u).toContain("ETH/USDT");
    expect(u).toContain("LONG");
    expect(u).toContain("2500");
    expect(u).toContain("3000");
  });

  it("GRID_RECS_SCHEMA 顶层 recommendations 数组，项含箱体字段", () => {
    const item = (GRID_RECS_SCHEMA as any).properties.recommendations.items.properties;
    for (const k of ["label","direction","boxLowPrice","boxHighPrice","takeProfitPrice","mainGridCount","mainGridStep","mainGridPortionSize","leverage","stopLossGridCount","stopLossGridStep","isolationStep","confidence","rationale","evidence"]) {
      expect(item[k]).toBeTruthy();
    }
  });

  it("schema 含 riskTier enum 与结构化 evidence.metricKey enum", () => {
    const item = (GRID_RECS_SCHEMA as any).properties.recommendations.items;
    expect(item.properties.riskTier.enum).toEqual(["low", "mid", "high"]);
    expect(item.properties.evidence.items.properties.metricKey.enum).toEqual([
      "realized_vol", "range_pct", "atr", "max_drawdown", "trend", "vpvr_node",
    ]);
    expect(item.required).toContain("riskTier");
    expect(item.properties.evidence.items.required).toEqual(["metricKey", "value"]);
  });

  it("系统提示词优先稳健，并支持按语言作答指令", () => {
    expect(buildSystemPrompt().toLowerCase()).toMatch(/conservativ|robust|lower-risk|prioritiz/);
    expect(buildSystemPrompt("中文")).toContain("中文");
    expect(buildUserPrompt({
      symbol: "ETH/USDT", direction: "LONG", currentPrice: 2500,
      windows: { "30": { days: 30 } as any }, vpvr: { priceLow: 2000, priceHigh: 3000, bins: [1, 2] },
    } as any, "中文")).toContain("中文");
  });
});

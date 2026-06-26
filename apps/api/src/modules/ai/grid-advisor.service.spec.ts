import { describe, it, expect, vi } from "vitest";
import { GridAdvisorService } from "./grid-advisor.service";
import type { LlmProvider } from "./providers/llm-provider.interface";

const input = {
  symbol: "ETH/USDT", direction: "LONG" as const, currentPrice: 2500,
  windows: { "30": { days: 30, currentPrice: 2500, high: 2700, low: 2300, rangePct: 17, realizedVol: 60, atr: 80, maxDrawdownPct: 12, trendPct: 5 } },
  vpvr: { priceLow: 2300, priceHigh: 2700, bins: [1, 3, 2] },
};
const goodRec = {
  label: "Tight", direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700,
  mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20,
  stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 0.8, riskTier: "mid", rationale: "x", evidence: [{ metricKey: "realized_vol", value: "60%" }],
};

function provider(out: unknown): LlmProvider {
  return { name: "mock", completeJson: vi.fn().mockResolvedValue(out) };
}

describe("GridAdvisorService", () => {
  it("把 system+user 提示词与 schema 传给 provider，返回校验后的推荐", async () => {
    const p = provider({ recommendations: [goodRec] });
    const svc = new GridAdvisorService();
    const recs = await svc.recommend(input as any, p);
    expect(recs).toHaveLength(1);
    expect(recs[0].boxLowPrice).toBe(2300);
    const [sys, usr, schema] = (p.completeJson as any).mock.calls[0];
    expect(sys).toContain("takeProfitPrice");
    expect(usr).toContain("ETH/USDT");
    expect((schema as any).properties.recommendations).toBeTruthy();
  });

  it("过滤非法项（价格<=0 或 boxLow>=boxHigh）", async () => {
    const bad = { ...goodRec, boxLowPrice: 0 };
    const p = provider({ recommendations: [goodRec, bad] });
    const recs = await new GridAdvisorService().recommend(input as any, p);
    expect(recs).toHaveLength(1);
  });

  it("全非法 → 抛 AI_LLM_FAILED", async () => {
    const p = provider({ recommendations: [{ ...goodRec, boxHighPrice: 1 }] });
    await expect(new GridAdvisorService().recommend(input as any, p)).rejects.toMatchObject({ response: { code: "AI_LLM_FAILED" } });
  });

  it("归一化：数值合法但缺装饰字段的推荐补齐契约（evidence→数组、label/rationale→字符串、confidence 夹 [0,1]）", async () => {
    // 模拟 OpenAI/DeepSeek 非严格 JSON：数值齐全但漏掉 evidence、label、rationale，confidence 越界
    const sparse = {
      direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700,
      mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20,
      stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 1.8,
    } as any;
    const p = provider({ recommendations: [sparse] });
    const recs = await new GridAdvisorService().recommend(input as any, p);
    expect(recs).toHaveLength(1);
    const r = recs[0];
    expect(Array.isArray(r.evidence)).toBe(true); // 前端 rec.evidence.map 不会崩
    expect(typeof r.label).toBe("string");
    expect(typeof r.rationale).toBe("string");
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("归一化：evidence 内非法项被剔除，仅保留合法 {metricKey,value} 对", async () => {
    const dirty = { ...goodRec, evidence: [{ metricKey: "realized_vol", value: "60%" }, { metricKey: "bogus", value: "x" }, { metricKey: "atr" }, null, { value: "x" }] as any };
    const p = provider({ recommendations: [dirty] });
    const recs = await new GridAdvisorService().recommend(input as any, p);
    expect(recs[0].evidence).toEqual([{ metricKey: "realized_vol", value: "60%" }]);
  });
});

import { describe, it, expect, vi } from "vitest";
import { RecommendationComputeService } from "./recommendation-compute.service";

const klines = [
  { openTime: 0, open: 2300, high: 2400, low: 2250, close: 2350, volume: 100 },
  { openTime: 1, open: 2350, high: 2700, low: 2300, close: 2500, volume: 120 },
];
const recs = [{ label: "T", direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700, mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 0.8, rationale: "x", evidence: [] }];

function settingsMock(provider = "anthropic") {
  return {
    getMasked: vi.fn().mockResolvedValue({ provider, anthropicModel: "claude-opus-4-8", openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false }),
  } as any;
}

function svcWith(provider = "anthropic") {
  const binance = { fetchDailyKlines: vi.fn().mockResolvedValue(klines) };
  const advisor = { recommend: vi.fn().mockResolvedValue(recs) };
  const anthropic = { name: "anthropic" } as any, openai = { name: "openai" } as any;
  const svc = new RecommendationComputeService(binance as any, advisor as any, settingsMock(provider), anthropic, openai);
  return { svc, binance, advisor, anthropic, openai };
}

describe("RecommendationComputeService", () => {
  it("编排 binance→features→advisor 并返回结构，按 settings.provider 选 anthropic", async () => {
    const { svc, advisor, anthropic } = svcWith("anthropic");
    const out = await svc.compute("ETH/USDT", "LONG");
    expect(out.symbol).toBe("ETH/USDT");
    expect(out.currentPrice).toBe(2500);
    // shaping 后每个推荐都带 riskTierFinal（不再等于原始 recs）
    expect(out.recommendations.every((r: any) => r.riskTierFinal && typeof r.riskScore === "number")).toBe(true);
    expect(out.recommendations[0].takeProfitPrice).toBe(2700);
    expect(out.windows["30"]).toBeTruthy();
    expect(out.vpvr.bins.length).toBeGreaterThan(0);
    expect(advisor.recommend).toHaveBeenCalledWith(expect.anything(), anthropic, undefined);
  });

  it("settings.provider=openai 时选 openai provider", async () => {
    const { svc, advisor, openai } = svcWith("openai");
    await svc.compute("ETH/USDT", "LONG");
    expect(advisor.recommend).toHaveBeenCalledWith(expect.anything(), openai, undefined);
  });

  it("direction 非 SHORT 归一为 LONG", async () => {
    const { svc } = svcWith();
    const out = await svc.compute("ETH/USDT", "garbage");
    expect(out.direction).toBe("LONG");
  });

  it("透传生成语言给 advisor，并对结果做 shaping（含 riskTierFinal）", async () => {
    const { svc, advisor } = svcWith();
    const out = await svc.compute("BTCUSDT", "LONG", "中文");
    expect(advisor.recommend).toHaveBeenCalledWith(expect.anything(), expect.anything(), "中文");
    expect(out.recommendations.every((r: any) => r.riskTierFinal)).toBe(true);
  });
});

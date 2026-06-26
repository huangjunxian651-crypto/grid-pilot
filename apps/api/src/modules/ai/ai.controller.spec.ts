import { describe, it, expect, vi } from "vitest";
import { AiController } from "./ai.controller";
import { AiJobService } from "./ai-job.service";

const recs = [{ label: "T", direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700, mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 0.8, rationale: "x", evidence: [] }];
const computed = { symbol: "ETH/USDT", direction: "LONG", asOf: "t", currentPrice: 2500, windows: { "30": {} }, vpvr: { bins: [1] }, recommendations: recs };

function settingsMock(provider = "anthropic") {
  return {
    getMasked: vi.fn().mockResolvedValue({ provider, anthropicModel: "claude-opus-4-8", openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false }),
    upsert: vi.fn().mockResolvedValue({ provider, anthropicModel: "claude-opus-4-8", openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false }),
  } as any;
}

function ctrlWith() {
  const jobs = new AiJobService();
  const compute = { compute: vi.fn().mockResolvedValue(computed) } as any;
  const recommendations = { getLatest: vi.fn().mockResolvedValue([{ symbol: "BTC/USDT", direction: "LONG", recommendations: recs }]) } as any;
  const ctrl = new AiController(settingsMock(), jobs, compute, recommendations);
  return { ctrl, jobs, compute, recommendations };
}
const settle = () => new Promise((r) => setTimeout(r, 15));

describe("AiController", () => {
  it("同步 grid-recommendations 委托 compute 并透传结果与语种", async () => {
    const { ctrl, compute } = ctrlWith();
    const out = await ctrl.gridRecommendations("ETH/USDT", "LONG", "中文");
    expect(compute.compute).toHaveBeenCalledWith("ETH/USDT", "LONG", "中文");
    expect(out.recommendations).toEqual(recs);
  });

  it("GET recommendations/latest 透传 getLatest 与语种（默认 zh）", async () => {
    const { ctrl, recommendations } = ctrlWith();
    const out = await ctrl.latestRecommendations();
    expect(recommendations.getLatest).toHaveBeenCalledWith("zh");
    expect(out[0].symbol).toBe("BTC/USDT");
  });

  it("GET settings 透传 getMasked", async () => {
    const s = settingsMock("anthropic");
    const out = await new AiController(s, {} as any, {} as any, {} as any).getSettings();
    expect(out.provider).toBe("anthropic");
    expect(out.hasAnthropicKey).toBe(true);
  });

  it("PUT settings 调 upsert 并返回脱敏", async () => {
    const s = settingsMock("openai");
    const out = await new AiController(s, {} as any, {} as any, {} as any).updateSettings({ provider: "openai", openaiApiKey: "sk" } as any);
    expect(s.upsert).toHaveBeenCalledWith({ provider: "openai", openaiApiKey: "sk" });
    expect(out.provider).toBe("openai");
  });

  it("异步：startJob 立即返回 jobId(pending)，后台跑完后 getJob 取到结果", async () => {
    const { ctrl } = ctrlWith();
    const { jobId, status } = ctrl.startJob("ETH/USDT", "LONG");
    expect(typeof jobId).toBe("string");
    expect(status).toBe("pending");
    expect(ctrl.getJob(jobId).status).toBe("pending");
    await settle();
    const done = ctrl.getJob(jobId);
    expect(done.status).toBe("done");
    expect((done as { result: { recommendations: unknown } }).result.recommendations).toEqual(recs);
  });

  it("getJob 未知 id 抛 AI_JOB_NOT_FOUND", () => {
    const { ctrl } = ctrlWith();
    expect(() => ctrl.getJob("nope")).toThrowError();
  });
});

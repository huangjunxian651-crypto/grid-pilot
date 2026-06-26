import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiRecommendationService } from "./ai-recommendation.service";
import { RECOMMENDED_SYMBOLS } from "@gridpilot/shared-types";

function makeMock() {
  return {
    aiRecommendation: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function svcWith(opts: { configured?: boolean; compute?: any } = {}) {
  const prisma = makeMock();
  const settings = {
    getMasked: vi.fn().mockResolvedValue({
      provider: "anthropic",
      hasAnthropicKey: opts.configured !== false,
      hasOpenaiKey: false,
      anthropicModel: "claude-opus-4-8", openaiModel: null, openaiBaseUrl: null,
    }),
  };
  const compute = {
    compute: opts.compute ?? vi.fn().mockImplementation(async (symbol: string, direction: string) => ({
      symbol, direction, asOf: "t", currentPrice: 1, windows: {}, vpvr: { bins: [] }, recommendations: [],
    })),
  };
  const svc = new AiRecommendationService(prisma as any, settings as any, compute as any);
  return { svc, prisma, settings, compute };
}

describe("AiRecommendationService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshAll：未配置 LLM 时跳过，不调 compute、不 upsert", async () => {
    const { svc, prisma, compute } = svcWith({ configured: false });
    await svc.refreshAll();
    expect(compute.compute).not.toHaveBeenCalled();
    expect(prisma.aiRecommendation.upsert).not.toHaveBeenCalled();
  });

  it("refreshAll：已配置时对 RECOMMENDED_SYMBOLS × {LONG,SHORT} 各跑一次并 upsert", async () => {
    const { svc, prisma, compute } = svcWith({ configured: true });
    await svc.refreshAll();
    const expected = RECOMMENDED_SYMBOLS.length * 2;
    expect(compute.compute).toHaveBeenCalledTimes(expected);
    expect(prisma.aiRecommendation.upsert).toHaveBeenCalledTimes(expected);
    // upsert 按 (symbol, direction, language) 唯一键写入，后台预热语种 zh
    const firstCall = prisma.aiRecommendation.upsert.mock.calls[0][0];
    expect(firstCall.where.symbol_direction_language).toEqual({ symbol: RECOMMENDED_SYMBOLS[0].symbol, direction: "LONG", language: "zh" });
    expect(firstCall.create.language).toBe("zh");
  });

  it("refreshAll：单个交易对 compute 失败不影响其余继续", async () => {
    const compute = vi.fn().mockImplementation(async (symbol: string) => {
      if (symbol === RECOMMENDED_SYMBOLS[0].symbol) throw new Error("LLM down");
      return { symbol, direction: "LONG", asOf: "t", currentPrice: 1, windows: {}, vpvr: { bins: [] }, recommendations: [] };
    });
    const { svc, prisma } = svcWith({ configured: true, compute });
    await svc.refreshAll();
    // 第一个 symbol 的两次（LONG/SHORT）失败，其余仍 upsert
    const expected = (RECOMMENDED_SYMBOLS.length - 1) * 2;
    expect(prisma.aiRecommendation.upsert).toHaveBeenCalledTimes(expected);
  });

  // 全部组合都新鲜（近 6h 内）→ 跳过，避免每次重启重跑 LLM。
  it("refreshIfStale：所有 symbol×direction 都新鲜时跳过", async () => {
    const { svc, prisma, compute } = svcWith({ configured: true });
    const allFresh = RECOMMENDED_SYMBOLS.flatMap(({ symbol }) =>
      ["LONG", "SHORT"].map((direction) => ({ symbol, direction, result: {}, updatedAt: new Date() })),
    );
    prisma.aiRecommendation.findMany.mockResolvedValue(allFresh);
    await svc.refreshIfStale();
    expect(compute.compute).not.toHaveBeenCalled();
  });

  it("refreshIfStale：无数据时补齐全部组合", async () => {
    const { svc, prisma, compute } = svcWith({ configured: true });
    prisma.aiRecommendation.findMany.mockResolvedValue([]);
    await svc.refreshIfStale();
    expect(compute.compute).toHaveBeenCalledTimes(RECOMMENDED_SYMBOLS.length * 2);
  });

  // 中途重启遗留部分数据：只补缺失/陈旧的组合，不重跑已新鲜的。
  it("refreshIfStale：部分缺失/陈旧时只补缺失的组合", async () => {
    const { svc, prisma, compute } = svcWith({ configured: true });
    const sym0 = RECOMMENDED_SYMBOLS[0].symbol;
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h 前，已陈旧
    prisma.aiRecommendation.findMany.mockResolvedValue([
      { symbol: sym0, direction: "LONG", result: {}, updatedAt: new Date() },   // 新鲜 → 跳过
      { symbol: sym0, direction: "SHORT", result: {}, updatedAt: stale },        // 陈旧 → 重跑
    ]);
    await svc.refreshIfStale();
    // 总组合 = 5×2=10；新鲜 1 个 → 需补 9 个（含陈旧的 sym0 SHORT）
    const expected = RECOMMENDED_SYMBOLS.length * 2 - 1;
    expect(compute.compute).toHaveBeenCalledTimes(expected);
    // 已新鲜的 sym0 LONG 不应被重算
    const calledLongSym0 = compute.compute.mock.calls.some((c: any[]) => c[0] === sym0 && c[1] === "LONG");
    expect(calledLongSym0).toBe(false);
  });

  it("refreshIfStale：未配置 LLM 时跳过", async () => {
    const { svc, compute } = svcWith({ configured: false });
    await svc.refreshIfStale();
    expect(compute.compute).not.toHaveBeenCalled();
  });

  it("getLatest：读取所有已存最近结果并展开 result", async () => {
    const { svc, prisma } = svcWith();
    prisma.aiRecommendation.findMany.mockResolvedValue([
      { symbol: "BTC/USDT", direction: "LONG", result: { recommendations: [{ label: "x" }] }, updatedAt: new Date(0) },
    ]);
    const out = await svc.getLatest();
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe("BTC/USDT");
    expect(out[0].recommendations).toEqual([{ label: "x" }]);
  });

  it("getLatest：非 zh 语种完全无缓存时，zh 全量填充", async () => {
    const { svc, prisma } = svcWith();
    prisma.aiRecommendation.findMany
      .mockResolvedValueOnce([]) // 该语种(ja)零行 → have 集为空，zh 行全部补入
      .mockResolvedValueOnce([{ symbol: "BTC/USDT", direction: "LONG", result: { recommendations: [] }, updatedAt: new Date(0) }]); // zh 全集
    const out = await svc.getLatest("ja");
    expect(out).toHaveLength(1);
    expect(prisma.aiRecommendation.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { language: "ja" } }));
    expect(prisma.aiRecommendation.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { language: "zh" } }));
  });

  it("getLatest：非 zh 语种部分缓存时，逐组合用 zh 补齐缺失的交易对", async () => {
    const { svc, prisma } = svcWith();
    prisma.aiRecommendation.findMany
      // ja 仅有 BTC/LONG 一条（用户生成过单个组合）
      .mockResolvedValueOnce([{ symbol: "BTC/USDT", direction: "LONG", result: { recommendations: [{ label: "ja-btc" }] }, updatedAt: new Date(0) }])
      // zh 全集（BTC/LONG + ETH/LONG）
      .mockResolvedValueOnce([
        { symbol: "BTC/USDT", direction: "LONG", result: { recommendations: [{ label: "zh-btc" }] }, updatedAt: new Date(0) },
        { symbol: "ETH/USDT", direction: "LONG", result: { recommendations: [{ label: "zh-eth" }] }, updatedAt: new Date(0) },
      ]);
    const out = await svc.getLatest("ja");
    // BTC 用 ja、ETH 用 zh 补齐 → 共 2 个，缺失组合不消失
    expect(out).toHaveLength(2);
    const btc = out.find((r) => r.symbol === "BTC/USDT")!;
    const eth = out.find((r) => r.symbol === "ETH/USDT")!;
    expect((btc.recommendations as any)[0].label).toBe("ja-btc"); // ja 优先
    expect((eth.recommendations as any)[0].label).toBe("zh-eth"); // 缺失回退 zh
  });
});

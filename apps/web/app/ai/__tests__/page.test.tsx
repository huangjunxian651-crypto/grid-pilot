import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/ai" }));
vi.mock("@/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useIsTablet: () => false }));
vi.mock("@/lib/hooks/useAuth", () => ({ useAuth: () => ({ data: { id: "u1", email: "t@t.com", displayName: "T", language: "zh" } }), useLogout: () => ({ mutate: vi.fn() }) }));
vi.mock("@/lib/hooks/useNotifications", () => ({ useNotifications: () => ({ unreadCount: 0, notifications: [], prefs: {}, togglePref: () => {} }) }));
vi.mock("@/lib/hooks/useProfile", () => ({ useUpdateProfile: () => ({ mutate: () => {} }) }));
vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh" }) }));

const mutate = vi.fn();
const updateAiMutate = vi.fn();
let mockState: any = { isPending: false, data: undefined, error: null };
let mockAiSettings: any = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
let mockLatest: any = { data: [] };
vi.mock("@/lib/hooks/useAi", () => ({
  useGridRecommendations: () => ({ mutate, ...mockState }),
  useAiSettings: () => ({ data: mockAiSettings }),
  useUpdateAiSettings: () => ({ mutate: updateAiMutate, isPending: false }),
  useLatestRecommendations: () => mockLatest,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AiInsightsPage from "../page";
function wrap(ui: React.ReactNode) {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={c}>{ui}</QueryClientProvider>;
}

describe("AiInsightsPage", () => {
  it("点击生成触发 mutate（带 symbol）", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    render(wrap(<AiInsightsPage />));
    fireEvent.click(screen.getByTestId("ai-generate"));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ symbol: expect.any(String) }), expect.anything());
  });

  it("有数据时渲染推荐卡与「用此配置创建」深链", async () => {
    mockState = { isPending: false, error: null, data: {
      symbol: "ETH/USDT", direction: "LONG", asOf: "", currentPrice: 2500,
      windows: { "30": { days: 30, currentPrice: 2500, high: 2700, low: 2300, rangePct: 17, realizedVol: 60, atr: 80, maxDrawdownPct: 12, trendPct: 5 } },
      vpvr: { priceLow: 2300, priceHigh: 2700, bins: [1, 2, 3] },
      recommendations: [{ label: "Tight", direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700, mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 0.8, riskTierFinal: "high", riskScore: 80, rationale: "x", evidence: [{ metricKey: "realized_vol", value: "60%" }] }],
    } };
    render(wrap(<AiInsightsPage />));
    expect(await screen.findByText("Tight")).toBeTruthy();
    // 风险徽标（high）+ 按 metricKey 的证据 i18n 标签
    expect(screen.getByText("ai.risk.high")).toBeTruthy();
    expect(screen.getByText("ai.metric.realized_vol")).toBeTruthy();
    const link = screen.getByTestId("ai-use-config-0").closest("a");
    expect(link?.getAttribute("href")).toContain("/robots/new?seedBox=");
  });

  it("错误态按 error.code 译编码文案（反映真实 ApiError 形状）", async () => {
    // 真实 fetchJson 抛 ApiError：message 是后端英文内部消息、code 才是错误码。
    const apiError = Object.assign(new Error("ANTHROPIC_API_KEY is not set"), { code: "AI_NOT_CONFIGURED" });
    mockState = { isPending: false, data: undefined, error: apiError };
    render(wrap(<AiInsightsPage />));
    const box = screen.getByTestId("ai-error");
    // i18n mock 直接回 key → 走 code 路径应显示 errors.AI_NOT_CONFIGURED，而非英文 message
    expect(box.textContent).toContain("errors.AI_NOT_CONFIGURED");
    expect(box.textContent).not.toContain("ANTHROPIC_API_KEY is not set");
  });

  it("空白初始态提供内联「生成推荐」CTA，点击触发 mutate", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    render(wrap(<AiInsightsPage />));
    const cta = screen.getByTestId("ai-generate-empty");
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ symbol: expect.any(String) }), expect.anything());
  });

  it("未配置 LLM 时，推荐页就地展示模型配置表单（首次打开即可配置 Token）", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: false, hasOpenaiKey: false };
    render(wrap(<AiInsightsPage />));
    // 就地配置表单（provider 选择 + 保存按钮）应直接可见，无需跳转设置页
    expect(screen.getByTestId("ai-provider-select")).toBeTruthy();
    expect(screen.getByTestId("ai-settings-save")).toBeTruthy();
  });

  it("已配置 LLM 时默认不展开配置表单，但提供「配置模型」入口", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
    render(wrap(<AiInsightsPage />));
    expect(screen.queryByTestId("ai-settings-save")).toBeNull();
    // 入口按钮存在，点击后展开表单
    const toggle = screen.getByTestId("ai-config-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("ai-settings-save")).toBeTruthy();
  });

  it("打开页面即展示每个交易对最近一次分析结果（后台定期分析）", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
    mockLatest = { data: [{
      symbol: "BTC/USDT", direction: "LONG", asOf: "", updatedAt: "2026-06-18T00:00:00Z", currentPrice: 60000,
      windows: {}, vpvr: { priceLow: 0, priceHigh: 0, bins: [] },
      recommendations: [{ label: "Balanced", direction: "LONG", boxLowPrice: 58000, boxHighPrice: 62000, takeProfitPrice: 62000, mainGridCount: 30, mainGridStep: 100, mainGridPortionSize: 0.001, leverage: 10, stopLossGridCount: 4, stopLossGridStep: 50, isolationStep: 50, confidence: 0.7, rationale: "r", evidence: [] }],
    }] };
    render(wrap(<AiInsightsPage />));
    expect(await screen.findByText("ai.latest_title")).toBeTruthy();
    expect(screen.getByText("Balanced")).toBeTruthy();
    // BTC/USDT 既出现在顶部 symbol select 选项、也出现在最近卡，故用 getAllByText
    expect(screen.getAllByText(/BTC\/USDT/).length).toBeGreaterThanOrEqual(1);
    mockLatest = { data: [] };
  });

  it("顶部交易对用 select 选择，预置对来自 RECOMMENDED_SYMBOLS", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
    render(wrap(<AiInsightsPage />));
    const sel = screen.getByTestId("ai-symbol-select") as HTMLSelectElement;
    expect(sel.tagName).toBe("SELECT");
    expect(sel.value).toBe("ETH/USDT");
    const opts = Array.from(sel.querySelectorAll("option")).map((o) => o.value);
    expect(opts).toEqual(["BTC/USDT", "ETH/USDT", "BNB/USDT", "SOL/USDT", "XRP/USDT"]);
  });

  it("方向选项走 i18n（dir.LONG / dir.SHORT），不硬编码英文", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
    render(wrap(<AiInsightsPage />));
    const dir = screen.getByTestId("ai-direction-select") as HTMLSelectElement;
    const labels = Array.from(dir.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toEqual(["dir.LONG", "dir.SHORT"]);
  });

  it("最近分析卡的方向徽标走 i18n（dir.LONG），不显示原始 LONG", async () => {
    mockState = { isPending: false, data: undefined, error: null };
    mockAiSettings = { provider: "anthropic", anthropicModel: "claude-opus-4-8", anthropicBaseUrl: null, openaiModel: null, openaiBaseUrl: null, hasAnthropicKey: true, hasOpenaiKey: false };
    mockLatest = { data: [{
      symbol: "BTC/USDT", direction: "LONG", asOf: "", updatedAt: "2026-06-18T00:00:00Z", currentPrice: 60000,
      windows: {}, vpvr: { priceLow: 0, priceHigh: 0, bins: [] },
      recommendations: [{ label: "Balanced", direction: "LONG", boxLowPrice: 58000, boxHighPrice: 62000, takeProfitPrice: 62000, mainGridCount: 30, mainGridStep: 100, mainGridPortionSize: 0.001, leverage: 10, stopLossGridCount: 4, stopLossGridStep: 50, isolationStep: 50, confidence: 0.7, rationale: "r", evidence: [] }],
    }] };
    render(wrap(<AiInsightsPage />));
    // 徽标译成 dir.LONG（与方向 select 选项同文案，故至少 2 处），且不再出现原始未翻译的 "LONG"
    expect(screen.getAllByText("dir.LONG").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("LONG")).toBeNull();
    mockLatest = { data: [] };
  });

  it("推荐缺 evidence 字段也不崩（非严格 JSON 兜底）", async () => {
    // 模拟某条推荐缺 evidence（前端不得假设字段存在而 .map 崩溃 → 整页空白）
    const recNoEvidence: any = { label: "NoEv", direction: "LONG", boxLowPrice: 2300, boxHighPrice: 2700, takeProfitPrice: 2700, mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5, confidence: 0.8, rationale: "x" };
    mockState = { isPending: false, error: null, data: {
      symbol: "ETH/USDT", direction: "LONG", asOf: "", currentPrice: 2500,
      windows: { "30": { days: 30, currentPrice: 2500, high: 2700, low: 2300, rangePct: 17, realizedVol: 60, atr: 80, maxDrawdownPct: 12, trendPct: 5 } },
      vpvr: { priceLow: 2300, priceHigh: 2700, bins: [1, 2, 3] },
      recommendations: [recNoEvidence],
    } };
    render(wrap(<AiInsightsPage />));
    // 卡片照常渲染，不抛异常导致整片空白
    expect(await screen.findByText("NoEv")).toBeTruthy();
  });
});

import { Inject, Injectable } from "@nestjs/common";
import { BinanceMarketService } from "./binance-market.service";
import { GridAdvisorService } from "./grid-advisor.service";
import { AiSettingsService } from "./ai-settings.service";
import { computeWindowFeatures, computeVpvr, type WindowFeatures } from "./market-features";
import { shapeRecommendations } from "./recommendation-shaping";
import type { LlmProvider } from "./providers/llm-provider.interface";
import { AnthropicProvider } from "./providers/anthropic.provider";
import { OpenAiProvider } from "./providers/openai.provider";

const WINDOWS = [30, 90, 180, 364];

/**
 * AI 箱体推荐的编排：拉币安日线 → 切窗算特征+VPVR → 按 DB 配置选 provider →
 * LLM 生成 → 二次校验。供同步/异步接口与后台定时分析共用单一来源（DRY）。
 */
@Injectable()
export class RecommendationComputeService {
  constructor(
    private readonly binance: BinanceMarketService,
    private readonly advisor: GridAdvisorService,
    private readonly settings: AiSettingsService,
    @Inject(AnthropicProvider) private readonly anthropic: LlmProvider,
    @Inject(OpenAiProvider) private readonly openai: LlmProvider,
  ) {}

  async compute(symbol: string, direction: string, language?: string) {
    const dir = direction === "SHORT" ? "SHORT" : "LONG";
    const klines = await this.binance.fetchDailyKlines(symbol);
    const currentPrice = klines.length ? klines[klines.length - 1].close : 0;
    const windows: Record<string, WindowFeatures> = {};
    for (const d of WINDOWS) windows[String(d)] = computeWindowFeatures(klines.slice(-d));
    const vpvr = computeVpvr(klines.slice(-180), 24);
    const masked = await this.settings.getMasked();
    const provider = masked.provider === "openai" ? this.openai : this.anthropic;
    // 用最长窗口的 atr 做风险派生的波动基准（兜底取任一可得窗口）。
    const longest = WINDOWS[WINDOWS.length - 1];
    const atr = windows[String(longest)]?.atr ?? Object.values(windows).find((w) => w.atr > 0)?.atr ?? 0;
    const raw = await this.advisor.recommend({ symbol, direction: dir, currentPrice, windows, vpvr }, provider, language);
    const recommendations = shapeRecommendations(raw, atr);
    return { symbol, direction: dir, asOf: new Date().toISOString(), currentPrice, windows, vpvr, recommendations };
  }
}

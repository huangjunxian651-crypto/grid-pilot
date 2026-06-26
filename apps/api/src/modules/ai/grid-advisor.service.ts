import { Injectable, BadRequestException } from "@nestjs/common";
import type { LlmProvider } from "./providers/llm-provider.interface";
import {
  GRID_RECS_SCHEMA, buildSystemPrompt, buildUserPrompt, EVIDENCE_METRIC_KEYS, resolveLanguageName,
  type EvidenceMetricKey, type GridAdvisorInput, type GridRecommendation,
} from "./providers/grid-advisor.types";

@Injectable()
export class GridAdvisorService {
  /** 用给定 provider 生成推荐；后端二次校验过滤非法项。language 指定 label/rationale 的生成语言。 */
  async recommend(input: GridAdvisorInput, provider: LlmProvider, language?: string): Promise<GridRecommendation[]> {
    // 把语言代码（zh/ja/…）解析为可读名再喂给 LLM，避免简/繁中文等被误判。
    const langName = resolveLanguageName(language);
    const system = buildSystemPrompt(langName);
    const user = buildUserPrompt(input, langName);
    const out = await provider.completeJson<{ recommendations: GridRecommendation[] }>(system, user, GRID_RECS_SCHEMA as unknown as object);
    const all = Array.isArray(out?.recommendations) ? out.recommendations : [];
    const valid = all.filter((r) => this.isValid(r)).map((r) => this.normalize(r));
    if (valid.length === 0) {
      throw new BadRequestException({ code: "AI_LLM_FAILED", message: "No valid recommendations produced" });
    }
    return valid;
  }

  /**
   * 补齐展示型字段，保证返回项符合 GridRecommendation 契约——前端按必填字段渲染（如 rec.evidence.map）才不会崩。
   * 非严格 JSON 模式（OpenAI/DeepSeek）可能漏掉 evidence/label/rationale 或返回越界 confidence，isValid 只管数值约束，故在此兜底。
   */
  private normalize(r: GridRecommendation): GridRecommendation {
    const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
    const confidence = typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.min(1, Math.max(0, r.confidence))
      : 0;
    const metricKeys = new Set<EvidenceMetricKey>(EVIDENCE_METRIC_KEYS);
    const evidence = Array.isArray(r.evidence)
      ? r.evidence
          .filter((e) => e && metricKeys.has(e.metricKey) && typeof e.value === "string")
          .map((e) => ({ metricKey: e.metricKey, value: e.value }))
      : [];
    return {
      ...r,
      direction: r.direction === "SHORT" ? "SHORT" : "LONG",
      label: str(r.label, "Recommendation"),
      rationale: str(r.rationale),
      confidence,
      evidence,
    };
  }

  private isValid(r: GridRecommendation): boolean {
    if (!r) return false;
    if (!(r.boxLowPrice > 0) || !(r.boxHighPrice > 0) || r.boxLowPrice >= r.boxHighPrice) return false;
    if (!(r.takeProfitPrice > 0) || r.takeProfitPrice < r.boxLowPrice || r.takeProfitPrice > r.boxHighPrice) return false;
    if (!(r.mainGridCount >= 1) || !(r.mainGridStep > 0) || !(r.mainGridPortionSize > 0) || !(r.leverage >= 1)) return false;
    if (r.stopLossGridCount > 0 && (!(r.stopLossGridStep > 0) || !(r.isolationStep > 0))) return false;
    return true;
  }
}

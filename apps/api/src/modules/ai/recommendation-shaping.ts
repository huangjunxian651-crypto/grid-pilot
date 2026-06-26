// 推荐 shaping：用 deriveRisk 标注最终风险；若集合无 low/mid 档（全高风险），
// 确定性合成一个稳健变体补上；最后按 low→mid→high 稳健优先排序。
import { validateBoxGeometry, type BoxGeometryConfig } from '@gridpilot/shared-types';
import { deriveRisk, type RiskTier } from './risk-score';
import type { GridRecommendation } from './providers/grid-advisor.types';

const TIER_ORDER: Record<RiskTier, number> = { low: 0, mid: 1, high: 2 };

function annotate(rec: GridRecommendation, atr: number): GridRecommendation {
  const { tier, score } = deriveRisk({
    leverage: rec.leverage,
    stopLossGridCount: rec.stopLossGridCount,
    boxLowPrice: rec.boxLowPrice,
    boxHighPrice: rec.boxHighPrice,
    atr,
  });
  return { ...rec, riskTierFinal: tier, riskScore: score };
}

function geometryOf(rec: GridRecommendation): BoxGeometryConfig {
  return {
    takeProfitPrice: rec.takeProfitPrice,
    direction: rec.direction,
    mainGridCount: rec.mainGridCount,
    mainGridStep: rec.mainGridStep,
    stopLossGridCount: rec.stopLossGridCount,
    stopLossGridStep: rec.stopLossGridStep,
    isolationStep: rec.isolationStep,
  };
}

/** 重算展示用 boxLow/High，使其与（可能拓宽后的）主网深度一致。 */
function withDisplayBox(rec: GridRecommendation): GridRecommendation {
  const depth = rec.mainGridCount * rec.mainGridStep;
  if (rec.direction === 'LONG') {
    return { ...rec, boxHighPrice: rec.takeProfitPrice, boxLowPrice: rec.takeProfitPrice - depth };
  }
  return { ...rec, boxLowPrice: rec.takeProfitPrice, boxHighPrice: rec.takeProfitPrice + depth };
}

/**
 * 从一个（高风险）源推荐确定性合成稳健变体：限杠杆≤3、补止损、拓宽箱体；
 * 必须过 validateBoxGeometry，否则回退最小稳健化（仅限杠杆+加安全止损），仍不过则返回 null（跳过合成）。
 * label/rationale 置空——前端用固定 i18n 文案键渲染（不再发 LLM）。
 */
function synthesizeConservative(src: GridRecommendation, atr: number): GridRecommendation | null {
  const newStep = src.mainGridStep * 1.5;
  const mainDepth = src.mainGridCount * newStep;
  const stopLossGridCount = 2;
  // 止损区间留足余量（≤ 主网深度/5 的 0.8 倍）
  const stopLossGridStep = Math.max((mainDepth / 5 / stopLossGridCount) * 0.8, 1e-9);
  const widened: GridRecommendation = withDisplayBox({
    ...src,
    leverage: Math.min(src.leverage, 3),
    mainGridStep: newStep,
    stopLossGridCount,
    stopLossGridStep,
    isolationStep: newStep,
    label: '',
    rationale: '',
  });
  if (validateBoxGeometry(geometryOf(widened)).valid) {
    return annotate(widened, atr);
  }
  // 回退：保持原箱体，仅限杠杆 + 补一个安全止损
  const srcDepth = src.mainGridCount * src.mainGridStep;
  const fbStep = Math.max((srcDepth / 5 / stopLossGridCount) * 0.8, 1e-9);
  const minimal: GridRecommendation = {
    ...src,
    leverage: Math.min(src.leverage, 3),
    stopLossGridCount: src.stopLossGridCount > 0 ? src.stopLossGridCount : stopLossGridCount,
    stopLossGridStep: src.stopLossGridCount > 0 ? src.stopLossGridStep : fbStep,
    isolationStep: src.isolationStep > 0 ? src.isolationStep : src.mainGridStep,
    label: '',
    rationale: '',
  };
  if (validateBoxGeometry(geometryOf(minimal)).valid) {
    return annotate(minimal, atr);
  }
  return null;
}

export function shapeRecommendations(recs: GridRecommendation[], atr: number): GridRecommendation[] {
  const annotated = recs.map((r) => annotate(r, atr));
  let result = annotated;
  const hasSafe = annotated.some((r) => r.riskTierFinal === 'low' || r.riskTierFinal === 'mid');
  if (!hasSafe && annotated.length > 0) {
    // 取风险分最低者作合成源
    const src = [...annotated].sort((a, b) => (a.riskScore ?? 0) - (b.riskScore ?? 0))[0];
    const synth = synthesizeConservative(src, atr);
    if (synth) result = [...annotated, synth];
  }
  return [...result].sort(
    (a, b) => TIER_ORDER[a.riskTierFinal ?? 'high'] - TIER_ORDER[b.riskTierFinal ?? 'high'],
  );
}

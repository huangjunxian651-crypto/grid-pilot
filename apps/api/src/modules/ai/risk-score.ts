// 由网格配置确定性派生风险等级。混合策略中以本派生值为最终风险（LLM 自报仅作 hint）。
// 权重/阈值集中此处，便于调整；单测固定边界行为。
export type RiskTier = 'low' | 'mid' | 'high';

export interface RiskInput {
  leverage: number;
  stopLossGridCount: number;
  boxLowPrice: number;
  boxHighPrice: number;
  atr: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const W_LEVERAGE = 45; // 杠杆为主因：lev 1→0 分，lev≥10→满分
const W_NO_STOPLOSS = 25; // 无止损额外风险
const W_NARROW = 30; // 箱体相对波动过窄（易被打出/触止损）
const EXPECTED_MOVE_ATR_MULT = 4; // 一个分析窗的合理波动幅度 ≈ atr×4
const TIER_LOW_MAX = 30;
const TIER_MID_MAX = 60;

export function deriveRisk(input: RiskInput): { tier: RiskTier; score: number } {
  const { leverage, stopLossGridCount, boxLowPrice, boxHighPrice, atr } = input;
  let score = clamp((leverage - 1) / 9, 0, 1) * W_LEVERAGE;
  score += stopLossGridCount === 0 ? W_NO_STOPLOSS : 0;
  const boxDepth = Math.max(boxHighPrice - boxLowPrice, 0);
  const expectedMove = Math.max(atr * EXPECTED_MOVE_ATR_MULT, 1e-9);
  score += (1 - clamp(boxDepth / expectedMove, 0, 1)) * W_NARROW;
  score = clamp(score, 0, 100);
  const tier: RiskTier = score < TIER_LOW_MAX ? 'low' : score <= TIER_MID_MAX ? 'mid' : 'high';
  return { tier, score: Math.round(score) };
}

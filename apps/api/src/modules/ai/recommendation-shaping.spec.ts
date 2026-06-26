import { describe, it, expect } from 'vitest';
import { shapeRecommendations } from './recommendation-shaping';

const base = {
  label: '进取', direction: 'LONG',
  boxLowPrice: 100, boxHighPrice: 104, takeProfitPrice: 103,
  mainGridCount: 8, mainGridStep: 0.5, mainGridPortionSize: 1, leverage: 12,
  stopLossGridCount: 0, stopLossGridStep: 0, isolationStep: 0,
  confidence: 0.6, rationale: 'x', evidence: [],
} as any;

describe('shapeRecommendations', () => {
  it('全高风险时合成一个稳健变体并排前', () => {
    const out = shapeRecommendations([{ ...base }, { ...base }], 4);
    expect(out.some((r) => r.riskTierFinal === 'low' || r.riskTierFinal === 'mid')).toBe(true);
    expect(['low', 'mid']).toContain(out[0].riskTierFinal); // 稳健优先排序
    const synth = out.find((r) => r.leverage <= 3)!;
    expect(synth).toBeTruthy();
    expect(synth.stopLossGridCount).toBeGreaterThan(0); // 无止损被补上
  });

  it('每个 rec 都标注 riskTierFinal 与 riskScore', () => {
    const out = shapeRecommendations([{ ...base }], 4);
    expect(out.every((r) => r.riskTierFinal && typeof r.riskScore === 'number')).toBe(true);
  });

  it('已有低风险则不合成，按 low→high 排序', () => {
    const low = { ...base, leverage: 2, stopLossGridCount: 3, stopLossGridStep: 0.5, isolationStep: 0.5, boxLowPrice: 100, boxHighPrice: 130 };
    const out = shapeRecommendations([{ ...base }, low], 4);
    expect(out[0].riskTierFinal).toBe('low');
    expect(out.length).toBe(2); // 未新增合成
  });
});

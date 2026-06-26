import { describe, it, expect } from 'vitest';
import { deriveRisk } from './risk-score';

describe('deriveRisk', () => {
  it('低杠杆+带止损+宽箱 → low', () => {
    expect(
      deriveRisk({ leverage: 2, stopLossGridCount: 3, boxLowPrice: 100, boxHighPrice: 140, atr: 4 }).tier,
    ).toBe('low');
  });
  it('高杠杆(≥10) → high', () => {
    expect(
      deriveRisk({ leverage: 12, stopLossGridCount: 0, boxLowPrice: 100, boxHighPrice: 104, atr: 4 }).tier,
    ).toBe('high');
  });
  it('无止损+中杠杆+窄箱 → 偏高', () => {
    const r = deriveRisk({ leverage: 6, stopLossGridCount: 0, boxLowPrice: 100, boxHighPrice: 103, atr: 4 });
    expect(r.tier === 'mid' || r.tier === 'high').toBe(true);
  });
  it('score 钳在 0..100', () => {
    const r = deriveRisk({ leverage: 50, stopLossGridCount: 0, boxLowPrice: 100, boxHighPrice: 101, atr: 10 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

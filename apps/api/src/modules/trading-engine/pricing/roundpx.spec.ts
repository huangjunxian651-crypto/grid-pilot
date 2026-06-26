import { describe, it, expect } from 'vitest';
import { roundToTick, calculateOptimalPrice } from './pricing';

describe('roundToTick (T10): non-decimal tickSize rounding', () => {
  // T10: roundToTick aligns with Go utils/precision.go RoundPrice.
  // Go uses math.Round(p*(1/tick)) / (1/tick), same as our implementation.

  it('rounds correctly for tickSize=0.05', () => {
    expect(roundToTick(100.05, 0.05)).toBeCloseTo(100.05, 4);
    // 100.025 * 20 = 2000.5, Math.round(2000.5) = 2001 → 100.05 (round-half-up)
    expect(roundToTick(100.025, 0.05)).toBeCloseTo(100.05, 4);
    expect(roundToTick(100.075, 0.05)).toBeCloseTo(100.10, 4);
    // Exact midpoint below: 100.00 is on-tick
    expect(roundToTick(100.00, 0.05)).toBeCloseTo(100.00, 4);
  });

  it('rounds correctly for tickSize=0.25', () => {
    expect(roundToTick(100.25, 0.25)).toBeCloseTo(100.25, 4);
    expect(roundToTick(100.10, 0.25)).toBeCloseTo(100.00, 4);
    // 100.20 * 4 = 400.8, round = 401 → 100.25
    expect(roundToTick(100.20, 0.25)).toBeCloseTo(100.25, 4);
  });

  it('rounds correctly for tickSize=0.005', () => {
    expect(roundToTick(100.005, 0.005)).toBeCloseTo(100.005, 4);
    expect(roundToTick(100.002, 0.005)).toBeCloseTo(100.000, 4);
    expect(roundToTick(100.003, 0.005)).toBeCloseTo(100.005, 4);
  });

  it('still works for standard tickSize=0.01 (decimal)', () => {
    expect(roundToTick(2197.83, 0.01)).toBeCloseTo(2197.83, 4);
  });

  it('still works for tickSize=1 (integer)', () => {
    expect(roundToTick(100, 1)).toBeCloseTo(100, 4);
    expect(roundToTick(100.4, 1)).toBeCloseTo(100, 4);
    expect(roundToTick(100.5, 1)).toBeCloseTo(101, 4);
  });

  it('GTC price is tick-aligned for non-decimal tickSize via calculateOptimalPrice', () => {
    // gridPrice=100.05, market=95.00, gtcThreshold=0.05
    // BUY gtcPrice = roundToTick(100.05 * 0.95, 0.05) = roundToTick(95.0475, 0.05) = 95.05
    // market(95.00) < gtcPrice(95.05) → GTC
    const result = calculateOptimalPrice({
      side: 'BUY',
      gridPrice: 100.05,
      marketPrice: 95.00,
      tickSize: 0.05,
      gtcThreshold: 0.05,
    });
    expect(result.zone).toBe('GTC');
    expect(result.actualPrice).toBeCloseTo(95.05, 4);
  });
});

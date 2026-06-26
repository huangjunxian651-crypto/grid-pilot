import { describe, it, expect } from 'vitest';
import { effectiveGtcThreshold } from './index';

// F16 (user-corrected semantics): gtcThreshold is user-configurable, but it must never be
// LOWER than ExcessProfitMultiplier × takerFeeRate — otherwise crossing the spread (taker)
// captures less edge than the taker fee paid. So the effective threshold is the floor-clamped
// user value. ExcessProfitMultiplier defaults to 2.0 (Go config.go:258).
describe('effectiveGtcThreshold (F16)', () => {
  it('returns the user value when it already clears the floor', () => {
    // floor = 2 * 0.0005 = 0.001; user 0.002 > floor → keep 0.002.
    expect(effectiveGtcThreshold({ gtcThreshold: 0.002, excessProfitMultiplier: 2, takerFeeRate: 0.0005 })).toBe(0.002);
  });

  it('raises a too-small user value up to the floor', () => {
    // floor = 2 * 0.0005 = 0.001; user 0.0003 < floor → clamp to 0.001.
    expect(effectiveGtcThreshold({ gtcThreshold: 0.0003, excessProfitMultiplier: 2, takerFeeRate: 0.0005 })).toBeCloseTo(0.001, 10);
  });

  it('defaults ExcessProfitMultiplier to 2.0 when unset or <= 0', () => {
    // floor = 2 * 0.0004 = 0.0008.
    expect(effectiveGtcThreshold({ gtcThreshold: 0, excessProfitMultiplier: 0, takerFeeRate: 0.0004 })).toBeCloseTo(0.0008, 10);
    expect(effectiveGtcThreshold({ gtcThreshold: 0, takerFeeRate: 0.0004 })).toBeCloseTo(0.0008, 10);
  });

  it('falls back to the raw user threshold when no taker fee is available (no floor)', () => {
    expect(effectiveGtcThreshold({ gtcThreshold: 0.0012 })).toBe(0.0012);
  });
});

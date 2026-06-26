import { describe, it, expect } from 'vitest';
import { computeRealizedPnl, type FillLite } from './compute-realized-pnl';

const f = (side: 'BUY' | 'SELL', qty: number, price: number, ts = 0): FillLite => ({ side, fillQty: qty, fillPrice: price, ts });

describe('computeRealizedPnl', () => {
  it('returns 0 for no fills', () => {
    expect(computeRealizedPnl([])).toBe(0);
  });

  it('returns 0 for an open position with no closing sells', () => {
    expect(computeRealizedPnl([f('BUY', 1, 2000)])).toBe(0);
  });

  it('computes profit on a simple buy-low sell-high round trip', () => {
    // buy 1 @2000, sell 1 @2100 → +100
    expect(computeRealizedPnl([f('BUY', 1, 2000, 1), f('SELL', 1, 2100, 2)])).toBeCloseTo(100, 6);
  });

  it('computes loss on buy-high sell-low', () => {
    expect(computeRealizedPnl([f('BUY', 1, 2100, 1), f('SELL', 1, 2000, 2)])).toBeCloseTo(-100, 6);
  });

  it('uses weighted average cost across multiple buys', () => {
    // buy 1@2000, buy 1@2200 → avg 2100; sell 2@2300 → (2300-2100)*2 = 400
    expect(computeRealizedPnl([f('BUY', 1, 2000, 1), f('BUY', 1, 2200, 2), f('SELL', 2, 2300, 3)])).toBeCloseTo(400, 6);
  });

  it('only realizes the closed portion on a partial sell', () => {
    // buy 2@2000, sell 1@2100 → (2100-2000)*1 = 100 (1 still held)
    expect(computeRealizedPnl([f('BUY', 2, 2000, 1), f('SELL', 1, 2100, 2)])).toBeCloseTo(100, 6);
  });

  it('accumulates across multiple round trips', () => {
    // +100 then +50
    const fills = [f('BUY', 1, 2000, 1), f('SELL', 1, 2100, 2), f('BUY', 1, 2000, 3), f('SELL', 1, 2050, 4)];
    expect(computeRealizedPnl(fills)).toBeCloseTo(150, 6);
  });

  it('sorts by ts before processing (out-of-order input)', () => {
    // same as round trip but reversed input order
    expect(computeRealizedPnl([f('SELL', 1, 2100, 2), f('BUY', 1, 2000, 1)])).toBeCloseTo(100, 6);
  });
});

import { describe, it, expect } from 'vitest';
import { calculateOptimalPrice } from '../pricing';

describe('pricing.calculateOptimalPrice (contract)', () => {
  describe('BUY zone partitioning', () => {
    it('returns BLOCKED when marketPrice > gridPrice (BUY)', () => {
      const decision = calculateOptimalPrice({
        side: 'BUY',
        gridPrice: 2200,
        marketPrice: 2201,
        tickSize: 0.01,
        gtcThreshold: 0.001,
      });
      expect(decision.zone).toBe('BLOCKED');
      expect(decision.tif).toBe('NONE');
      expect(decision.actualPrice).toBe(0);
    });

    it('returns POC zone with maker-safe actualPrice = market − tick when (1 - gtc) * grid < market <= grid (BUY)', () => {
      // gridPrice=2200, gtcThreshold=0.001 → gtcPrice=2197.8
      // market in (2197.8, 2200] → POC
      const decision = calculateOptimalPrice({
        side: 'BUY',
        gridPrice: 2200,
        marketPrice: 2199,
        tickSize: 0.01,
        gtcThreshold: 0.001,
      });
      expect(decision.zone).toBe('POC');
      expect(decision.tif).toBe('POC');
      expect(decision.actualPrice).toBe(2198.99);
    });

    it('returns GTC zone with actualPrice = min(gtcPrice, market*1.02) when market <= gtcPrice (BUY)', () => {
      const decision = calculateOptimalPrice({
        side: 'BUY',
        gridPrice: 2200,
        marketPrice: 2150, // well below gtcPrice 2197.8
        tickSize: 0.01,
        gtcThreshold: 0.001,
      });
      expect(decision.zone).toBe('GTC');
      expect(decision.tif).toBe('GTC');
      // gtcPrice = 2197.8, market*1.02 = 2193 → min = 2193
      expect(decision.actualPrice).toBeCloseTo(2193, 2);
    });
  });

  it('rounds output prices to tickSize', () => {
    const d = calculateOptimalPrice({ side: 'BUY', gridPrice: 2200.123, marketPrice: 2199.876, tickSize: 0.1, gtcThreshold: 0.001 });
    expect(d.actualPrice).toBeCloseTo(2199.8, 3); // POC = roundToTick(market) − tick = 2199.9 − 0.1
  });

  it('returns clean decimal price free of IEEE 754 residue at tick=0.01', () => {
    // grid * (1 + 0.001) = 2200 * 1.001 = 2202.2 — typical SELL gtcPrice
    // Plain Math.round produces 2202.2000000000003; we want exact 2202.2.
    const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2210, tickSize: 0.01, gtcThreshold: 0.001 });
    expect(d.zone).toBe('GTC');
    // actualPrice = max(gtcPrice=2202.2, market*0.98=2165.8) = 2202.2
    expect(d.actualPrice).toBe(2202.2);             // strict equality, not toBeCloseTo
    expect(String(d.actualPrice)).toBe('2202.2');   // no trailing zeros / residue
  });

  describe('SELL zone partitioning (symmetric)', () => {
    it('returns BLOCKED when marketPrice < gridPrice (SELL)', () => {
      const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2199, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('BLOCKED');
    });
    it('returns POC at maker-safe market + tick for SELL in POC zone', () => {
      const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2201, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('POC');
      expect(d.actualPrice).toBe(2201.01);
    });
    it('returns GTC with actualPrice = max(gtcPrice, market*0.98) for SELL well above grid', () => {
      // gridPrice=2200, gtcPrice=2202.2, market=2250 → max(2202.2, 2205) = 2205
      const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2250, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('GTC');
      expect(d.actualPrice).toBeCloseTo(2205, 2);
    });
  });

  describe('boundary conditions', () => {
    it('returns POC (not BLOCKED) when marketPrice == gridPrice (BUY)', () => {
      const d = calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2200, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('POC');
      expect(d.actualPrice).toBe(2199.99); // market==grid==2200 → market − tick
    });

    it('returns POC (not BLOCKED) when marketPrice == gridPrice (SELL)', () => {
      const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2200, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('POC');
      expect(d.actualPrice).toBe(2200.01); // market==grid==2200 → market + tick
    });

    it('returns GTC when marketPrice == gtcPrice (BUY, boundary)', () => {
      // gtcPrice = 2200 * (1 - 0.001) = 2197.8
      const d = calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2197.8, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('GTC');
    });

    it('returns GTC when marketPrice == gtcPrice (SELL, boundary)', () => {
      // gtcPrice = 2200 * (1 + 0.001) = 2202.2
      const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2202.2, tickSize: 0.01, gtcThreshold: 0.001 });
      expect(d.zone).toBe('GTC');
    });
  });
});

describe('pricing contract — GTC clamp (Go pricing.go:141-142,167-168)', () => {
  it('BUY GTC clamps to min(gtcPrice, market*1.02), never above gridPrice', () => {
    const r = calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2100, tickSize: 0.1, gtcThreshold: 0.001 });
    expect(r.zone).toBe('GTC');
    // gtcPrice=2197.8, market*1.02=2142 → min=2142
    expect(r.actualPrice).toBeCloseTo(2142, 1);
    expect(r.actualPrice).toBeLessThanOrEqual(2200);
  });
  it('SELL GTC clamps to max(gtcPrice, market*0.98), never below gridPrice', () => {
    const r = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2300, tickSize: 0.1, gtcThreshold: 0.001 });
    expect(r.zone).toBe('GTC');
    // gtcPrice=2202.2, market*0.98=2254 → max=2254
    expect(r.actualPrice).toBeCloseTo(2254, 1);
    expect(r.actualPrice).toBeGreaterThanOrEqual(2200);
  });
});

describe('pricing contract — melt zone boundary strict (Go pricing.go:131,158)', () => {
  it('BUY blocks only when market strictly above gridPrice (== is POC)', () => {
    expect(calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2200.1, tickSize: 0.1, gtcThreshold: 0.001 }).zone).toBe('BLOCKED');
    expect(calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2200, tickSize: 0.1, gtcThreshold: 0.001 }).zone).toBe('POC');
  });
  it('SELL blocks only when market strictly below gridPrice (== is POC)', () => {
    expect(calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2199.9, tickSize: 0.1, gtcThreshold: 0.001 }).zone).toBe('BLOCKED');
    expect(calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2200, tickSize: 0.1, gtcThreshold: 0.001 }).zone).toBe('POC');
  });
});

describe('pricing contract — POC maker-safety (post-only never crosses)', () => {
  it('BUY POC prices strictly below marketPrice (bestAsk) at market − tick', () => {
    const d = calculateOptimalPrice({ side: 'BUY', gridPrice: 2200, marketPrice: 2199, tickSize: 0.01, gtcThreshold: 0.001 });
    expect(d.zone).toBe('POC');
    expect(d.actualPrice).toBe(2198.99);          // market − tick
    expect(d.actualPrice).toBeLessThan(2199);     // 永不 >= bestAsk → 不会被 post-only 拒
    expect(d.actualPrice).toBeLessThanOrEqual(2200); // 不超过网格线
  });

  it('SELL POC prices strictly above marketPrice (bestBid) at market + tick', () => {
    const d = calculateOptimalPrice({ side: 'SELL', gridPrice: 2200, marketPrice: 2201, tickSize: 0.01, gtcThreshold: 0.001 });
    expect(d.zone).toBe('POC');
    expect(d.actualPrice).toBe(2201.01);          // market + tick
    expect(d.actualPrice).toBeGreaterThan(2201);  // 永不 <= bestBid
    expect(d.actualPrice).toBeGreaterThanOrEqual(2200); // 不低于网格线
  });
});

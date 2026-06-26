import { describe, it, expect } from "vitest";
import { computeWindowFeatures, computeVpvr, type Kline } from "./market-features";

const mk = (close: number, high = close, low = close, volume = 1): Kline =>
  ({ openTime: 0, open: close, high, low, close, volume });

describe("market-features", () => {
  it("computeWindowFeatures 算 high/low/rangePct/trendPct", () => {
    const ks: Kline[] = [mk(100, 110, 90, 1), mk(120, 130, 95, 1), mk(150, 160, 140, 1)];
    const f = computeWindowFeatures(ks);
    expect(f.high).toBe(160);
    expect(f.low).toBe(90);
    expect(f.currentPrice).toBe(150);
    expect(Math.round(f.trendPct)).toBe(50);
    expect(f.rangePct).toBeGreaterThan(0);
  });

  it("realizedVol 对恒定价格为 0", () => {
    const ks = [mk(100), mk(100), mk(100), mk(100)];
    expect(computeWindowFeatures(ks).realizedVol).toBe(0);
  });

  it("maxDrawdownPct 反映从峰值的最大回撤", () => {
    const ks = [mk(100), mk(200), mk(100)];
    expect(Math.round(computeWindowFeatures(ks).maxDrawdownPct)).toBe(50);
  });

  it("computeVpvr 把成交量按价分桶，桶数与边界正确", () => {
    const ks = [mk(100, 100, 100, 5), mk(200, 200, 200, 15)];
    const v = computeVpvr(ks, 4);
    expect(v.bins.length).toBe(4);
    expect(v.priceLow).toBe(100);
    expect(v.priceHigh).toBe(200);
    expect(v.bins.reduce((a, b) => a + b, 0)).toBeCloseTo(20);
  });

  it("空数组安全返回零值", () => {
    const f = computeWindowFeatures([]);
    expect(f.currentPrice).toBe(0);
    expect(computeVpvr([], 4).bins.length).toBe(4);
  });
});

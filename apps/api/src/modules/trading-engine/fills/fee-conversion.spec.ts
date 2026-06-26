import { describe, it, expect } from 'vitest';
import { feeInQuote } from './fee-conversion';

describe('feeInQuote', () => {
  it('feeAsset 为计价货币(USDT) → 原样', () => {
    expect(feeInQuote(0.4, 'USDT', 'ETH/USDT', 2000)).toBeCloseTo(0.4, 8);
  });
  it('feeAsset 为基础币(ETH) → 按成交价折算', () => {
    expect(feeInQuote(0.001, 'ETH', 'ETH/USDT', 2000)).toBeCloseTo(2, 8); // 0.001 ETH * 2000
  });
  it('feeAsset 为其它资产(如 BNB) → 暂不折算返回 0', () => {
    expect(feeInQuote(0.01, 'BNB', 'ETH/USDT', 2000)).toBe(0);
  });

  describe('quotePriceOf 注入', () => {
    it('提供 quotePriceOf 且能查到价格 → 按价格折算', () => {
      // 0.01 BNB × 600 USDT/BNB = 6 USDT
      expect(
        feeInQuote(0.01, 'BNB', 'ETH/USDT', 0, (a) => (a === 'BNB' ? 600 : undefined)),
      ).toBeCloseTo(6, 8);
    });
    it('提供 quotePriceOf 但查不到价格 → 维持 0', () => {
      expect(
        feeInQuote(0.01, 'BNB', 'ETH/USDT', 0, () => undefined),
      ).toBe(0);
    });
    it('不提供 quotePriceOf（原有调用） → 维持 0', () => {
      expect(feeInQuote(0.01, 'BNB', 'ETH/USDT', 0)).toBe(0);
    });
  });
  it('feeAsset 空 / fee 为 0 → 0', () => {
    expect(feeInQuote(0.4, undefined, 'ETH/USDT', 2000)).toBe(0);
    expect(feeInQuote(0, 'USDT', 'ETH/USDT', 2000)).toBe(0);
  });
});

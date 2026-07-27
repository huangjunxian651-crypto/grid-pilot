import { describe, it, expect } from 'vitest';
import { aggregateOrderTif } from './backfill-historical-tif';

describe('aggregateOrderTif', () => {
  it('单笔成交按其手续费费率判定(quote 计价手续费直接参与，不需折算)', () => {
    const fills = [{ fee: 0.21, feeAsset: 'USDT', qty: 0.5, price: 2000, notional: 1000 }];
    expect(aggregateOrderTif(fills, 'ETH/USDT')).toBe('POC');
  });

  it('多笔部分成交汇总手续费与成交额后再判定，而不是逐笔各自判定', () => {
    // 两笔都用 base 资产(ETH)支付手续费，需要 feeInQuote 折算成 USDT 再汇总
    const fills = [
      { fee: 0.0001, feeAsset: 'ETH', qty: 0.5, price: 2000, notional: 1000 }, // 0.0001*2000=0.2 USDT
      { fee: 0.0001, feeAsset: 'ETH', qty: 0.5, price: 2000, notional: 1000 }, // 再 0.2 USDT，合计 0.4/2000=0.0002 费率 → POC
    ];
    expect(aggregateOrderTif(fills, 'ETH/USDT')).toBe('POC');
  });

  it('手续费币种无法折算(既非 base 也非 quote 且无价格来源)时该笔按 0 计入，不拖累判定失真', () => {
    const fills = [{ fee: 5, feeAsset: 'BNB', qty: 0.5, price: 2000, notional: 1000 }];
    // BNB 换算不到（无 quotePriceOf 回调），feeInQuote 返回 0 → notional 仍是 1000 → rate=0 → 默认 POC
    expect(aggregateOrderTif(fills, 'ETH/USDT')).toBe('POC');
  });

  it('高费率(taker)判定为 GTC', () => {
    const fills = [{ fee: 0.48, feeAsset: 'USDT', qty: 0.5, price: 2000, notional: 1000 }];
    expect(aggregateOrderTif(fills, 'ETH/USDT')).toBe('GTC');
  });

  it('无成交(空 Fill 数组)时默认归为 POC', () => {
    expect(aggregateOrderTif([], 'ETH/USDT')).toBe('POC');
  });
});

import { describe, it, expect } from 'vitest';
import { mapOrderTradeUpdate, mapBinanceRestTrade } from './binance.adapter';

describe('mapOrderTradeUpdate', () => {
  it('映射 n/N 为 fee/feeAsset，l/L 为 filledQty/avgPrice，t 为 tradeId', () => {
    const o = { i: 123, c: 'cid', s: 'ETHUSDT', S: 'BUY', l: '0.5', L: '2000', t: 7, n: '0.4', N: 'USDT', X: 'PARTIALLY_FILLED' };
    const f = mapOrderTradeUpdate(o as any);
    expect(f).toMatchObject({ orderId: '123', clientOrderId: 'cid', tradeId: '7', side: 'buy', filledQty: 0.5, avgPrice: 2000, fee: 0.4, feeAsset: 'USDT', status: 'partial' });
  });

  it('FILLED 状态 → filled', () => {
    const o = { i: 1, c: 'c', s: 'ETHUSDT', S: 'SELL', l: '1', L: '2000', t: 9, n: '0.1', N: 'USDT', X: 'FILLED' };
    expect(mapOrderTradeUpdate(o as any)?.status).toBe('filled');
  });

  it('lastFilledQty 为 0 时返回 null（非成交推送）', () => {
    expect(mapOrderTradeUpdate({ l: '0' } as any)).toBeNull();
  });
});

describe('mapBinanceRestTrade', () => {
  it('mapBinanceRestTrade 映射 REST userTrade', () => {
    const t = { id: 5, orderId: 9, symbol: 'ETHUSDT', side: 'BUY', price: '2000', qty: '0.5', commission: '0.4', commissionAsset: 'USDT', time: 111 };
    expect(mapBinanceRestTrade(t as any)).toMatchObject({ orderId: '9', tradeId: '5', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.5, avgPrice: 2000, fee: 0.4, feeAsset: 'USDT', status: 'filled', ts: 111 });
  });
});

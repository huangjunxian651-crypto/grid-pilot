import { describe, it, expect } from 'vitest';
import { mapOkxFill } from './okx.adapter';

describe('mapOkxFill', () => {
  it('用 fillPx 而非 avgPx；tradeId/fillFee 取本笔；fee 归一为已付正值', () => {
    const raw = { ordId: 'o1', clOrdId: 'c1', instId: 'ETH-USDT-SWAP', side: 'buy', state: 'partially_filled', fillSz: '0.5', fillPx: '2000', avgPx: '1990', tradeId: 'T9', fillFee: '-0.4', fillFeeCcy: 'USDT', uTime: '111', fillTime: '110' };
    const f = mapOkxFill(raw as any, (n: number) => n);
    expect(f).toMatchObject({ orderId: 'o1', clientOrderId: 'c1', tradeId: 'T9', side: 'buy', filledQty: 0.5, avgPrice: 2000, fee: 0.4, feeAsset: 'USDT', status: 'partial' });
  });

  it('state=filled → filled', () => {
    const raw = { ordId: 'o', instId: 'ETH-USDT-SWAP', side: 'sell', state: 'filled', fillSz: '1', fillPx: '2000', tradeId: 'T', fillFee: '-0.1', fillFeeCcy: 'USDT' };
    expect(mapOkxFill(raw as any, (n: number) => n)?.status).toBe('filled');
  });

  it('fillSz 为 0 时返回 null', () => {
    expect(mapOkxFill({ fillSz: '0' } as any, (n: number) => n)).toBeNull();
  });

  it('algo 触发单的成交：clientOrderId 取 algoClOrdId（clOrdId 是 OKX 自动生成的 O… id）', () => {
    // 模拟盘实测：触发单生成的订单 clOrdId="O…"（不传播我们的 id），
    // 但订单事件带独立字段 algoClOrdId。不优先取它，紧急止损的成交永远无法归属。
    const raw = { ordId: 'o2', clOrdId: 'O3646388535645528064', algoClOrdId: 'ETHUSDT260611071735AE3k', instId: 'ETH-USDT-SWAP', side: 'sell', state: 'filled', fillSz: '1', fillPx: '2000', tradeId: 'T1' };
    expect(mapOkxFill(raw as any, (n: number) => n)?.clientOrderId).toBe('ETHUSDT260611071735AE3k');
  });

  it('普通单成交：无 algoClOrdId 时 clientOrderId 仍取 clOrdId', () => {
    const raw = { ordId: 'o3', clOrdId: 'c3', instId: 'ETH-USDT-SWAP', side: 'buy', state: 'filled', fillSz: '1', fillPx: '2000', tradeId: 'T2' };
    expect(mapOkxFill(raw as any, (n: number) => n)?.clientOrderId).toBe('c3');
  });

  // REST 路径（/api/v5/trade/fills）返回 fee/feeCcy，WS 路径返回 fillFee/fillFeeCcy
  it('REST 成交（fee/feeCcy）：手续费应归一为已付正值，不丢失', () => {
    // OKX REST /api/v5/trade/fills 与 /fills-history 用 fee/feeCcy 而非 fillFee/fillFeeCcy
    // fee 同样已付为负值约定，取负归一为已付正值
    const raw = { ordId: 'o4', clOrdId: 'c4', instId: 'ETH-USDT-SWAP', side: 'buy', state: 'filled', fillSz: '1', fillPx: '2100', tradeId: 'T3', fee: '-0.21', feeCcy: 'USDT' };
    const f = mapOkxFill(raw as any, (n: number) => n);
    expect(f).toMatchObject({ orderId: 'o4', fee: 0.21, feeAsset: 'USDT' });
  });

  it('REST 成交有 fee/feeCcy、同时无 fillFee/fillFeeCcy 时不丢失手续费', () => {
    // 确认没有 fillFee 字段时仍能正确读取 fee
    const raw = { ordId: 'o5', clOrdId: 'c5', instId: 'ETH-USDT-SWAP', side: 'sell', state: 'filled', fillSz: '2', fillPx: '1900', tradeId: 'T4', fee: '-0.38', feeCcy: 'USDT' };
    const f = mapOkxFill(raw as any, (n: number) => n);
    expect(f?.fee).toBeCloseTo(0.38);
    expect(f?.feeAsset).toBe('USDT');
  });
});

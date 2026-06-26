import { describe, it, expect } from 'vitest';
import { resolveUnrealizedPnl, normalizeSymbol } from './resolve-unrealized-pnl';

const snap = (unrealizedPnl: number, symbol = 'ETH/USDT') => ({
  credentialId: 'c1', totalEquity: 0, totalWalletBalance: 0, availableUsdt: 0, marginUsed: 0, updatedAt: 0,
  positions: [{ symbol, side: 'LONG' as const, qty: 1, entryPrice: 0, markPrice: 0, unrealizedPnl, leverage: 1 }],
});

describe('resolveUnrealizedPnl', () => {
  it('运行中：取实时快照该 symbol 未实现', () => {
    expect(resolveUnrealizedPnl(snap(5) as any, 'ETH/USDT', null)).toBe(5);
  });
  it('symbol 格式差异(ETHUSDT vs ETH/USDT)仍匹配', () => {
    expect(resolveUnrealizedPnl(snap(5, 'ETHUSDT') as any, 'ETH/USDT', null)).toBe(5);
  });
  it('账户在轮询但无该 symbol 持仓 → flat 0', () => {
    expect(resolveUnrealizedPnl(snap(5, 'BTC/USDT') as any, 'ETH/USDT', null)).toBe(0);
  });
  it('无实时快照(已停止)→ 回退停止持久值', () => {
    expect(resolveUnrealizedPnl(undefined, 'ETH/USDT', 3.5)).toBe(3.5);
    expect(resolveUnrealizedPnl(undefined, 'ETH/USDT', null)).toBe(null);
  });
});

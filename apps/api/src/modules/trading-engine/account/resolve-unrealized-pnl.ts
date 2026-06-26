import type { AccountSnapshot } from './account-snapshot.service';

/** 去分隔符大写，兼容 'ETHUSDT' vs 'ETH/USDT'。 */
export function normalizeSymbol(s: string): string {
  return s.replace(/[/:\-]/g, '').toUpperCase();
}

/** 未实现盈亏单一来源：账户在轮询(有内存快照)→该 symbol 持仓 unrealizedPnl(无持仓=flat=0)；否则回退停止持久值。 */
export function resolveUnrealizedPnl(
  liveSnapshot: AccountSnapshot | undefined,
  symbol: string,
  persistedFallback: number | null,
): number | null {
  if (!liveSnapshot) return persistedFallback ?? null;
  const pos = liveSnapshot.positions.find((p) => normalizeSymbol(p.symbol) === normalizeSymbol(symbol));
  return pos?.unrealizedPnl ?? 0;
}

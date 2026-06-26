// 权益/Alpha 双序列按时间对齐合并，供 recharts 单数据源渲染（P2-1）。

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface AlphaPoint {
  t: number;
  alpha: number;
}

export interface MergedPoint {
  t: number;
  equity: number | undefined;
  alpha: number | undefined;
}

export function mergeHistorySeries(equity: EquityPoint[], alpha: AlphaPoint[]): MergedPoint[] {
  if (equity.length === 0 && alpha.length === 0) return [];
  const byT = new Map<number, MergedPoint>();
  for (const p of equity) {
    byT.set(p.t, { t: p.t, equity: p.equity, alpha: undefined });
  }
  for (const p of alpha) {
    const existing = byT.get(p.t);
    if (existing) {
      existing.alpha = p.alpha;
    } else {
      byT.set(p.t, { t: p.t, equity: undefined, alpha: p.alpha });
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

import type { MetricsFill, MetricsFunding, MetricsSeriesPoint, MetricsWindow, RobotMetrics } from './strategy-metrics.types';

export const WINDOW_MS: Record<MetricsWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};

const WINDOW_DAYS: Record<MetricsWindow, number> = { '24h': 1, '7d': 7, '30d': 30 };

export function totalFees(fills: MetricsFill[]): number {
  return fills.reduce((s, f) => s + f.feeUsdt, 0);
}

export function turnover(fills: MetricsFill[]): number {
  return fills.reduce((s, f) => s + f.notional, 0);
}

/** 毛网格利得：只计盈利笔的 realizedPnlDelta（只有 SELL 产生 delta，BUY 为 0）。 */
export function grossProfit(fills: MetricsFill[]): number {
  return fills.reduce((s, f) => s + (f.realizedPnlDelta > 0 ? f.realizedPnlDelta : 0), 0);
}

export function fundingTotal(fundings: MetricsFunding[]): number {
  return fundings.reduce((s, f) => s + f.amount, 0);
}

/** 净实现盈亏 = ΣrealizedPnlDelta − Σfee − Σfunding。 */
export function netPnl(fills: MetricsFill[], fundings: MetricsFunding[]): number {
  return fills.reduce((s, f) => s + f.realizedPnlDelta, 0) - totalFees(fills) - fundingTotal(fundings);
}

/** 费用率（bp，万分之一）；无成交返回 0。 */
export function feeRateBp(fills: MetricsFill[]): number {
  const t = turnover(fills);
  return t > 0 ? (totalFees(fills) / t) * 1e4 : 0;
}

/** 费用占毛利比；毛利为 0 时返回 null（除零无意义，页面显示 "—"）。 */
export function feeToGross(fills: MetricsFill[]): number | null {
  const g = grossProfit(fills);
  return g > 0 ? totalFees(fills) / g : null;
}

/** Alpha = Σsavings（POC 挂网格线内侧的超额价差，沿用现有 savings 口径）。 */
export function alphaTotal(fills: MetricsFill[]): number {
  return fills.reduce((s, f) => s + f.savings, 0);
}

export function alphaRateBp(fills: MetricsFill[]): number {
  const t = turnover(fills);
  return t > 0 ? (alphaTotal(fills) / t) * 1e4 : 0;
}

/** 胜笔率 = 盈利 SELL 笔数 / 总 SELL 笔数；无 SELL 返回 0。 */
export function winRate(fills: MetricsFill[]): number {
  const sells = fills.filter((f) => f.side === 'SELL');
  if (sells.length === 0) return 0;
  return sells.filter((f) => f.realizedPnlDelta > 0).length / sells.length;
}

export function avgPnlPerFill(fills: MetricsFill[], fundings: MetricsFunding[]): number | null {
  return fills.length > 0 ? netPnl(fills, fundings) / fills.length : null;
}

/** 网格覆盖率 = 成交过的不同 gridIndex 数 / mainGridCount；配置缺失或无成交返回 null（页面显示 "—"）。 */
export function gridCoverage(fills: MetricsFill[], mainGridCount: number | null): number | null {
  if (!mainGridCount || mainGridCount <= 0 || fills.length === 0) return null;
  const distinct = new Set(fills.map((f) => f.gridIndex).filter((g): g is number => g != null));
  return distinct.size / mainGridCount;
}

/** 净加仓 = Σbuy qty − Σsell qty（单边堆积预警）。 */
export function netPositionChange(fills: MetricsFill[]): number {
  return fills.reduce((s, f) => s + (f.side === 'BUY' ? f.qty : -f.qty), 0);
}

export function fillsPerDay(fillCount: number, window: MetricsWindow): number {
  return fillCount / WINDOW_DAYS[window];
}

/** 回撤/序列共用的事件流：fill → delta = realizedPnlDelta − feeUsdt；funding → −amount 阶跃。 */
interface PnlEvent {
  t: number;
  netDelta: number;
  alphaDelta: number;
}

function toEventStream(fills: MetricsFill[], fundings: MetricsFunding[]): PnlEvent[] {
  const events: PnlEvent[] = [
    ...fills.map((f) => ({ t: f.filledAt.getTime(), netDelta: f.realizedPnlDelta - f.feeUsdt, alphaDelta: f.savings })),
    ...fundings.map((f) => ({ t: f.fundingTime.getTime(), netDelta: -f.amount, alphaDelta: 0 })),
  ];
  return events.sort((a, b) => a.t - b.t);
}

/** 策略最大回撤：台账累计净盈亏曲线的 max(历史峰值 − 当前谷值)。 */
export function maxDrawdown(fills: MetricsFill[], fundings: MetricsFunding[]): number {
  let equity = 0;
  let peak = 0;
  let mdd = 0;
  for (const e of toEventStream(fills, fundings)) {
    equity += e.netDelta;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

export const SERIES_BUCKET_MS: Record<MetricsWindow, number> = {
  '24h': 30 * 60_000,   // 48 点
  '7d': 2 * 3600_000,   // 84 点
  '30d': 6 * 3600_000,  // 120 点
};

/** 累计净盈亏 + 累计 alpha 的桶对齐序列（明细页曲线用）。 */
export function buildCumulativeSeries(
  fills: MetricsFill[],
  fundings: MetricsFunding[],
  window: MetricsWindow,
  now: number,
): MetricsSeriesPoint[] {
  const windowMs = WINDOW_MS[window];
  const bucketMs = SERIES_BUCKET_MS[window];
  const start = now - windowMs;
  const bucketCount = Math.ceil(windowMs / bucketMs);
  // 窗口开始前的事件直接丢弃，避免被折叠进第 1 个桶；起点边界（t === start）保留，与 DB 查询 gte 对齐
  const events = toEventStream(fills, fundings).filter((e) => e.t >= start);
  const points: MetricsSeriesPoint[] = [];
  let cumNet = 0;
  let cumAlpha = 0;
  let ei = 0;
  for (let b = 1; b <= bucketCount; b++) {
    const end = start + b * bucketMs;
    while (ei < events.length && events[ei].t <= end) {
      cumNet += events[ei].netDelta;
      cumAlpha += events[ei].alphaDelta;
      ei++;
    }
    points.push({ t: new Date(Math.min(end, now)).toISOString(), cumNetPnl: cumNet, cumAlpha: cumAlpha });
  }
  return points;
}

/** 单机器人指标组装。unrealizedPnl/netExposure 是当前值、非 fills 派生，由 service 注入。 */
export function computeRobotMetrics(
  fills: MetricsFill[],
  fundings: MetricsFunding[],
  mainGridCount: number | null,
  window: MetricsWindow,
): RobotMetrics {
  return {
    netPnl: netPnl(fills, fundings),
    grossProfit: grossProfit(fills),
    totalFees: totalFees(fills),
    feeRateBp: feeRateBp(fills),
    feeToGross: feeToGross(fills),
    funding: fundingTotal(fundings),
    alpha: alphaTotal(fills),
    alphaRateBp: alphaRateBp(fills),
    winRate: winRate(fills),
    avgPnlPerFill: avgPnlPerFill(fills, fundings),
    gridCoverage: gridCoverage(fills, mainGridCount),
    fillCount: fills.length,
    fillsPerDay: fillsPerDay(fills.length, window),
    turnover: turnover(fills),
    netPositionChange: netPositionChange(fills),
    maxDrawdown: maxDrawdown(fills, fundings),
    unrealizedPnl: null,
    netExposure: null,
  };
}

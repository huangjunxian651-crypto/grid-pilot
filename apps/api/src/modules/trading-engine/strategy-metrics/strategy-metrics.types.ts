/** 策略评价指标类型。口径见 docs/superpowers/specs/2026-07-31-strategy-evaluation-metrics-design.md 第 2 节。 */

export type MetricsWindow = '24h' | '7d' | '30d';

export function isMetricsWindow(raw: string): raw is MetricsWindow {
  return raw === '24h' || raw === '7d' || raw === '30d';
}

/** 纯函数输入：窗口内单笔成交（fee 须已折算 USDT）。 */
export interface MetricsFill {
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  feeUsdt: number;
  notional: number;
  savings: number;
  realizedPnlDelta: number;
  gridIndex: number | null;
  filledAt: Date;
}

/** 纯函数输入：资金费事件（amount 正=支出）。 */
export interface MetricsFunding {
  fundingTime: Date;
  amount: number;
}

export interface RobotMetrics {
  netPnl: number;
  grossProfit: number;
  totalFees: number;
  feeRateBp: number;
  feeToGross: number | null;
  funding: number;
  alpha: number;
  alphaRateBp: number;
  winRate: number;
  avgPnlPerFill: number | null;
  gridCoverage: number | null;
  fillCount: number;
  fillsPerDay: number;
  turnover: number;
  netPositionChange: number;
  maxDrawdown: number | null;
  unrealizedPnl: number | null;
  netExposure: number | null;
}

export interface RobotMetricsEntry {
  robotId: string;
  exchange: string;
  symbol: string;
  runCode: string;
  startedAt: string;
  metrics: RobotMetrics;
  dataQuality: { fills: number; windowCovered: boolean };
}

export interface StrategyMetricsResponse {
  window: MetricsWindow;
  generatedAt: string;
  aggregate: RobotMetrics;
  robots: RobotMetricsEntry[];
}

export interface MetricsSeriesPoint {
  t: string;
  cumNetPnl: number;
  cumAlpha: number;
}

export interface StrategySeriesResponse {
  robotId: string;
  window: MetricsWindow;
  bucketMs: number;
  points: MetricsSeriesPoint[];
}

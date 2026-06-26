// 权益/Alpha 历史曲线的纯聚合逻辑（设计见 docs/superpowers/specs/2026-06-12-equity-curve-design.md）。
// 与 IO 解耦：controller 取数后调用，便于黑盒单测。

export type HistoryRange = '7d' | '30d' | '90d' | 'all';

const MINUTE = 60_000;
const DAY = 24 * 3600_000;

const HOUR = 3600_000;
/** 单次响应的点数上限（评审 I-1）：all 档按实际跨度放大桶宽以守住该上限。 */
const MAX_SERIES_POINTS = 2000;

export function resolveHistoryRange(
  range: HistoryRange,
  nowMs: number,
  oldestMs?: number,
): { sinceMs: number; bucketMs: number } {
  switch (range) {
    case '30d':
      return { sinceMs: nowMs - 30 * DAY, bucketMs: 30 * MINUTE };
    case '90d':
      return { sinceMs: nowMs - 90 * DAY, bucketMs: 120 * MINUTE };
    case 'all': {
      // 自适应桶宽：跨度大时放大到 ceil(span/2000) 并对齐整小时，守住点数上限
      let bucketMs = 120 * MINUTE;
      if (oldestMs !== undefined && oldestMs < nowMs) {
        const span = nowMs - oldestMs;
        const adaptive = Math.ceil(span / MAX_SERIES_POINTS / HOUR) * HOUR;
        bucketMs = Math.max(bucketMs, adaptive);
      }
      return { sinceMs: 0, bucketMs };
    }
    case '7d':
    default:
      return { sinceMs: nowMs - 7 * DAY, bucketMs: 5 * MINUTE };
  }
}

export interface EquityRowLite {
  credentialId: string;
  totalEquity: number;
  capturedAt: Date;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

/**
 * 按桶聚合权益时序：桶内每个 credential 取最后一条，缺桶沿用该 credential 前值
 * （carry-forward），再跨 credential 求和——避免某账户缺点导致总权益假凹陷。
 * 后加入的 credential 在其首点之前不计入（阶跃是真实的"开始跟踪"）。
 */
export function bucketEquitySeries(rows: EquityRowLite[], bucketMs: number): EquityPoint[] {
  if (rows.length === 0 || bucketMs <= 0) return []; // bucketMs<=0 会步进死循环（评审 M-3）

  // credential → (bucketT → 桶内末值)。rows 按 capturedAt 升序处理，后写覆盖即"末值"。
  const sorted = [...rows].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const perCredential = new Map<string, Map<number, number>>();
  let minBucket = Infinity;
  let maxBucket = -Infinity;
  for (const r of sorted) {
    const t = Math.floor(r.capturedAt.getTime() / bucketMs) * bucketMs;
    minBucket = Math.min(minBucket, t);
    maxBucket = Math.max(maxBucket, t);
    let buckets = perCredential.get(r.credentialId);
    if (!buckets) {
      buckets = new Map();
      perCredential.set(r.credentialId, buckets);
    }
    buckets.set(t, r.totalEquity);
  }

  const series: EquityPoint[] = [];
  const lastValue = new Map<string, number>(); // credential → carry-forward 值
  for (let t = minBucket; t <= maxBucket; t += bucketMs) {
    let sum = 0;
    let any = false;
    for (const [cred, buckets] of perCredential) {
      const v = buckets.get(t);
      if (v !== undefined) lastValue.set(cred, v);
      const carried = lastValue.get(cred);
      if (carried !== undefined) {
        sum += carried;
        any = true;
      }
    }
    if (any) series.push({ t, equity: sum });
  }
  return series;
}

export interface SavingsFillLite {
  savings: number;
  filledAt: Date;
}

export interface AlphaPoint {
  t: number;
  alpha: number;
}

/** 窗口内 Fill.savings 的逐桶累计曲线（窗口起点记 0 起算），缺桶沿用累计值。 */
export function buildCumulativeSavingsSeries(fills: SavingsFillLite[], bucketMs: number): AlphaPoint[] {
  if (fills.length === 0 || bucketMs <= 0) return []; // bucketMs<=0 会步进死循环（评审 M-3）

  const perBucket = new Map<number, number>();
  let minBucket = Infinity;
  let maxBucket = -Infinity;
  for (const f of fills) {
    const t = Math.floor(f.filledAt.getTime() / bucketMs) * bucketMs;
    minBucket = Math.min(minBucket, t);
    maxBucket = Math.max(maxBucket, t);
    perBucket.set(t, (perBucket.get(t) ?? 0) + f.savings);
  }

  const series: AlphaPoint[] = [];
  let cum = 0;
  for (let t = minBucket; t <= maxBucket; t += bucketMs) {
    cum += perBucket.get(t) ?? 0;
    // 消除浮点累加噪声，曲线值保持可读
    series.push({ t, alpha: Math.round(cum * 1e8) / 1e8 });
  }
  return series;
}

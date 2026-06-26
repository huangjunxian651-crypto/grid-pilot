import { describe, it, expect } from 'vitest';
import { resolveHistoryRange, bucketEquitySeries, buildCumulativeSavingsSeries } from './equity-history';

const M = 60_000;

describe('resolveHistoryRange', () => {
  it('7d → 7天窗口 + 5min 桶', () => {
    const now = 1_700_000_000_000;
    const r = resolveHistoryRange('7d', now);
    expect(r.sinceMs).toBe(now - 7 * 24 * 3600_000);
    expect(r.bucketMs).toBe(5 * M);
  });
  it('30d → 30min 桶；90d 与 all → 2h 桶（all 窗口为 0=不限）', () => {
    const now = 1_700_000_000_000;
    expect(resolveHistoryRange('30d', now).bucketMs).toBe(30 * M);
    expect(resolveHistoryRange('90d', now).bucketMs).toBe(120 * M);
    const all = resolveHistoryRange('all', now);
    expect(all.bucketMs).toBe(120 * M);
    expect(all.sinceMs).toBe(0);
  });
  it('非法档位回退 7d', () => {
    const now = 1_700_000_000_000;
    expect(resolveHistoryRange('bogus' as never, now)).toEqual(resolveHistoryRange('7d', now));
  });
});

describe('bucketEquitySeries（桶内取末值、缺桶沿用前值、跨 credential 求和）', () => {
  const row = (cred: string, equity: number, tMin: number) => ({
    credentialId: cred,
    totalEquity: equity,
    capturedAt: new Date(tMin * M),
  });

  it('空输入 → 空序列', () => {
    expect(bucketEquitySeries([], 5 * M)).toEqual([]);
  });

  it('单 credential：桶内多条取最后一条，输出桶起点时间戳', () => {
    const rows = [row('a', 100, 0), row('a', 105, 3), row('a', 110, 7)];
    const s = bucketEquitySeries(rows, 5 * M);
    // 桶0(0-5min)末值105；桶1(5-10min)末值110
    expect(s).toEqual([
      { t: 0, equity: 105 },
      { t: 5 * M, equity: 110 },
    ]);
  });

  it('缺桶沿用前值（carry-forward），不产生假凹陷', () => {
    const rows = [row('a', 100, 0), row('a', 120, 16)];
    const s = bucketEquitySeries(rows, 5 * M);
    expect(s).toEqual([
      { t: 0, equity: 100 },
      { t: 5 * M, equity: 100 },
      { t: 10 * M, equity: 100 },
      { t: 15 * M, equity: 120 },
    ]);
  });

  it('多 credential：逐桶求和；后加入的 credential 在其首点前不计入', () => {
    const rows = [
      row('a', 100, 0),
      row('a', 100, 11),
      row('b', 50, 6), // b 从桶1 开始
    ];
    const s = bucketEquitySeries(rows, 5 * M);
    expect(s).toEqual([
      { t: 0, equity: 100 }, // 仅 a
      { t: 5 * M, equity: 150 }, // a(carry 100)+b(50)
      { t: 10 * M, equity: 150 },
    ]);
  });
});

describe('buildCumulativeSavingsSeries（窗口起点记0，逐桶累计）', () => {
  const fill = (savings: number, tMin: number) => ({ savings, filledAt: new Date(tMin * M) });

  it('空输入 → 空序列', () => {
    expect(buildCumulativeSavingsSeries([], 5 * M)).toEqual([]);
  });

  it('同桶聚合、跨桶累计、缺桶沿用累计值', () => {
    const fills = [fill(1, 0), fill(2, 2), fill(0.5, 12)];
    const s = buildCumulativeSavingsSeries(fills, 5 * M);
    expect(s).toEqual([
      { t: 0, alpha: 3 },
      { t: 5 * M, alpha: 3 },
      { t: 10 * M, alpha: 3.5 },
    ]);
  });
});

describe('resolveHistoryRange all 档自适应桶宽（评审 I-1：响应点数 ≤ ~2000）', () => {
  const now = 1_700_000_000_000;
  it('无 oldestMs 或跨度小 → 维持 2h 桶', () => {
    expect(resolveHistoryRange('all', now).bucketMs).toBe(120 * 60_000);
    expect(resolveHistoryRange('all', now, now - 30 * 24 * 3600_000).bucketMs).toBe(120 * 60_000);
  });
  it('跨度大 → 桶宽放大到 ceil(span/2000) 并对齐整小时，点数 ≤2000', () => {
    const span = 3 * 365 * 24 * 3600_000; // 3 年
    const r = resolveHistoryRange('all', now, now - span);
    expect(r.bucketMs % 3600_000).toBe(0);
    expect(span / r.bucketMs).toBeLessThanOrEqual(2000);
    expect(r.bucketMs).toBeGreaterThan(120 * 60_000);
  });
});

describe('bucketMs<=0 防御（评审 M-3）', () => {
  it('非法桶宽返回空而非死循环', () => {
    expect(bucketEquitySeries([{ credentialId: 'a', totalEquity: 1, capturedAt: new Date(0) }], 0)).toEqual([]);
    expect(buildCumulativeSavingsSeries([{ savings: 1, filledAt: new Date(0) }], -5)).toEqual([]);
  });
});

describe('负 savings 累计（评审 M-7）', () => {
  it('亏损 Alpha 正确累计为负', () => {
    const s = buildCumulativeSavingsSeries(
      [{ savings: 2, filledAt: new Date(0) }, { savings: -5, filledAt: new Date(6 * 60_000) }],
      5 * 60_000,
    );
    expect(s.at(-1)).toEqual({ t: 5 * 60_000, alpha: -3 });
  });
});

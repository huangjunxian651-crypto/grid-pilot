import { describe, it, expect } from 'vitest';
import type { MetricsFill, MetricsFunding } from './strategy-metrics.types';
import {
  netPnl, grossProfit, totalFees, turnover, feeRateBp, feeToGross,
  fundingTotal, alphaTotal, alphaRateBp, winRate, avgPnlPerFill,
  gridCoverage, netPositionChange, fillsPerDay,
  maxDrawdown, buildCumulativeSeries, computeRobotMetrics,
} from './compute-metrics';

const T = (m: number) => new Date(2026, 6, 31, 12, m);

/** 黄金数据集：3 笔 fills + 1 笔 funding，手算期望值以注释附在关键断言处。 */
const FILLS: MetricsFill[] = [
  { side: 'BUY', qty: 0.05, price: 1900, feeUsdt: 0.05, notional: 95, savings: 0.02, realizedPnlDelta: 0, gridIndex: 50, filledAt: T(0) },
  { side: 'SELL', qty: 0.05, price: 1905, feeUsdt: 0.05, notional: 95.25, savings: 0.03, realizedPnlDelta: -0.5, gridIndex: 49, filledAt: T(1) },
  { side: 'SELL', qty: 0.05, price: 1910, feeUsdt: 0.05, notional: 95.5, savings: 0.01, realizedPnlDelta: 0.8, gridIndex: 48, filledAt: T(2) },
];
const FUNDINGS: MetricsFunding[] = [{ fundingTime: T(3), amount: 0.2 }];

describe('盈亏结构组', () => {
  it('netPnl = ΣrealizedPnlDelta − Σfee − Σfunding', () => {
    // (0 − 0.5 + 0.8) − 0.15 − 0.2 = −0.05
    expect(netPnl(FILLS, FUNDINGS)).toBeCloseTo(-0.05, 10);
  });
  it('grossProfit 只计盈利笔', () => {
    // 仅 FILLS[2] 盈利 0.8，FILLS[1] 亏损 −0.5 不计
    expect(grossProfit(FILLS)).toBeCloseTo(0.8, 10);
  });
  it('totalFees / turnover / fundingTotal 为直和', () => {
    // fee 0.05×3 = 0.15；notional 95 + 95.25 + 95.5 = 285.75
    expect(totalFees(FILLS)).toBeCloseTo(0.15, 10);
    expect(turnover(FILLS)).toBeCloseTo(285.75, 10);
    expect(fundingTotal(FUNDINGS)).toBeCloseTo(0.2, 10);
  });
  it('feeRateBp = Σfee/Σnotional×1e4', () => {
    // 0.15 / 285.75 × 1e4 ≈ 5.2493
    expect(feeRateBp(FILLS)).toBeCloseTo(5.2493, 3);
  });
  it('feeToGross = Σfee/grossProfit', () => {
    // 0.15 / 0.8 = 0.1875
    expect(feeToGross(FILLS)).toBeCloseTo(0.1875, 10);
  });
  it('grossProfit=0 时 feeToGross 返回 null（页面显示 "—"）', () => {
    const losing: MetricsFill[] = [{ ...FILLS[1] }];
    expect(feeToGross(losing)).toBeNull();
  });
  it('turnover=0 时 feeRateBp 返回 0 而非 NaN', () => {
    expect(feeRateBp([])).toBe(0);
  });
  it('空数据集：数值类指标返回 0，比率类返回 null', () => {
    expect(netPnl([], [])).toBe(0);
    expect(grossProfit([])).toBe(0);
    expect(totalFees([])).toBe(0);
    expect(turnover([])).toBe(0);
    expect(alphaTotal([])).toBe(0);
    expect(winRate([])).toBe(0);
    expect(netPositionChange([])).toBe(0);
    expect(maxDrawdown([], [])).toBe(0);
    expect(avgPnlPerFill([], [])).toBeNull();
    expect(feeToGross([])).toBeNull();
    expect(gridCoverage([], 78)).toBeNull();
  });
});

describe('网格套利效率组', () => {
  it('alpha = Σsavings；alphaRateBp = Σsavings/Σnotional×1e4', () => {
    // savings 0.02 + 0.03 + 0.01 = 0.06；0.06 / 285.75 × 1e4 ≈ 2.0997
    expect(alphaTotal(FILLS)).toBeCloseTo(0.06, 10);
    expect(alphaRateBp(FILLS)).toBeCloseTo(2.0997, 3);
  });
  it('winRate = 盈利 SELL 笔数 / 总 SELL 笔数', () => {
    expect(winRate(FILLS)).toBeCloseTo(0.5, 10);
  });
  it('窗口内只有 BUY（无 SELL）时 winRate=0 而非 NaN', () => {
    expect(winRate([FILLS[0]])).toBe(0);
  });
  it('avgPnlPerFill = netPnl / 成交笔数；无成交返回 null', () => {
    expect(avgPnlPerFill(FILLS, FUNDINGS)).toBeCloseTo(-0.05 / 3, 10);
    expect(avgPnlPerFill([], [])).toBeNull();
  });
  it('gridCoverage = 成交过的不同 gridIndex 数 / mainGridCount', () => {
    expect(gridCoverage(FILLS, 78)).toBeCloseTo(3 / 78, 10);
  });
  it('mainGridCount 缺失时 gridCoverage 返回 null；gridIndex 为 null 的成交不计入', () => {
    expect(gridCoverage(FILLS, null)).toBeNull();
    const withNull: MetricsFill[] = [...FILLS, { ...FILLS[0], gridIndex: null }];
    expect(gridCoverage(withNull, 78)).toBeCloseTo(3 / 78, 10);
  });
  it('有成交但 gridIndex 全为 null 时 gridCoverage=0（区别于无成交的 null）', () => {
    expect(gridCoverage([{ ...FILLS[0], gridIndex: null }], 78)).toBe(0);
  });
});

describe('活跃度组', () => {
  it('netPositionChange = Σbuy qty − Σsell qty', () => {
    expect(netPositionChange(FILLS)).toBeCloseTo(0.05 - 0.1, 10);
  });
  it('fillsPerDay = fillCount / 窗口天数', () => {
    expect(fillsPerDay(3, '24h')).toBe(3);
    expect(fillsPerDay(21, '7d')).toBe(3);
    expect(fillsPerDay(90, '30d')).toBe(3);
  });
});

describe('风险组：maxDrawdown（台账累计净盈亏曲线）', () => {
  it('fills 的 delta=realizedPnlDelta−fee，funding 按时间插入为 −amount 阶跃', () => {
    // 曲线: t0 −0.05 → t1 −0.6 → t2 +0.15(新峰) → t3 −0.05；峰值 0.15，最大回撤 = 0 − (−0.6) = 0.6
    expect(maxDrawdown(FILLS, FUNDINGS)).toBeCloseTo(0.6, 10);
  });
  it('无成交时回撤为 0', () => {
    expect(maxDrawdown([], [])).toBe(0);
  });
  it('单调盈利曲线回撤为 0', () => {
    const wins: MetricsFill[] = [
      { ...FILLS[2], filledAt: T(10) },
      { ...FILLS[2], filledAt: T(11) },
    ];
    expect(maxDrawdown(wins, [])).toBe(0);
  });
});

describe('buildCumulativeSeries（明细页曲线）', () => {
  it('按桶输出累计净盈亏与累计 alpha，时间点对齐桶右缘', () => {
    const now = new Date(2026, 6, 31, 13, 0).getTime();
    const fills: MetricsFill[] = [
      { ...FILLS[0], filledAt: new Date(now - 60 * 60_000) },  // 1h 前
      { ...FILLS[2], filledAt: new Date(now - 10 * 60_000) },  // 10min 前
    ];
    const points = buildCumulativeSeries(fills, [], '24h', now);
    expect(points).toHaveLength(48); // 24h / 30min
    const last = points[points.length - 1];
    // 累计净盈亏 = (0 − 0.05) + (0.8 − 0.05) = 0.7
    expect(last.cumNetPnl).toBeCloseTo(0.7, 10);
    expect(last.cumAlpha).toBeCloseTo(0.02 + 0.01, 10);
    expect(points[0].cumNetPnl).toBe(0);
  });
  it('窗口开始前的事件不折叠进任何桶（累计值保持 0）', () => {
    const now = new Date(2026, 6, 31, 13, 0).getTime();
    const start = now - 24 * 3600_000;
    const fills: MetricsFill[] = [
      { ...FILLS[2], filledAt: new Date(start - 60_000) }, // 窗口开始前 1 分钟
    ];
    const points = buildCumulativeSeries(fills, [], '24h', now);
    expect(points).toHaveLength(48);
    expect(points.every((p) => p.cumNetPnl === 0 && p.cumAlpha === 0)).toBe(true);
  });
  it('7d/30d 窗口桶数分别为 84/120', () => {
    const now = Date.now();
    expect(buildCumulativeSeries([], [], '7d', now)).toHaveLength(84);
    expect(buildCumulativeSeries([], [], '30d', now)).toHaveLength(120);
  });
  it('窗口起点边界（t === start）的事件计入第 1 个桶（与 DB 查询 gte 对齐）', () => {
    const now = new Date(2026, 6, 31, 13, 0).getTime();
    const start = now - 24 * 3600_000;
    const fills: MetricsFill[] = [
      { ...FILLS[2], filledAt: new Date(start) }, // 恰好落在窗口起点
    ];
    const points = buildCumulativeSeries(fills, [], '24h', now);
    // FILLS[2] delta = 0.8 − 0.05 = 0.75，从第 1 个桶起计入
    expect(points[0].cumNetPnl).toBeCloseTo(0.75, 10);
    expect(points[points.length - 1].cumNetPnl).toBeCloseTo(0.75, 10);
  });
});

describe('computeRobotMetrics 组装', () => {
  it('汇总 17 个指标；unrealizedPnl/netExposure 由 service 注入，此处为 null', () => {
    const m = computeRobotMetrics(FILLS, FUNDINGS, 78, '24h');
    expect(m.netPnl).toBeCloseTo(-0.05, 10);
    expect(m.grossProfit).toBeCloseTo(0.8, 10);
    expect(m.totalFees).toBeCloseTo(0.15, 10);
    expect(m.feeRateBp).toBeCloseTo(5.2493, 3);
    expect(m.feeToGross).toBeCloseTo(0.1875, 10);
    expect(m.funding).toBeCloseTo(0.2, 10);
    expect(m.alpha).toBeCloseTo(0.06, 10);
    expect(m.alphaRateBp).toBeCloseTo(2.0997, 3);
    expect(m.winRate).toBeCloseTo(0.5, 10);
    expect(m.avgPnlPerFill).toBeCloseTo(-0.05 / 3, 10);
    expect(m.gridCoverage).toBeCloseTo(3 / 78, 10);
    expect(m.fillCount).toBe(3);
    expect(m.fillsPerDay).toBe(3);
    expect(m.turnover).toBeCloseTo(285.75, 10);
    expect(m.netPositionChange).toBeCloseTo(-0.05, 10);
    expect(m.maxDrawdown).toBeCloseTo(0.6, 10);
    expect(m.unrealizedPnl).toBeNull();
    expect(m.netExposure).toBeNull();
  });
});

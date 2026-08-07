import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { StrategyMetricsService } from './strategy-metrics.service';

const T = (m: number) => new Date(Date.now() - m * 60_000); // m 分钟前

function makeFill(over: Partial<Record<string, unknown>> = {}) {
  return {
    side: 'SELL', qty: 0.05, price: 1905, fee: 0.05, feeAsset: 'USDT',
    notional: 95.25, savings: 0.03, realizedPnlDelta: 0.8, gridIndex: 49,
    filledAt: T(10), ...over,
  };
}

function makeSvc() {
  const prisma = {
    robot: { findMany: vi.fn(), findUnique: vi.fn() },
    run: { findFirst: vi.fn() },
    fill: { findMany: vi.fn() },
    fundingEvent: { findMany: vi.fn() },
  };
  return { svc: new StrategyMetricsService(prisma as any), prisma };
}

const ROBOT = {
  id: 'robot-1', activeBoxId: 'box-1', symbol: 'ETH/USDT', accountId: 'cred-1',
  lastUnrealizedPnl: -12.5,
  account: { exchangeId: 'okx' },
};
const RUN = {
  id: 'run-1', runCode: 'RC1', startedAt: T(60 * 48), endedAt: null,
  pnlSignedPosition: 2.35,
  configSnapshot: { mainGridCount: 78 },
};

describe('StrategyMetricsService.getStrategyMetrics', () => {
  it('RUNNING 机器人：窗口内 fills + funding → 指标完整，netExposure 用最后一笔成交价', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findMany.mockResolvedValue([ROBOT]);
    prisma.run.findFirst.mockResolvedValue(RUN);
    prisma.fill.findMany.mockResolvedValue([
      makeFill({ side: 'BUY', realizedPnlDelta: 0, filledAt: T(30) }),
      makeFill({ filledAt: T(10), price: 1910 }),
    ]);
    prisma.fundingEvent.findMany.mockResolvedValue([
      // DB 原始现金流：付出 0.4 → 存 −0.4；指标口径转为成本 +0.4
      { fundingTime: T(20), amount: -0.4, attributedRunId: 'run-1' },
    ]);

    const res = await svc.getStrategyMetrics('24h');

    expect(res.window).toBe('24h');
    expect(res.robots).toHaveLength(1);
    const entry = res.robots[0];
    expect(entry.exchange).toBe('okx');
    expect(entry.runCode).toBe('RC1');
    // netPnl = 0.8 − 0.1(fee) − 0.4(funding) = 0.3
    expect(entry.metrics.netPnl).toBeCloseTo(0.3, 10);
    expect(entry.metrics.funding).toBeCloseTo(0.4, 10);
    expect(entry.metrics.unrealizedPnl).toBe(-12.5);
    // netExposure = 2.35 × 1910（窗口内最后一笔 fill 的 price）
    expect(entry.metrics.netExposure).toBeCloseTo(2.35 * 1910, 6);
    expect(entry.dataQuality).toEqual({ fills: 2, windowCovered: true });
    // 汇总行：单机器人时等于该机器人（除 gridCoverage/maxDrawdown 为 null）
    expect(res.aggregate.netPnl).toBeCloseTo(0.3, 10);
    expect(res.aggregate.gridCoverage).toBeNull();
    expect(res.aggregate.maxDrawdown).toBeNull();
    expect(res.aggregate.unrealizedPnl).toBe(-12.5);
    expect(res.aggregate.netExposure).toBeCloseTo(2.35 * 1910, 6);
  });

  it('窗口过滤：filledAt 早于窗口的成交不计入', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findMany.mockResolvedValue([ROBOT]);
    prisma.run.findFirst.mockResolvedValue(RUN);
    prisma.fill.findMany.mockResolvedValue([]);
    prisma.fundingEvent.findMany.mockResolvedValue([]);

    await svc.getStrategyMetrics('24h');

    const fillWhere = prisma.fill.findMany.mock.calls[0][0].where;
    expect(fillWhere.runId).toBe('run-1');
    expect(fillWhere.filledAt.gte.getTime()).toBeGreaterThan(Date.now() - 24 * 3600_000 - 60_000);
  });

  it('未归属 funding 按同 (账户, symbol) 活跃机器人数均分', async () => {
    const { svc, prisma } = makeSvc();
    const robot2 = { ...ROBOT, id: 'robot-2' };
    prisma.robot.findMany.mockResolvedValue([ROBOT, robot2]);
    prisma.run.findFirst
      .mockResolvedValueOnce(RUN)
      .mockResolvedValueOnce({ ...RUN, id: 'run-2', runCode: 'RC2' });
    prisma.fill.findMany.mockResolvedValue([makeFill()]);
    prisma.fundingEvent.findMany.mockResolvedValue([
      { fundingTime: T(20), amount: -1.0, attributedRunId: null, credentialId: 'cred-1', symbol: 'ETH/USDT' },
    ]);

    const res = await svc.getStrategyMetrics('24h');

    expect(res.robots[0].metrics.funding).toBeCloseTo(0.5, 10);
    expect(res.robots[1].metrics.funding).toBeCloseTo(0.5, 10);
    // 汇总行 funding 不重复计：0.5 + 0.5 = 1.0
    expect(res.aggregate.funding).toBeCloseTo(1.0, 10);
  });

  it('收到资金费（DB amount 为正）时 funding 为负成本、抬升 netPnl', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findMany.mockResolvedValue([ROBOT]);
    prisma.run.findFirst.mockResolvedValue(RUN);
    prisma.fill.findMany.mockResolvedValue([
      makeFill({ side: 'BUY', realizedPnlDelta: 0, filledAt: T(30) }),
      makeFill({ filledAt: T(10), price: 1910 }),
    ]);
    prisma.fundingEvent.findMany.mockResolvedValue([
      // DB 原始现金流：收取 0.3 → 存 +0.3；指标口径转为成本 −0.3
      { fundingTime: T(20), amount: 0.3, attributedRunId: 'run-1' },
    ]);

    const res = await svc.getStrategyMetrics('24h');

    const entry = res.robots[0];
    expect(entry.metrics.funding).toBeCloseTo(-0.3, 10);
    // netPnl = 0.8 − 0.1(fee) − (−0.3)(funding) = 1.0
    expect(entry.metrics.netPnl).toBeCloseTo(1.0, 10);
    expect(res.aggregate.funding).toBeCloseTo(-0.3, 10);
  });

  it('无活跃 Run 的机器人跳过；无成交机器人指标为零值且 windowCovered 按 startedAt 判定', async () => {
    const { svc, prisma } = makeSvc();
    const freshRun = { ...RUN, startedAt: T(30) }; // 30 分钟前启动，不足 24h 窗口
    prisma.robot.findMany.mockResolvedValue([ROBOT, { ...ROBOT, id: 'robot-2', activeBoxId: 'box-2' }]);
    prisma.run.findFirst
      .mockResolvedValueOnce(null)      // robot-1 无活跃 run → 跳过
      .mockResolvedValueOnce(freshRun); // robot-2
    prisma.fill.findMany.mockResolvedValue([]);
    prisma.fundingEvent.findMany.mockResolvedValue([]);

    const res = await svc.getStrategyMetrics('24h');

    expect(res.robots).toHaveLength(1);
    expect(res.robots[0].robotId).toBe('robot-2');
    expect(res.robots[0].metrics.netPnl).toBe(0);
    expect(res.robots[0].metrics.winRate).toBe(0);
    expect(res.robots[0].metrics.avgPnlPerFill).toBeNull();
    expect(res.robots[0].metrics.netExposure).toBeNull();
    expect(res.robots[0].dataQuality).toEqual({ fills: 0, windowCovered: false });
  });
});

describe('StrategyMetricsService.getStrategySeries', () => {
  it('按窗口桶返回累计序列；robotId 无活跃 run 返回空点列', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findUnique.mockResolvedValue(ROBOT);
    prisma.run.findFirst.mockResolvedValue(null);

    const res = await svc.getStrategySeries('robot-1', '24h');
    expect(res.robotId).toBe('robot-1');
    expect(res.points).toHaveLength(48);
    expect(res.points.every((p) => p.cumNetPnl === 0 && p.cumAlpha === 0)).toBe(true);
  });

  it('series 包含未归属 funding 的均分份额（与指标卡口径一致）', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findUnique.mockResolvedValue(ROBOT);
    prisma.run.findFirst.mockResolvedValue(RUN);
    // 同 (账户, symbol) 组内 2 个活跃机器人（组内计数用）
    prisma.robot.findMany.mockResolvedValue([ROBOT, { ...ROBOT, id: 'robot-2' }]);
    prisma.fill.findMany.mockResolvedValue([makeFill()]);
    prisma.fundingEvent.findMany.mockResolvedValue([
      { fundingTime: T(20), amount: -1.0, attributedRunId: null, credentialId: 'cred-1', symbol: 'ETH/USDT' },
    ]);

    const res = await svc.getStrategySeries('robot-1', '24h');

    const last = res.points[res.points.length - 1];
    // fill 净贡献 = 0.8 − 0.05(fee) = 0.75；未归属 funding 支出 1.0 均分 2 个机器人 → −0.5
    expect(last.cumNetPnl).toBeCloseTo(0.25, 10);
    // funding 查询必须带 OR（含 attributedRunId: null 的未归属事件）
    const fundingWhere = prisma.fundingEvent.findMany.mock.calls[0][0].where;
    expect(fundingWhere.OR).toEqual([
      { attributedRunId: 'run-1' },
      { attributedRunId: null, credentialId: 'cred-1', symbol: 'ETH/USDT' },
    ]);
  });

  it('未知 robotId 抛 NotFoundException', async () => {
    const { svc, prisma } = makeSvc();
    prisma.robot.findUnique.mockResolvedValue(null);

    await expect(svc.getStrategySeries('ghost', '24h')).rejects.toThrow(NotFoundException);
  });
});

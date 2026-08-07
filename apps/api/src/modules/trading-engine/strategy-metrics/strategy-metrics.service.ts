import { Injectable, NotFoundException } from '@nestjs/common';
import type { Run } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { feeInQuote } from '../fills/fee-conversion';
import {
  SERIES_BUCKET_MS, WINDOW_MS, buildCumulativeSeries, computeRobotMetrics, fundingTotal,
} from './compute-metrics';
import type {
  MetricsFill, MetricsFunding, MetricsWindow,
  RobotMetricsEntry, StrategyMetricsResponse, StrategySeriesResponse,
} from './strategy-metrics.types';

@Injectable()
export class StrategyMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 策略评价指标：所有 RUNNING 机器人逐窗口计算 + 策略汇总行。
   * 每个指标口径见 spec 第 2 节，可用 SQL 从 Fill 逐笔复算。 */
  async getStrategyMetrics(window: MetricsWindow): Promise<StrategyMetricsResponse> {
    const now = Date.now();
    const since = new Date(now - WINDOW_MS[window]);

    const robots = await this.prisma.robot.findMany({
      where: { status: 'RUNNING' },
      include: { account: { select: { exchangeId: true } } },
    });

    const active: Array<{ robot: (typeof robots)[number]; run: Run }> = [];
    for (const robot of robots) {
      if (!robot.activeBoxId) continue;
      const run = await this.prisma.run.findFirst({
        where: { boxId: robot.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) active.push({ robot, run });
    }

    // 未归属 funding 按同 (账户, symbol) 活跃机器人数均分
    const groupCount = new Map<string, number>();
    for (const { robot } of active) {
      const key = `${robot.accountId}:${robot.symbol}`;
      groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
    }

    const entries: RobotMetricsEntry[] = [];
    const allFills: MetricsFill[] = [];
    let totalFundingAmount = 0;
    let sumUnrealized: number | null = null;
    let sumExposure: number | null = null;

    for (const { robot, run } of active) {
      const share = 1 / (groupCount.get(`${robot.accountId}:${robot.symbol}`) ?? 1);
      const { fills, fundings } = await this.loadWindowData(robot, run, since, share);

      const cfg = run.configSnapshot as { mainGridCount?: number } | null;
      const metrics = computeRobotMetrics(fills, fundings, cfg?.mainGridCount ?? null, window);
      metrics.unrealizedPnl = robot.lastUnrealizedPnl ?? null;
      const lastPrice = fills.length > 0 ? fills[fills.length - 1].price : null;
      metrics.netExposure = lastPrice != null ? run.pnlSignedPosition * lastPrice : null;

      entries.push({
        robotId: robot.id,
        exchange: robot.account.exchangeId,
        symbol: robot.symbol,
        runCode: run.runCode,
        startedAt: run.startedAt.toISOString(),
        metrics,
        dataQuality: {
          fills: fills.length,
          windowCovered: run.startedAt.getTime() <= now - WINDOW_MS[window],
        },
      });

      allFills.push(...fills);
      totalFundingAmount += fundingTotal(fundings);
      if (metrics.unrealizedPnl != null) sumUnrealized = (sumUnrealized ?? 0) + metrics.unrealizedPnl;
      if (metrics.netExposure != null) sumExposure = (sumExposure ?? 0) + metrics.netExposure;
    }

    // 汇总行：合并 fills 跑一次纯函数（比率型指标天然按成交额/笔数加权），
    // funding 用合成单笔事件（总额）。gridCoverage/maxDrawdown 不可跨机器人汇总 → null。
    const aggregate = computeRobotMetrics(
      allFills,
      [{ fundingTime: new Date(now), amount: totalFundingAmount }],
      null,
      window,
    );
    aggregate.gridCoverage = null;
    aggregate.maxDrawdown = null;
    aggregate.unrealizedPnl = sumUnrealized;
    aggregate.netExposure = sumExposure;

    return {
      window,
      generatedAt: new Date(now).toISOString(),
      aggregate,
      robots: entries,
    };
  }

  /** 明细页曲线：窗口内累计净盈亏 + 累计 alpha（桶对齐）。funding 口径与指标卡一致（含未归属均分）。 */
  async getStrategySeries(robotId: string, window: MetricsWindow): Promise<StrategySeriesResponse> {
    const now = Date.now();
    const since = new Date(now - WINDOW_MS[window]);
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException(`Robot not found: ${robotId}`);
    const run = robot.activeBoxId
      ? await this.prisma.run.findFirst({
          where: { boxId: robot.activeBoxId, endedAt: null },
          orderBy: { startedAt: 'desc' },
        })
      : null;

    let fills: MetricsFill[] = [];
    let fundings: MetricsFunding[] = [];
    if (run) {
      const share = 1 / (await this.countActivePeers(robot.accountId, robot.symbol));
      ({ fills, fundings } = await this.loadWindowData(robot, run, since, share));
    }

    const points = buildCumulativeSeries(fills, fundings, window, now);
    return {
      robotId,
      window,
      bucketMs: SERIES_BUCKET_MS[window],
      points,
    };
  }

  /** 窗口取数（metrics/series 共用，保证曲线终点 = 指标卡数字）：
   * fills 含 feeInQuote 折算；funding 用 OR 查询（已归属本 run 全额 + 未归属同组均分），
   * DB 现金流（负=支出）→ 内部成本（正=支出），与 Run.totalFunding 的 increment: -amount 一致。 */
  private async loadWindowData(
    robot: { accountId: string; symbol: string },
    run: Run,
    since: Date,
    share: number,
  ): Promise<{ fills: MetricsFill[]; fundings: MetricsFunding[] }> {
    const fillsRaw = await this.prisma.fill.findMany({
      where: { runId: run.id, filledAt: { gte: since } },
      orderBy: { filledAt: 'asc' },
    });
    const fills: MetricsFill[] = fillsRaw.map((f) => ({
      side: f.side as 'BUY' | 'SELL',
      qty: f.qty,
      price: f.price,
      feeUsdt: feeInQuote(f.fee, f.feeAsset ?? undefined, robot.symbol, f.price),
      notional: f.notional ?? f.qty * f.price,
      savings: f.savings,
      realizedPnlDelta: f.realizedPnlDelta,
      gridIndex: f.gridIndex,
      filledAt: f.filledAt,
    }));

    const fundingRows = await this.prisma.fundingEvent.findMany({
      where: {
        fundingTime: { gte: since },
        OR: [
          { attributedRunId: run.id },
          { attributedRunId: null, credentialId: robot.accountId, symbol: robot.symbol },
        ],
      },
    });
    const fundings: MetricsFunding[] = fundingRows.map((f) => ({
      fundingTime: f.fundingTime,
      amount: f.attributedRunId === run.id ? -f.amount : -f.amount * share,
    }));

    return { fills, fundings };
  }

  /** 同 (账户, symbol) 组内活跃机器人数（status=RUNNING 且有活跃 run），用于未归属 funding 均分。 */
  private async countActivePeers(accountId: string, symbol: string): Promise<number> {
    const peers = await this.prisma.robot.findMany({
      where: { status: 'RUNNING', accountId, symbol },
    });
    let count = 0;
    for (const peer of peers) {
      if (!peer.activeBoxId) continue;
      const run = await this.prisma.run.findFirst({
        where: { boxId: peer.activeBoxId, endedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (run) count++;
    }
    return count || 1;
  }
}

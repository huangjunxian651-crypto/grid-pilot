import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

export interface FillSavings {
  fillId: string;
  fillPrice: number;
  fillQty: number;
  side: 'BUY' | 'SELL';
  gridIndex: number;
  savings: number;
  savingsRate: number;
  createdAt: Date;
}

export interface SavingsSummary {
  totalSavings: number;
  totalSavingsRate: number;
  fillCount: number;
  buySavings: number;
  sellSavings: number;
  buyCount: number;
  sellCount: number;
  fills: FillSavings[];
}

interface FillRow {
  id: string;
  side: string;
  qty: number;
  price: number;
  gridIndex: number | null;
  savings: number;
  savingsRate: number;
  filledAt: Date;
}

@Injectable()
export class SavingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSavingsSummary(configId: string, limit: number = 100): Promise<SavingsSummary> {
    const box = await this.prisma.box.findUnique({
      where: { id: configId },
      include: { runs: { orderBy: { startedAt: 'desc' } } },
    });
    if (!box) throw new NotFoundException(`Config not found: ${configId}`);

    const runs = box.runs ?? [];
    const runIds = runs.map((r: { id: string }) => r.id);
    const totalSavings = runs.reduce((s: number, r: { totalSavings: number }) => s + (r.totalSavings ?? 0), 0);

    const fills: FillRow[] = runIds.length
      ? await this.prisma.fill.findMany({
          where: { runId: { in: runIds } },
          orderBy: { filledAt: 'desc' },
          take: limit,
        })
      : [];

    return this.buildSummary(fills, totalSavings);
  }

  async getSavingsSummaryBySession(runCode: string, limit: number = 100): Promise<SavingsSummary> {
    const run = await this.prisma.run.findUnique({ where: { runCode } });
    if (!run) throw new NotFoundException(`Session not found: ${runCode}`);

    const fills: FillRow[] = await this.prisma.fill.findMany({
      where: { runId: run.id },
      orderBy: { filledAt: 'desc' },
      take: limit,
    });

    return this.buildSummary(fills, run.totalSavings ?? 0);
  }

  /**
   * 机器人级右侧面板的轻量两指标（避免全量扫成交）。
   * alphaTotal = sum(run.totalSavings)（持久化列，无成交扫描）；
   * todayRealizedPnl = 今日窗口成交 realizedPnlDelta 之和。
   */
  async getRobotSummaryMetrics(
    robotId: string,
    now: Date = new Date(),
  ): Promise<{ todayRealizedPnl: number; alphaTotal: number }> {
    const runs = await this.prisma.run.findMany({
      where: { box: { robotId } },
      select: { id: true, totalSavings: true },
    });
    const alphaTotal = runs.reduce((s: number, r: { totalSavings: number }) => s + (r.totalSavings ?? 0), 0);
    const runIds = runs.map((r: { id: string }) => r.id);
    if (runIds.length === 0) return { todayRealizedPnl: 0, alphaTotal: 0 };

    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const fills = await this.prisma.fill.findMany({
      where: { runId: { in: runIds }, filledAt: { gte: dayStart } },
      select: { realizedPnlDelta: true },
    });
    const todayRealizedPnl = fills.reduce((s: number, f: { realizedPnlDelta: number }) => s + (f.realizedPnlDelta ?? 0), 0);
    return { todayRealizedPnl, alphaTotal };
  }

  async getRealizedPnlByConfig(configId: string): Promise<{ realizedPnl: number; fillCount: number }> {
    const box = await this.prisma.box.findUnique({
      where: { id: configId },
      include: { runs: true },
    });
    if (!box) throw new NotFoundException(`Config not found: ${configId}`);

    const runs = box.runs ?? [];
    const realizedPnl = runs.reduce((s: number, r: { realizedPnl: number }) => s + (r.realizedPnl ?? 0), 0);
    const fillCount = runs.reduce((s: number, r: { fillCount: number }) => s + (r.fillCount ?? 0), 0);
    return { realizedPnl, fillCount };
  }

  private buildSummary(fills: FillRow[], totalSavings: number): SavingsSummary {
    let buySavings = 0;
    let sellSavings = 0;
    let buyCount = 0;
    let sellCount = 0;
    let totalActualValue = 0;

    const fillSavingsList: FillSavings[] = fills.map((f) => {
      const side = (f.side === 'SELL' ? 'SELL' : 'BUY') as 'BUY' | 'SELL';
      totalActualValue += f.price * f.qty;
      if (side === 'BUY') {
        buySavings += f.savings;
        buyCount++;
      } else {
        sellSavings += f.savings;
        sellCount++;
      }
      return {
        fillId: f.id,
        fillPrice: f.price,
        fillQty: f.qty,
        side,
        gridIndex: f.gridIndex ?? -1,
        savings: f.savings,
        savingsRate: f.savingsRate,
        createdAt: f.filledAt,
      };
    });

    const totalSavingsRate = totalActualValue > 0 ? totalSavings / totalActualValue : 0;

    return {
      totalSavings,
      totalSavingsRate,
      fillCount: fillSavingsList.length,
      buySavings,
      sellSavings,
      buyCount,
      sellCount,
      fills: fillSavingsList,
    };
  }
}

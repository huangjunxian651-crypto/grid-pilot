import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import { deriveEquityFields } from './account-snapshot.service';

export interface CaptureRunBalanceInput {
  runId: string;
  event: 'START' | 'STOP';
  adapter: ExchangeAdapter;
  symbol: string;
  credentialId: string;
  boxId: string;
  robotId?: string | null;
  ledger: { realizedPnl: number; totalFees: number; totalSavings: number };
  /** runner 已有的实时价；缺省则回退 getTicker，再回退持仓 entryPrice。 */
  lastTickerPrice?: number;
  /** 仅 STOP */
  exitReason?: string;
  liquidationOk?: boolean;
}

/**
 * Run(Session) 启停时的账户余额快照：START(运行前) / STOP(平仓后) 各一行。
 * best-effort——取数或落库失败只 warn，绝不抛出，不阻塞机器人启停/平仓。
 */
@Injectable()
export class RunBalanceSnapshotService {
  private readonly logger = new Logger(RunBalanceSnapshotService.name);
  constructor(private readonly prisma: PrismaService) {}

  async capture(input: CaptureRunBalanceInput): Promise<void> {
    try {
      const balance = await input.adapter.getBalance();
      const position = await input.adapter.getPosition(input.symbol).catch(() => null);
      const equity = deriveEquityFields(balance);

      // 实仓判定按 qty 阈值（与 startBot 持仓继承口径一致）：交易所对无仓可能返回
      // {qty:0, entryPrice:0} 而非 null，避免把它当成 entryPrice=0 的实仓。
      const hasPosition = !!position && Math.abs(position.baseAssetQty) > 1e-12;

      let markPrice = input.lastTickerPrice;
      if (markPrice == null) {
        const ticker = await input.adapter.getTicker(input.symbol).catch(() => null);
        markPrice = ticker?.last ?? (hasPosition ? position!.entryPrice : 0);
      }

      const data = {
        totalEquity: equity.totalEquity,
        totalWalletBalance: equity.totalWalletBalance,
        availableUsdt: equity.availableUsdt,
        marginUsed: equity.marginUsed,
        symbol: input.symbol,
        positionQty: hasPosition ? position!.baseAssetQty : 0,
        entryPrice: hasPosition ? position!.entryPrice : null,
        unrealizedPnl: hasPosition && Number.isFinite(position!.unrealizedPnl) ? (position!.unrealizedPnl as number) : 0,
        markPrice,
        realizedPnl: input.ledger.realizedPnl,
        totalFees: input.ledger.totalFees,
        totalSavings: input.ledger.totalSavings,
        credentialId: input.credentialId,
        boxId: input.boxId,
        robotId: input.robotId ?? null,
        exitReason: input.exitReason ?? null,
        liquidationOk: input.liquidationOk ?? null,
      };
      // upsert 而非 create：用户停止路径下 stopBot 与 handleAutoTermination 会对同一
      // (runId,STOP) 各触发一次（FSM 经 LIQUIDATED），唯一约束 + upsert 保证至多一行、不抛 P2002。
      await this.prisma.runBalanceSnapshot.upsert({
        where: { runId_event: { runId: input.runId, event: input.event } },
        create: { runId: input.runId, event: input.event, ...data },
        update: data,
      });
    } catch (err) {
      this.logger.warn(`[${input.runId}] capture ${input.event} balance snapshot failed: ${(err as Error).message}`);
    }
  }

  /** 读取某 run 的启停快照（START 在前），供对账/展示。 */
  async getByRunId(runId: string) {
    return this.prisma.runBalanceSnapshot.findMany({
      where: { runId },
      orderBy: { capturedAt: 'asc' },
    });
  }
}

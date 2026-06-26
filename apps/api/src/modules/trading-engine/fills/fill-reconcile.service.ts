import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FillIngestionService } from './fill-ingestion.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
// 常量抽到中立模块（见 reconcile-window.ts）以避免与 FillIngestionService 形成 import 环；
// 此处再导出，保持既有 `from './fill-reconcile.service'` 的导入契约不变。
export { RECONCILE_ROLLBACK_MS } from './reconcile-window';
import { RECONCILE_ROLLBACK_MS } from './reconcile-window';

@Injectable()
export class FillReconcileService {
  private readonly logger = new Logger(FillReconcileService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: FillIngestionService,
  ) {}

  /** 拉取该 run 自最后一笔成交以来的交易所逐笔成交，逐笔幂等 ingest（补漏 / 关闭 order-before-fill 窗口）。 */
  async reconcileRun(runCode: string, symbol: string, adapter: ExchangeAdapter): Promise<void> {
    const run = await this.prisma.run.findUnique({ where: { runCode } });
    if (!run) return;
    const last = await this.prisma.fill.findFirst({
      where: { runId: run.id },
      orderBy: { filledAt: 'desc' },
      select: { filledAt: true },
    });
    const lastMs = last?.filledAt ? new Date(last.filledAt).getTime() : 0;
    // 本 run 的自有成交不可能早于 startedAt，故取「startedAt − 回滚」为窗口地板：
    // 无自有成交（lastMs=0）时旧实现退化为 0 → getMyTrades 拉回账户级最近成交
    // （旧 run / legacy / 手动 `api` 单），逐笔 ingest 匹配不上而每个 sweep 刷屏 WARN
    // 且白拉历史。钉到 startedAt 既消除启动前外来成交，又不漏任何自有成交，
    // 回滚窗口对 order-before-fill 竞态的保护原样保留（有自有成交时 lastMs−ROLLBACK
    // ≥ startedAt−ROLLBACK，行为不变）。
    const floorMs = new Date(run.startedAt).getTime() - RECONCILE_ROLLBACK_MS;
    const base = lastMs > 0 ? lastMs - RECONCILE_ROLLBACK_MS : floorMs;
    const sinceMs = Math.max(0, floorMs, base);
    let trades;
    try {
      trades = await adapter.getMyTrades(symbol, sinceMs);
    } catch (err) {
      this.logger.warn(`[${runCode}] reconcile getMyTrades failed: ${(err as Error).message}`);
      return;
    }
    for (const t of trades) {
      try {
        await this.ingestion.ingest(runCode, t);
      } catch (err) {
        this.logger.warn(`[${runCode}] reconcile ingest failed for ${t.fillId}: ${(err as Error).message}`);
      }
    }
  }
}

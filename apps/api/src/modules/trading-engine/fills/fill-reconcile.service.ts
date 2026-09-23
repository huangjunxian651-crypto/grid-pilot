import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { FillIngestionService } from './fill-ingestion.service';
import { NotificationService } from '../../notification/notification.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
// 常量抽到中立模块（见 reconcile-window.ts）以避免与 FillIngestionService 形成 import 环；
// 此处再导出，保持既有 `from './fill-reconcile.service'` 的导入契约不变。
export { RECONCILE_ROLLBACK_MS } from './reconcile-window';
import { RECONCILE_ROLLBACK_MS } from './reconcile-window';

@Injectable()
export class FillReconcileService {
  private readonly logger = new Logger(FillReconcileService.name);
  /** 按 runCode 记录连续失败次数（getMyTrades 抛错才计数，run 不存在等提前返回不算失败）。 */
  private readonly consecutiveFailures = new Map<string, number>();
  /** 本轮故障是否已经告警过，成功一次即清除，允许下一轮独立故障重新告警。 */
  private readonly alertedFailures = new Set<string>();
  /** cold-start、定时 sweep 和成交触发可能同时进入；同一 run 只保留一轮 REST 对账。 */
  private readonly inFlight = new Map<string, Promise<{ newFillsCount: number }>>();
  private static readonly FAILURE_ALERT_THRESHOLD = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: FillIngestionService,
    private readonly notificationService: NotificationService,
  ) {}

  /** 拉取该 run 自最后一笔成交以来的交易所逐笔成交，逐笔幂等 ingest（补漏 / 关闭 order-before-fill 窗口）。
   * 返回本次新落库的成交数，供手动触发入口向用户展示"补了几笔"。 */
  async reconcileRun(runCode: string, symbol: string, adapter: ExchangeAdapter): Promise<{ newFillsCount: number }> {
    const existing = this.inFlight.get(runCode);
    if (existing) return existing;

    const work = this.reconcileRunOnce(runCode, symbol, adapter);
    this.inFlight.set(runCode, work);
    try {
      return await work;
    } finally {
      if (this.inFlight.get(runCode) === work) this.inFlight.delete(runCode);
    }
  }

  private async reconcileRunOnce(
    runCode: string,
    symbol: string,
    adapter: ExchangeAdapter,
  ): Promise<{ newFillsCount: number }> {
    const run = await this.prisma.run.findUnique({ where: { runCode } });
    if (!run) return { newFillsCount: 0 };
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
      await this.recordFailure(runCode, symbol);
      return { newFillsCount: 0 };
    }
    this.recordSuccess(runCode);
    let newFillsCount = 0;
    for (const t of trades) {
      try {
        const created = await this.ingestion.ingest(runCode, t);
        if (created) newFillsCount++;
      } catch (err) {
        this.logger.warn(`[${runCode}] reconcile ingest failed for ${t.fillId}: ${(err as Error).message}`);
      }
    }
    return { newFillsCount };
  }

  private recordSuccess(runCode: string): void {
    this.consecutiveFailures.delete(runCode);
    this.alertedFailures.delete(runCode);
  }

  private async recordFailure(runCode: string, symbol: string): Promise<void> {
    const count = (this.consecutiveFailures.get(runCode) ?? 0) + 1;
    this.consecutiveFailures.set(runCode, count);
    if (count < FillReconcileService.FAILURE_ALERT_THRESHOLD) return;
    if (this.alertedFailures.has(runCode)) return;
    this.alertedFailures.add(runCode);
    try {
      await this.notificationService.createAndBroadcast({
        type: 'alert',
        title: 'Reconcile repeatedly failing',
        code: 'RECONCILE_REPEATED_FAILURE',
        body: `${symbol} ${runCode}: reconcile failed ${count} times in a row`,
        params: { runCode, symbol, count: String(count) },
      });
    } catch (err) {
      this.logger.error(`[${runCode}] reconcile-failure notification failed: ${(err as Error).message}`);
      this.alertedFailures.delete(runCode);
    }
  }
}

import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountSnapshotService } from './account-snapshot.service';
import type { FundingFeeRecord } from '../../exchange/interfaces/exchange-adapter.interface';

/** FundingIngestionService 所需的最小 adapter 接口（只依赖可选的 fetchFundingHistory）。 */
export interface FundingAdapter {
  fetchFundingHistory?(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]>;
}

@Injectable()
export class FundingIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FundingIngestionService.name);

  /**
   * 增量游标：per (credentialId, symbol) 上次拉取的最大 fundingTime（ms）。
   * 进程内持久，避免每次都从 DB 查 max。初次拉取时回退到 DB max 或 0。
   */
  private readonly cursors = new Map<string, number>();

  /** 后台采集定时器：funding 8h 级，低频轮询足够；启动后短延迟首跑（待 runner 恢复）。 */
  private static readonly INTERVAL_MS = 60 * 60_000;
  private static readonly INITIAL_DELAY_MS = 60_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  /** 防重入：上一轮未跑完时跳过本轮，避免慢拉取叠加。 */
  private cycleInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountSnapshot: AccountSnapshotService,
  ) {}

  onModuleInit(): void {
    // initialTimer 仅为首跑（启动后 INITIAL_DELAY_MS，待 runner 恢复）；interval 从 boot 时刻起计，
    // INTERVAL_MS 后才首次触发——两者不重叠（除非把 INTERVAL_MS 改得比 INITIAL_DELAY_MS 还小）。
    this.initialTimer = setTimeout(() => void this.runCycle(), FundingIngestionService.INITIAL_DELAY_MS);
    this.timer = setInterval(() => void this.runCycle(), FundingIngestionService.INTERVAL_MS);
  }

  onModuleDestroy(): void {
    // clearInterval 只阻止新触发，不 abort 进行中的 runCycle。in-flight 时记一条 warn 便于运维感知；
    // 即便被 SIGTERM 截断也无数据损坏（$transaction 回滚 + 幂等，下轮重拉补齐）。
    if (this.cycleInFlight) {
      this.logger.warn('FundingIngestion 关闭时仍有采集进行中，本轮可能被截断（幂等，下轮自动补齐）');
    }
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.timer) clearInterval(this.timer);
    this.initialTimer = null;
    this.timer = null;
  }

  /** 一轮采集：遍历当前活跃账户（来自 AccountSnapshotService 的活跃轮询集合），逐账户 ingest。
   *  best-effort（单账户失败只 warn）+ 防重入。 */
  async runCycle(): Promise<void> {
    if (this.cycleInFlight) return;
    this.cycleInFlight = true;
    try {
      for (const poller of this.accountSnapshot.getActivePollers()) {
        await this.ingestForCredential(poller.credentialId, poller.adapter, poller.symbols).catch((err) =>
          this.logger.warn(
            `[${poller.credentialId}] funding cycle failed (symbols: ${poller.symbols.join(',')}): ${(err as Error).message}`,
          ),
        );
      }
    } finally {
      this.cycleInFlight = false;
    }
  }

  /**
   * 拉取并归因 credentialId 下各 symbol 的资金费事件。
   * - 每个 symbol 独立 best-effort：失败只 warn，不影响其他 symbol。
   * - 幂等：同 (credentialId, symbol, fundingTime) 重复摄入不重复累加 Run.totalFunding。
   */
  async ingestForCredential(
    credentialId: string,
    adapter: FundingAdapter,
    symbols: string[],
  ): Promise<void> {
    if (!adapter.fetchFundingHistory) return;

    for (const symbol of symbols) {
      try {
        await this.ingestSymbol(credentialId, symbol, adapter);
      } catch (err) {
        this.logger.warn(
          `[${credentialId}/${symbol}] FundingIngestion failed: ${(err as Error).message}`,
        );
      }
    }
  }

  private async ingestSymbol(
    credentialId: string,
    symbol: string,
    adapter: FundingAdapter,
  ): Promise<void> {
    const sinceMs = await this.resolveCursor(credentialId, symbol);

    // fetchFundingHistory 的存在已在 ingestForCredential 入口处确认
    const records = await adapter.fetchFundingHistory!(symbol, sinceMs);
    if (records.length === 0) return;

    let maxFundingTimeMs = sinceMs;

    for (const record of records) {
      await this.ingestRecord(credentialId, record);
      if (record.fundingTime > maxFundingTimeMs) {
        maxFundingTimeMs = record.fundingTime;
      }
    }

    // 更新游标为本批最大 fundingTime（下次拉取从此时间点之后开始）
    const cursorKey = this.cursorKey(credentialId, symbol);
    this.cursors.set(cursorKey, maxFundingTimeMs);
  }

  private async ingestRecord(credentialId: string, record: FundingFeeRecord): Promise<void> {
    const fundingTimeDate = new Date(record.fundingTime);

    // 归因 Run：找同一 credentialId+symbol 下在 fundingTime 内活跃的 run（最近启动优先）
    // FIX I-2: 加入 box.accountId=credentialId 过滤，避免多账户同 symbol 时归因到错误账户
    const attributedRun = await this.prisma.run.findFirst({
      where: {
        box: { symbol: record.symbol, accountId: credentialId },
        startedAt: { lte: fundingTimeDate },
        OR: [{ endedAt: null }, { endedAt: { gte: fundingTimeDate } }],
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    const attributedRunId = attributedRun?.id ?? null;

    // 幂等：先查是否已存在，决定是否为新建行
    const existing = await this.prisma.fundingEvent.findUnique({
      where: {
        credentialId_symbol_fundingTime: {
          credentialId,
          symbol: record.symbol,
          fundingTime: fundingTimeDate,
        },
      },
      select: { id: true },
    });

    if (existing) {
      // 已存在：不重复累加 Run.totalFunding，直接跳过
      return;
    }

    // FIX I-1: 原子写入 FundingEvent + Run.totalFunding（当有归因 Run 时）
    // 使用 $transaction 确保 create 和 update 要么同时成功要么同时回滚，
    // 避免 create 成功后 update 失败导致幂等跳过但 totalFunding 永久少计的问题
    if (attributedRunId) {
      await this.prisma.$transaction([
        this.prisma.fundingEvent.create({
          data: {
            credentialId,
            symbol: record.symbol,
            fundingTime: fundingTimeDate,
            amount: record.amount,
            attributedRunId,
          },
        }),
        this.prisma.run.update({
          where: { id: attributedRunId },
          // FundingEvent.amount = 原始资金费现金流(付出为负/收取为正)；
          // Run.totalFunding 累计的是「资金费成本」(付出为正)，
          // 故 increment 取 -amount，配合 net=realized−fees−funding。
          data: { totalFunding: { increment: -record.amount } },
        }),
      ]);
    } else {
      // 无归因 Run：仅创建 FundingEvent，无需 $transaction
      await this.prisma.fundingEvent.create({
        data: {
          credentialId,
          symbol: record.symbol,
          fundingTime: fundingTimeDate,
          amount: record.amount,
          attributedRunId: null,
        },
      });
    }
  }

  /**
   * 解析该 (credentialId, symbol) 的拉取起始游标。
   * 优先使用内存 Map；首次时从 DB 查 max(fundingTime)，再回退到 0（全量拉取）。
   */
  private async resolveCursor(credentialId: string, symbol: string): Promise<number> {
    const key = this.cursorKey(credentialId, symbol);
    const cached = this.cursors.get(key);
    if (cached !== undefined) return cached;

    // 从 DB 查该 credential+symbol 最大 fundingTime 作为初始游标
    const latest = await this.prisma.fundingEvent.findFirst({
      where: { credentialId, symbol },
      orderBy: { fundingTime: 'desc' },
      select: { fundingTime: true },
    });
    const cursor = latest?.fundingTime ? new Date(latest.fundingTime).getTime() : 0;
    this.cursors.set(key, cursor);
    return cursor;
  }

  private cursorKey(credentialId: string, symbol: string): string {
    return `${credentialId}::${symbol}`;
  }
}

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type { Position, Balance } from '../types/exchange.types';
import type { AccountSnapshot, PositionInfo } from '@gridpilot/shared-types';
export type { AccountSnapshot, PositionInfo } from '@gridpilot/shared-types';

/** 账户权益字段的统一口径（钱包余额优先，回退 free+locked；权益=钱包+未实现）。
 *  供 AccountSnapshotService 与 RunBalanceSnapshotService 共用，避免口径漂移。 */
export function deriveEquityFields(balance: Balance): {
  totalEquity: number;
  totalWalletBalance: number;
  availableUsdt: number;
  marginUsed: number;
} {
  const totalWalletBalance = balance.totalWalletBalance ?? balance.free + balance.locked;
  const totalEquity = totalWalletBalance + (balance.totalUnrealizedProfit ?? 0);
  return { totalEquity, totalWalletBalance, availableUsdt: balance.free, marginUsed: balance.locked };
}

@Injectable()
export class AccountSnapshotService implements OnModuleDestroy {
  private readonly logger = new Logger(AccountSnapshotService.name);
  private snapshots = new Map<string, AccountSnapshot>();
  private adapters = new Map<string, { adapter: ExchangeAdapter; symbols: string[] }>();
  private intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly POLL_INTERVAL_MS = 10_000;
  /** 权益时序落库节流：每 credential 最多 5 分钟一行（P2-1 权益曲线数据源）。 */
  private static readonly PERSIST_INTERVAL_MS = 5 * 60_000;
  private lastPersistedAt = new Map<string, number>();
  private onChanged: ((credentialId: string) => void) | null = null;

  constructor(private readonly prisma: PrismaService) {}

  setOnChanged(cb: (credentialId: string) => void): void {
    this.onChanged = cb;
  }

  stopPolling(credentialId: string): void {
    const interval = this.intervals.get(credentialId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(credentialId);
    }
    this.adapters.delete(credentialId);
    this.snapshots.delete(credentialId);
  }

  /**
   * 声明式：确保该账户在轮询，且其 symbol 集合恰为 symbols。
   * - 已在轮询 → 仅更新 symbols（与 adapter，若提供），不新建定时器；
   * - 未在轮询 → 新建定时器（必须提供 adapter，否则跳过并告警）。
   * 调用方（TradingEngineService.reconcileAccountPolling）以「当前活跃 runner 集合」为真相驱动本方法。
   */
  ensurePolling(credentialId: string, symbols: string[], adapter?: ExchangeAdapter): void {
    const existing = this.adapters.get(credentialId);
    if (existing) {
      existing.symbols = [...symbols];
      if (adapter) existing.adapter = adapter;
      return;
    }
    if (!adapter) {
      this.logger.warn(`[${credentialId}] ensurePolling without adapter and no existing poller — skipped`);
      return;
    }
    this.adapters.set(credentialId, { adapter, symbols: [...symbols] });
    this.intervals.set(
      credentialId,
      setInterval(() => this.pollOnce(credentialId), this.POLL_INTERVAL_MS),
    );
    void this.pollOnce(credentialId);
  }

  /** 诊断/测试用：返回当前轮询覆盖的 symbol 集合（拷贝，避免外部改写内部状态）；未轮询返回 undefined。 */
  getPolledSymbols(credentialId: string): string[] | undefined {
    return this.adapters.get(credentialId)?.symbols.slice();
  }

  /** 当前活跃轮询的账户集合（credentialId→adapter→symbols），随 runner 启停同步。
   *  供资金费后台采集复用同一活跃集合（symbols 拷贝，避免外部改写内部状态）。 */
  getActivePollers(): Array<{ credentialId: string; adapter: ExchangeAdapter; symbols: string[] }> {
    return Array.from(this.adapters.entries()).map(([credentialId, { adapter, symbols }]) => ({
      credentialId,
      adapter,
      symbols: symbols.slice(),
    }));
  }

  stopAll(): void {
    for (const id of this.intervals.keys()) {
      this.stopPolling(id);
    }
  }

  // 模块销毁时停止全部账户轮询定时器，避免关闭后继续调用已销毁的 adapter。
  onModuleDestroy(): void {
    this.stopAll();
  }

  getSnapshot(credentialId: string): AccountSnapshot | undefined {
    return this.snapshots.get(credentialId);
  }

  getAllSnapshots(): AccountSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  async fetchOnDemand(
    credentialId: string,
    adapter: ExchangeAdapter,
    symbols: string[],
  ): Promise<AccountSnapshot> {
    const [balance, ...positions] = await Promise.all([
      adapter.getBalance(),
      ...symbols.map((s) => adapter.getPosition(s).catch(() => null)),
    ]);

    return this.buildSnapshot(credentialId, balance, positions);
  }

  private buildSnapshot(
    credentialId: string,
    balance: Balance,
    positions: (Position | null)[],
  ): AccountSnapshot {
    const activePositions = positions
      .filter((p): p is Position => p !== null && Math.abs(p.baseAssetQty) > 1e-12)
      .map((p) => ({
        symbol: p.symbol,
        side: (p.baseAssetQty >= 0 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
        qty: Math.abs(p.baseAssetQty),
        entryPrice: p.entryPrice,
        markPrice: p.entryPrice,
        unrealizedPnl: Number.isFinite(p.unrealizedPnl) ? p.unrealizedPnl! : 0,
        leverage: p.leverage,
      }));

    const { totalEquity, totalWalletBalance, availableUsdt, marginUsed } = deriveEquityFields(balance);

    return {
      credentialId,
      totalEquity,
      totalWalletBalance,
      availableUsdt,
      marginUsed,
      positions: activePositions,
      updatedAt: Date.now(),
    };
  }

  async pollOnce(credentialId: string): Promise<void> {
    const entry = this.adapters.get(credentialId);
    if (!entry) return;

    try {
      const [balance, ...positions] = await Promise.all([
        entry.adapter.getBalance(),
        ...entry.symbols.map((s) => entry.adapter.getPosition(s).catch(() => null)),
      ]);

      const snapshot = this.buildSnapshot(credentialId, balance, positions);
      this.snapshots.set(credentialId, snapshot);

      this.onChanged?.(credentialId);
      await this.persistIfDue(snapshot);
    } catch (err) {
      this.logger.warn(`[${credentialId}] Snapshot poll failed: ${(err as Error).message}`);
    }
  }

  /**
   * 节流落库权益快照（EquitySnapshot 时序表）。先占节流位再写库，失败时释放
   * 节流位让下次轮询重试；落库失败只告警，绝不影响内存快照与广播。
   */
  private async persistIfDue(snapshot: AccountSnapshot): Promise<void> {
    const now = Date.now();
    const last = this.lastPersistedAt.get(snapshot.credentialId) ?? 0;
    if (now - last < AccountSnapshotService.PERSIST_INTERVAL_MS) return;
    this.lastPersistedAt.set(snapshot.credentialId, now);
    try {
      await this.prisma.equitySnapshot.create({
        data: {
          credentialId: snapshot.credentialId,
          totalEquity: snapshot.totalEquity,
          totalWalletBalance: snapshot.totalWalletBalance,
          availableUsdt: snapshot.availableUsdt,
        },
      });
    } catch (err) {
      // compare-and-delete：仅当节流位仍是本次占位才释放，避免误删后续成功写入的占位（评审 M-1）
      if (this.lastPersistedAt.get(snapshot.credentialId) === now) this.lastPersistedAt.delete(snapshot.credentialId);
      this.logger.warn(`[${snapshot.credentialId}] Equity snapshot persist failed: ${(err as Error).message}`);
    }
  }
}

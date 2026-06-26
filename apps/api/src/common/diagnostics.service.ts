// DiagnosticsService — 资源耗尽取证探针（非业务逻辑）
//
// 背景：进程跑数小时后 API 不可达、重启恢复、日志仍在刷（event loop 未死），
// 典型的资源耗尽。fd 泄漏 / DB 连接池耗尽 / event-loop 阻塞 三者表象相同但根治方法不同。
// 本探针每 60s 打一行快照，让"下次挂掉前"的趋势留在日志里，用于定性根因。
//
// 判读：
//   - handles.TLSSocket / Socket 单调上涨 → socket/fd 泄漏（看是谁没关）
//   - fd 接近 limit → fd 耗尽（EMFILE，正是"不可达"）
//   - pgBackends 卡在 ~pgLimit、且 pgIdleTx 持续 >0 → DB 连接池耗尽/连接被长占
//     （pgBackends 已按 current_user 收窄到本应用角色，pgLimit=DATABASE_URL 的 connection_limit）
//   - loopLagMaxMs 飙升（数百 ms+）→ event-loop 被同步阻塞
//
// 注：本进程未启用 enableShutdownHooks，故 onModuleDestroy 在 SIGTERM 下不会触发；
// 但 timer/loopDelay 均 unref，不会阻止进程退出，清理缺失无害。
// 定位到根因后应连同本探针一并移除或降级。

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { monitorEventLoopDelay } from "perf_hooks";
import * as fs from "fs";
import { PrismaService } from "../prisma/prisma.service";

const SAMPLE_INTERVAL_MS = 60_000;

@Injectable()
export class DiagnosticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Diag");
  private timer: NodeJS.Timeout | null = null;
  private loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;
  /** DATABASE_URL 里的 connection_limit，用于日志里直接对照池上限 */
  private readonly pgLimit = this.parsePgLimit();

  constructor(private readonly prisma: PrismaService) {}

  private parsePgLimit(): number {
    const m = /connection_limit=(\d+)/.exec(process.env.DATABASE_URL ?? "");
    return m ? Number(m[1]) : -1;
  }

  onModuleInit(): void {
    this.loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this.loopDelay.enable();
    this.timer = setInterval(() => {
      void this.sample();
    }, SAMPLE_INTERVAL_MS);
    // 避免探针自身阻止进程退出
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.loopDelay?.disable();
    this.loopDelay = null;
  }

  private async sample(): Promise<void> {
    try {
      const mem = process.memoryUsage();
      const rssMb = Math.round(mem.rss / 1048576);
      const extMb = Math.round((mem.external + mem.arrayBuffers) / 1048576);

      const fd = this.fdCount();
      const handles = this.handleHistogram();
      const reqCount = this.activeRequestCount();

      // event-loop 延迟（毫秒），自上次采样累计
      let loopMean = 0;
      let loopMax = 0;
      if (this.loopDelay) {
        loopMean = Math.round(this.loopDelay.mean / 1e6);
        loopMax = Math.round(this.loopDelay.max / 1e6);
        this.loopDelay.reset();
      }

      const pg = await this.pgBackends();

      this.logger.warn(
        `fd=${fd} pgBackends=${pg.total}/${this.pgLimit} pgIdleTx=${pg.idleInTx} ` +
          `loopMeanMs=${loopMean} loopMaxMs=${loopMax} ` +
          `rssMb=${rssMb} extMb=${extMb} activeReq=${reqCount} handles={${handles}}`,
      );
    } catch (err) {
      this.logger.warn(`diagnostics sample failed: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  /** 打开的文件描述符数（Linux）；非 Linux 返回 -1（用 lsof 手动看） */
  private fdCount(): number {
    try {
      return fs.readdirSync("/proc/self/fd").length;
    } catch {
      return -1;
    }
  }

  /** 按构造函数名统计 active handles（socket/timer/server 等），泄漏类型一眼可见 */
  private handleHistogram(): string {
    const getHandles = (
      process as unknown as { _getActiveHandles?: () => unknown[] }
    )._getActiveHandles;
    if (typeof getHandles !== "function") return "n/a";
    const counts: Record<string, number> = {};
    for (const h of getHandles.call(process)) {
      const name = (h as { constructor?: { name?: string } })?.constructor?.name ?? "Unknown";
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}:${n}`)
      .join(",");
  }

  private activeRequestCount(): number {
    const getReqs = (
      process as unknown as { _getActiveRequests?: () => unknown[] }
    )._getActiveRequests;
    if (typeof getReqs !== "function") return -1;
    return getReqs.call(process).length;
  }

  /**
   * 本应用角色（current_user）在当前库的 Postgres 后端连接数。
   * 按 current_user 收窄，避免把同库其他客户端（psql/migration/另一实例）算进来误判池耗尽。
   * total 卡在 pgLimit 附近 = 池打满；idleInTx 持续 >0 = 连接被事务长占（池泄漏铁证）。
   */
  private async pgBackends(): Promise<{ total: number; idleInTx: number }> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ total: number; idle_in_tx: number }>>`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx
        FROM pg_stat_activity
        WHERE datname = current_database() AND usename = current_user
      `;
      return { total: Number(rows?.[0]?.total ?? -1), idleInTx: Number(rows?.[0]?.idle_in_tx ?? -1) };
    } catch {
      return { total: -1, idleInTx: -1 };
    }
  }
}

import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExchangeAdapterFactory } from '../exchange/exchange-adapter.factory';
import { CredentialService } from '../credential/credential.service';
import { GridBotRunner, type BotConfig, type RunnerCriticalEvent } from './runner/grid-bot-runner';
import { NotificationService } from '../notification/notification.service';
import { BotFsm } from './fsm/bot-fsm';
import { StrategyEngine } from './strategy/strategy-engine';
import { ExecutionEngine } from './execution/execution-engine';
import { ExchangeTruthService } from './exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor } from './reconstructor/bot-state-reconstructor';
import { PersistenceService } from './persistence/persistence.service';
import { TradingMetricsService } from './metrics/trading-metrics.service';
import { ExchangeAdapterBridge } from './adapters/exchange-adapter.bridge';
import type { ExchangeAdapter } from './adapters/exchange-adapter.interface';
import { AccountSnapshotService } from './account/account-snapshot.service';
import type { AccountSnapshot, PositionInfo } from './account/account-snapshot.service';
import { RunBalanceSnapshotService } from './account/run-balance-snapshot.service';
import { FillIngestionService } from './fills/fill-ingestion.service';
import { FillReconcileService } from './fills/fill-reconcile.service';
import type { TradingEngineGateway } from './trading-engine.gateway';
import type { BotState, ActiveOrder } from './types/bot-state.types';
import type { AlgoOrder } from './types/exchange.types';
import { parseAlgoClientOrderId, ownsSessionAlgoClientOrderId } from '../exchange/adapters/utils';

/** stopBot 的结构化停止结果：清算是否超时、交易所是否仍有残留仓位。
 *  调用方据此设置告警码（异步分阶段停止流程）。 */
export interface StopOutcome {
  liquidationTimedOut: boolean;
  residualRemains: boolean;
}

/** 终态写入口径（item1：按谁触发统一）。用户操作默认 STOPPED/USER_CLOSE|USER_DETACH，
 * 系统切箱由调用方覆写为 SUPERSEDED/NEW_SESSION，避免同一动作经不同入口落不一致值。 */
export interface TerminalReason {
  state: string;
  exitReason: string;
}

export interface ActiveOrderStatus {
  id: string;
  side: 'buy' | 'sell';
  gridPrice: number;
  price: number;
  qty: number;
  route: 'POC' | 'GTC';
  placedAt: number;
}

export interface AlgoOrderStatus {
  type: 'emergency' | 'other';
  side: 'sell' | 'buy';
  triggerPrice: number;
  qty: number;
  closePosition?: boolean;
  status: 'open' | 'triggered';
  clientOrderId?: string;
}

export interface BotStatus {
  sessionCode: string;
  exchange: string;
  state: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  lastPrice: number | null;
  price?: number | null;
  positionQty?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  activeOrder: boolean;
  activeOrderDetail: ActiveOrderStatus | null;
  algoOrders: AlgoOrderStatus[];
  totalFills: number;
  totalOrdersPlaced: number;
  totalReorders: number;
  entryPrice?: number;
  leverage?: number;
  marginType?: 'CROSS' | 'ISOLATED';
  totalWalletBalance?: number;
}

/**
 * 算法单是否属于该 session(clientOrderId 前缀 = `${sessionCode}_algo_`)。
 * truth.getAlgoOrders 返回账户该合约全部算法单(含历史 session 的孤儿单),
 * getStatus 须按本 session 过滤,避免面板混入其他 session 的兜底止损。
 */
export function ownsSessionAlgo(clientOrderId: string | undefined, sessionCode: string): boolean {
  return ownsSessionAlgoClientOrderId(clientOrderId, sessionCode);
}

/**
 * 重启 run 时是否需重置 Run.state。除已结束的 run 外，「未结束但 PAUSED」的 run
 * （用户点暂停后再点启动，UI 走 startRobot→startBot 而非 resumeBot）也必须重置，
 * 否则 Robot.status=RUNNING 而 Run.state 死锁 PAUSED，前端 FSM 状态源发散（BUG-05）。
 */
export function needsRunStateResetOnStart(run: { endedAt: Date | null; state: string }): boolean {
  return run.endedAt != null || run.state === 'PAUSED';
}

@Injectable()
export class TradingEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TradingEngineService.name);
  private runners = new Map<string, GridBotRunner>();
  private sessionCredentialMap = new Map<string, string>();
  private sessionAdapterMap = new Map<string, ExchangeAdapter>();
  /** 最近回写过的 Run.state（按 runCode）：onStateChange 广播频繁，仅在 FSM 非终态
   * 状态真正变化时才写库，避免逐 tick 命中数据库。 */
  private lastPersistedRunState = new Map<string, string>();
  /** 非终态 FSM 状态 → Run.state 落库口径（FSM 是 Run.state 的真相源）。
   * 终态 LIQUIDATED/TAKE_PROFIT/CANCELLED 由 handleAutoTermination 另行写入。 */
  private static readonly FSM_KIND_TO_RUN_STATE: Record<string, string> = {
    TRAILING_ENTRY: 'TRAILING_ENTRY',
    RUNNING: 'RUNNING',
    PAUSED: 'PAUSED',
    LIQUIDATING: 'LIQUIDATING',
  };

  private reconcileSweepInterval: ReturnType<typeof setInterval> | null = null;
  /** 终态二次对账的延迟句柄：优雅停机时须清理，避免拖住进程/在依赖销毁后触发 */
  private readonly finalReconcileTimers = new Set<ReturnType<typeof setTimeout>>();
  private static readonly RECONCILE_SWEEP_MS = 60_000;
  /** 终态二次对账延迟：须覆盖 close 单 order.create 提交与交易所 REST 成交可见延迟 */
  private static readonly FINAL_RECONCILE_RETRY_DELAY_MS = 5_000;
  /** 账户快照拉取超时（refreshAllSnapshots / captureStopSnapshot 共用） */
  private static readonly SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;

  private gateway: TradingEngineGateway | null = null;
  /** box 终止监听器,由 BotManagerService 注册。runner 层不反向依赖编排层(打破循环依赖)。 */
  private onBoxTerminatedCb: ((robotId: string, configId: string) => void | Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: ExchangeAdapterFactory,
    private readonly credentialService: CredentialService,
    private readonly persistence: PersistenceService,
    private readonly metrics: TradingMetricsService,
    private readonly accountSnapshot: AccountSnapshotService,
    private readonly moduleRef: ModuleRef,
    private readonly fillIngestion: FillIngestionService,
    private readonly fillReconcile: FillReconcileService,
    private readonly notificationService: NotificationService,
    // 可选：Run 启停余额快照。@Optional() 让 Nest DI 不强制解析（既有 DI 测试模块未提供它时
    // 注入 undefined）；既有单测的 new TradingEngineService(...10 参) 也保持 undefined，下方均用 ?. 守卫。
    @Optional() private readonly runBalanceSnapshot?: RunBalanceSnapshotService,
  ) {}

  /** 注册「box 终止」回调(见 RunnerLauncher.setOnBoxTerminated)。单监听器:仅 BotManager 注册一次。 */
  setOnBoxTerminated(cb: (robotId: string, configId: string) => void | Promise<void>): void {
    if (this.onBoxTerminatedCb) {
      this.logger.warn('setOnBoxTerminated 被重复调用,旧监听器将被覆盖');
    }
    this.onBoxTerminatedCb = cb;
  }

  async onModuleInit(): Promise<void> {
    const { TradingEngineGateway } = await import('./trading-engine.gateway');
    this.gateway = this.moduleRef.get(TradingEngineGateway, { strict: false });
    this.accountSnapshot.setOnChanged((credentialId: string) => {
      this.gateway?.broadcastAccountSnapshot(credentialId);
    });
    // 恢复职责已移交 BotManagerService.onApplicationBootstrap（按 robot 恢复 RUNNING 机器人）。
  }

  async startBot(configId: string, runCode: string, initialState?: 'TRAILING_ENTRY' | 'RUNNING'): Promise<GridBotRunner> {
    const existingRunner = this.runners.get(runCode);
    if (existingRunner) {
      // pause 保留 runner（仅向 FSM 提交 USER_PAUSE，不从 runners 移除）。因此 UI「启动」
      // 走 startRobot→startBot 命中此分支：若 run=PAUSED，恢复 = USER_RESUME + 复位 Run.state，
      // 而非抛 Conflict（旧逻辑抛错，Run.state 死锁 PAUSED，前端 FSM 状态源发散，BUG-05）。
      const pausedRun = await this.prisma.run.findUnique({ where: { runCode } });
      if (pausedRun && pausedRun.state === 'PAUSED') {
        existingRunner.submitUserAction('USER_RESUME');
        await this.prisma.run.update({ where: { id: pausedRun.id }, data: { state: 'RUNNING' } });
        return existingRunner;
      }
      throw new ConflictException(`Bot ${runCode} is already running`);
    }

    const configRecord = await this.prisma.box.findUnique({
      where: { id: configId },
    });
    if (!configRecord) {
      throw new NotFoundException(`Config ${configId} not found`);
    }

    const credential = await this.credentialService.findOneWithSecrets(configRecord.accountId);
    if (!credential) {
      throw new NotFoundException('Credential not found');
    }
    if (!credential.isActive) {
      throw new ConflictException('Credential is not active');
    }

    const legacyAdapter = this.adapterFactory.createAdapter({
      exchangeId: credential.exchangeId,
      accountId: credential.accountId,
      apiKey: credential.apiKey,
      apiSecret: credential.apiSecret,
      passphrase: credential.passphrase ?? undefined,
    });
    const adapter = new ExchangeAdapterBridge(legacyAdapter);

    // Create or reuse run
    let run = await this.prisma.run.findUnique({
      where: { runCode },
    });

    if (!run) {
      // BUG-04: 新 run 的 pnl 状态机必须从交易所真实持仓起算。上一 run 未平干净
      // 的持仓会被本 run 接管交易（策略读交易所持仓），但 DB 从 0 起算会让
      // pnlSignedPosition/已实现盈亏从第一秒起永久偏离（三所实测全部命中）。
      let seededPositionQty = 0;
      let seededAvgCost = 0;
      try {
        const inheritedPosition = await adapter.getPosition(configRecord.symbol);
        if (inheritedPosition && Math.abs(inheritedPosition.baseAssetQty) > 1e-12) {
          seededPositionQty = inheritedPosition.baseAssetQty;
          seededAvgCost = inheritedPosition.entryPrice;
          this.logger.log(
            `[${runCode}] Inherited exchange position seeded into pnl state: qty=${seededPositionQty} avgCost=${seededAvgCost}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[${runCode}] Failed to fetch exchange position for pnl seed, starting from 0: ${(err as Error).message}`,
        );
      }
      run = await this.prisma.run.create({
        data: {
          boxId: configId,
          runCode,
          state: initialState ?? (configRecord.trailingEntry ? 'TRAILING_ENTRY' : 'RUNNING'),
          configSnapshot: configRecord as unknown as Prisma.InputJsonValue,
          pnlSignedPosition: seededPositionQty,
          pnlAvgCost: seededAvgCost,
        },
      });
      // 仅新建 Run（= 新 Session 开始）记 START 余额快照；恢复/复位分支不记。
      // fire-and-forget + best-effort：不阻塞、不影响启动。
      void this.runBalanceSnapshot?.capture({
        runId: run.id,
        event: 'START',
        adapter,
        symbol: configRecord.symbol,
        credentialId: configRecord.accountId,
        boxId: configId,
        robotId: configRecord.robotId,
        ledger: { realizedPnl: run.realizedPnl, totalFees: run.totalFees, totalSavings: run.totalSavings },
      });
    } else if (needsRunStateResetOnStart(run)) {
      // 重启已结束的 run，或复位「未结束但 PAUSED」的 run（暂停后再启动走此路，
      // 而非 resumeBot，旧逻辑只认 endedAt → Run.state 死锁 PAUSED，BUG-05）。
      run = await this.prisma.run.update({
        where: { id: run.id },
        data: {
          state: initialState ?? (configRecord.trailingEntry ? 'TRAILING_ENTRY' : 'RUNNING'),
          endedAt: null,
          exitReason: null,
        },
      });
    }

    const config = this.buildBotConfig(configRecord, runCode);

    await this.evictRunnersOnSymbol(config.symbol, configRecord.accountId, runCode);

    // 用 DB 已实现盈亏预热缓存：冷启动/重启后首笔新成交到达前，详情页即正确显示历史已实现盈亏。
    this.fillIngestion.seedRealizedPnl(runCode, run.realizedPnl);

    return this.startRunner(config, adapter, run.id, configRecord.accountId);
  }

  /**
   * Run 结束时记 STOP 余额快照。自包含查 run+box 取 ledger/credentialId/robotId；
   * best-effort——查不到或失败不抛，不影响停止流程。adapter/symbol 须在会话拆除前取得后传入。
   */
  private async captureRunStopBalance(
    runId: string,
    adapter: ExchangeAdapter | undefined,
    symbol: string | undefined,
    exitReason?: string,
    liquidationOk?: boolean,
  ): Promise<void> {
    if (!this.runBalanceSnapshot || !adapter || !symbol) return;
    try {
      const run = await this.prisma.run.findUnique({
        where: { id: runId },
        select: {
          id: true, boxId: true, realizedPnl: true, totalFees: true, totalSavings: true,
          box: { select: { robotId: true, accountId: true } },
        },
      });
      if (!run) return;
      await this.runBalanceSnapshot.capture({
        runId: run.id,
        event: 'STOP',
        adapter,
        symbol,
        credentialId: run.box?.accountId ?? '',
        boxId: run.boxId,
        robotId: run.box?.robotId,
        ledger: { realizedPnl: run.realizedPnl, totalFees: run.totalFees, totalSavings: run.totalSavings },
        exitReason,
        liquidationOk,
      });
    } catch (err) {
      this.logger.warn(`[${runId}] captureRunStopBalance failed: ${(err as Error).message}`);
    }
  }

  /** 读取某 Run 的启停余额快照（START/STOP）。未启用快照服务时返回空数组。 */
  async getRunBalanceSnapshots(runId: string) {
    return (await this.runBalanceSnapshot?.getByRunId(runId)) ?? [];
  }

  async stopBot(runCode: string, terminal: TerminalReason = { state: 'STOPPED', exitReason: 'USER_CLOSE' }): Promise<StopOutcome> {
    const runner = this.runners.get(runCode);
    if (!runner) {
      throw new NotFoundException(`Bot ${runCode} is not running`);
    }

    // finally 块会清掉 sessionAdapterMap，复核兜底所需引用必须先取
    const verifyAdapter = this.sessionAdapterMap.get(runCode);
    const verifySymbol = runner.symbol;

    // 等待清算真正完成（撤单+市价平仓），固定延时会与 runner 主循环竞态：
    // 事件在 tick 进行中提交、或平仓 REST 超过延时，position 都会裸留交易所。
    const LIQUIDATION_TIMEOUT_MS = 30_000;
    let liquidationTimer: NodeJS.Timeout | undefined;
    const liquidationTimedOut = await Promise.race([
      runner.requestLiquidation().then(() => false),
      new Promise<boolean>((resolve) => {
        liquidationTimer = setTimeout(() => resolve(true), LIQUIDATION_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(liquidationTimer);
    if (liquidationTimedOut) {
      this.logger.error(
        `[${runCode}] Liquidation did not complete within ${LIQUIDATION_TIMEOUT_MS}ms, forcing runner stop (position may remain open)`,
      );
    }

    try {
      await runner.stop();
    } finally {
      this.runners.delete(runCode);
      this.fillIngestion.clearRealizedPnl(runCode);
      const credentialId = this.sessionCredentialMap.get(runCode);
      this.sessionCredentialMap.delete(runCode);
      this.sessionAdapterMap.delete(runCode);
      if (credentialId) this.reconcileAccountPolling(credentialId);
      this.stopReconcileSweepIfNoRunners();
    }
    this.logger.log(`[${runCode}] Bot stopped`);

    // 交易所侧复核兜底：runner 已死（running=false）时 requestLiquidation 静默
    // 跳过平仓（BUG-C，2026-06-12 OKX 实测裸留 3.877 ETH 空头）。平仓以交易所
    // 实时仓位为准，而非 runner 内存状态（规格 §6.2 状态无关自愈）。
    const residualRemains =
      verifyAdapter && verifySymbol
        ? await this.forceCloseResidualAfterStop(runCode, verifyAdapter, verifySymbol)
        : false;

    // Update run state
    const run = await this.prisma.run.findUnique({
      where: { runCode },
    });
    if (run) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: {
          state: terminal.state,
          endedAt: new Date(),
          exitReason: terminal.exitReason,
        },
      });
      // STOP 快照：清算后，liquidationOk = 未超时且无残留。
      void this.captureRunStopBalance(
        run.id, verifyAdapter, verifySymbol, terminal.exitReason,
        !liquidationTimedOut && !residualRemains,
      );
    }

    return { liquidationTimedOut, residualRemains };
  }

  /** 分离箱体：撤销机器人自己的挂单（runner.stop 内置）并停 Runner，但不平仓——
   * 持仓留待后续箱体接管（§4.3 自愈）。用于删活跃箱且 closePosition=false。 */
  async detachBot(runCode: string, terminal: TerminalReason = { state: 'STOPPED', exitReason: 'USER_DETACH' }): Promise<{ cancelFailed: string[] }> {
    const runner = this.runners.get(runCode);
    if (!runner) {
      throw new NotFoundException(`Bot ${runCode} is not running`);
    }
    // finally 会清掉 sessionAdapterMap，STOP 快照所需引用先取（detach 不平仓，持仓保留）
    const detachAdapter = this.sessionAdapterMap.get(runCode);
    const detachSymbol = runner.symbol;
    let result: { cancelFailed: string[] } = { cancelFailed: [] };
    try {
      result = await runner.stop();
    } finally {
      this.runners.delete(runCode);
      this.fillIngestion.clearRealizedPnl(runCode);
      const credentialId = this.sessionCredentialMap.get(runCode);
      this.sessionCredentialMap.delete(runCode);
      this.sessionAdapterMap.delete(runCode);
      if (credentialId) this.reconcileAccountPolling(credentialId);
      this.stopReconcileSweepIfNoRunners();
    }
    this.logger.log(`[${runCode}] Bot detached (orders cancelled, position kept)`);

    const run = await this.prisma.run.findUnique({ where: { runCode } });
    if (run) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: { state: terminal.state, endedAt: new Date(), exitReason: terminal.exitReason },
      });
      // detach 不平仓：liquidationOk 留空（undefined），由 positionQty 如实反映剩余持仓。
      void this.captureRunStopBalance(run.id, detachAdapter, detachSymbol, terminal.exitReason);
    }
    return result;
  }

  async pauseBot(runCode: string): Promise<void> {
    const runner = this.runners.get(runCode);
    if (!runner) {
      throw new NotFoundException(`Bot ${runCode} is not running`);
    }

    runner.submitUserAction('USER_PAUSE');

    const run = await this.prisma.run.findUnique({
      where: { runCode },
    });
    if (run) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: { state: 'PAUSED' },
      });
    }
  }

  async resumeBot(runCode: string): Promise<void> {
    const runner = this.runners.get(runCode);
    if (!runner) {
      throw new NotFoundException(`Bot ${runCode} is not running`);
    }

    runner.submitUserAction('USER_RESUME');

    const run = await this.prisma.run.findUnique({
      where: { runCode },
    });
    if (run) {
      await this.prisma.run.update({
        where: { id: run.id },
        data: { state: 'RUNNING' },
      });
    }
  }

  async liquidateBot(runCode: string): Promise<void> {
    const runner = this.runners.get(runCode);
    if (!runner) {
      throw new NotFoundException(`Bot ${runCode} is not running`);
    }

    runner.submitUserAction('USER_LIQUIDATE');
  }

  /**
   * 把 runner FSM 的非终态状态回写 Run.state，使账本始终跟随执行真相。
   * 取代 resume/pause/start 各处命令式"猜状态"（如空仓 resume 实际转 TRAILING_ENTRY
   * 却被硬写 RUNNING）。内存去重：仅在状态真正变化时写库，避免逐 tick 命中数据库。
   */
  private async syncRunStateFromFsm(runCode: string, fsmKind: string): Promise<void> {
    const runState = TradingEngineService.FSM_KIND_TO_RUN_STATE[fsmKind];
    if (!runState) return;
    if (this.lastPersistedRunState.get(runCode) === runState) return;

    try {
      const run = await this.prisma.run.findUnique({ where: { runCode } });
      // 已结束的 run 不可变（终态由 handleAutoTermination 负责）；不存在则跳过
      if (!run || run.endedAt) return;
      if (run.state !== runState) {
        await this.prisma.run.update({ where: { id: run.id }, data: { state: runState } });
        this.gateway?.broadcastSessionUpdate(runCode);
      }
      this.lastPersistedRunState.set(runCode, runState);
    } catch (err) {
      this.logger.warn(`[${runCode}] syncRunStateFromFsm failed: ${(err as Error).message}`);
    }
  }

  private async handleAutoTermination(runCode: string, fsmKind: string): Promise<void> {
    // Clean up in-memory state if the runner is still tracked.
    // onStateChange can fire multiple times for the same terminal state;
    // the DB endedAt check below provides idempotency for the persistence step.
    const runner = this.runners.get(runCode);
    if (this.runners.has(runCode)) {
      this.runners.delete(runCode);
    }

    const credentialId = this.sessionCredentialMap.get(runCode);
    const adapter = this.sessionAdapterMap.get(runCode);
    this.sessionCredentialMap.delete(runCode);
    this.sessionAdapterMap.delete(runCode);
    this.lastPersistedRunState.delete(runCode);
    if (credentialId) this.reconcileAccountPolling(credentialId);
    this.stopReconcileSweepIfNoRunners();

    // 终态后该 run 退出周期 sweep，closePosition 的成交若 WS 没收到就再无机会
    // 入库（清算盈亏丢失）。趁 adapter 还在，补一次最终对账。
    // runner/adapter 已被首次调用清掉时跳过（幂等重入）。
    if (runner && adapter) {
      try {
        await this.fillReconcile.reconcileRun(runCode, runner.symbol, adapter);
      } catch (err) {
        this.logger.warn(`[${runCode}] final reconcile on termination failed: ${(err as Error).message}`);
      }
      // 周期 sweep 靠"下次必重拉"闭合 order-before-fill 窗口，终态 run 没有
      // 下次：首发对账可能跑在 close 单 order.create（fire-and-forget）提交前
      // 或成交在交易所 REST 端可见前。延迟几秒重拉一次关闭该窗口（幂等摄入）。
      const symbol = runner.symbol;
      const timer = setTimeout(() => {
        this.finalReconcileTimers.delete(timer);
        void this.fillReconcile
          .reconcileRun(runCode, symbol, adapter)
          .catch((e) => this.logger.warn(`[${runCode}] delayed final reconcile failed: ${(e as Error).message}`));
      }, TradingEngineService.FINAL_RECONCILE_RETRY_DELAY_MS);
      this.finalReconcileTimers.add(timer);
    }

    const dbStateMap: Record<string, string> = {
      LIQUIDATED: 'LIQUIDATED',
      TAKE_PROFIT: 'TAKE_PROFIT',
      // CANCELLED=追踪窗口关闭、从未建仓，是独立终态，不能并入 LIQUIDATED/止损，
      // 否则统计会把"空轮取消"误记为"真实止损"。
      CANCELLED: 'CANCELLED',
    };
    const exitReasonMap: Record<string, string> = {
      LIQUIDATED: 'STOP_LOSS',
      TAKE_PROFIT: 'TAKE_PROFIT',
      CANCELLED: 'TRAILING_CANCELLED',
    };

    const dbState = dbStateMap[fsmKind] ?? 'LIQUIDATED';
    const exitReason = exitReasonMap[fsmKind] ?? 'STOP_LOSS';

    let run: { id: string; boxId: string | null; endedAt: Date | null; exitReason: string | null } | null = null;
    let alreadyEnded = false;
    try {
      run = await this.prisma.run.findUnique({ where: { runCode } });
      alreadyEnded = !!run?.endedAt;
      if (run && !run.endedAt) {
        await this.prisma.run.update({
          where: { id: run.id },
          data: { state: dbState, endedAt: new Date(), exitReason },
        });
        // STOP 快照：自动终态（止盈/清算/取消）后，趁 adapter 未拆除记一次（幂等块内仅一次）。
        void this.captureRunStopBalance(run.id, adapter, runner?.symbol, exitReason);
      }
    } catch (err) {
      this.logger.error(`[${runCode}] Failed to persist auto-termination state: ${(err as Error).message}`);
    }

    this.logger.log(`[${runCode}] Auto-terminated with FSM state ${fsmKind} → DB state ${dbState}`);

    if (!alreadyEnded && this.onBoxTerminatedCb && run?.boxId) {
      try {
        const box = await this.prisma.box.findUnique({ where: { id: run.boxId } });
        if (box?.robotId) {
          await this.onBoxTerminatedCb(box.robotId, run.boxId);
        }
      } catch (err) {
        this.logger.error(`[${runCode}] Failed to notify box-terminated listener: ${(err as Error).message}`);
      }
    }
  }

  getStatus(runCode: string): BotStatus | undefined {
    const runner = this.runners.get(runCode);
    if (!runner) return undefined;

    const state = runner.getState();
    if (!state) return undefined;

    const rawActiveOrder = runner.getActiveOrder();
    const rawAlgoOrders = runner.getAlgoOrders();

    return {
      sessionCode: runCode,
      exchange: this.sessionAdapterMap.get(runCode)?.exchange ?? 'UNKNOWN',
      state: state.fsm.kind,
      symbol: runner.symbol,
      direction: state.config.direction as 'LONG' | 'SHORT',
      lastPrice: state.lastPrice,
      price: state.lastPrice,
      positionQty: state.position?.baseAssetQty ?? 0,
      // 已实现盈亏取自 DB 权威缓存（FillIngestionService 在每笔成交事务后刷新），
      // 而非 runner 内存 stats.realizedPnl（从不累加，恒 0 → 详情页显示 $0，BUG-01）。
      realizedPnl: this.fillIngestion.getCachedRealizedPnl(runCode) ?? state.stats.realizedPnl,
      unrealizedPnl: state.position?.unrealizedPnl ?? 0,
      activeOrder: rawActiveOrder !== null,
      activeOrderDetail: rawActiveOrder ? {
        id: rawActiveOrder.orderId,
        side: rawActiveOrder.side.toLowerCase() as 'buy' | 'sell',
        gridPrice: rawActiveOrder.gridPrice ?? rawActiveOrder.price,
        price: rawActiveOrder.price,
        qty: rawActiveOrder.qty,
        route: rawActiveOrder.tif,
        placedAt: rawActiveOrder.placedAt,
      } : null,
      algoOrders: rawAlgoOrders.filter((ao) => ownsSessionAlgo(ao.clientOrderId, runCode)).map((ao) => ({
        type: (ao.clientOrderId?.includes('emergency') || parseAlgoClientOrderId(ao.clientOrderId)?.kind === 'emergency')
          ? 'emergency' as const : 'other' as const,
        side: ao.side.toLowerCase() as 'sell' | 'buy',
        triggerPrice: ao.triggerPrice,
        qty: ao.qty,
        closePosition: ao.closePosition ?? false,
        status: ao.status === 'TRIGGERED' ? 'triggered' as const : 'open' as const,
        clientOrderId: ao.clientOrderId,
      })),
      totalFills: state.stats.totalFills,
      totalOrdersPlaced: state.stats.totalOrdersPlaced,
      totalReorders: state.stats.totalReorders,
      entryPrice: state.position?.entryPrice,
      leverage: state.position?.leverage,
      marginType: state.position?.marginType,
      totalWalletBalance: this.getWalletBalanceForSession(runCode),
    };
  }

  getAllStatuses(): BotStatus[] {
    return Array.from(this.runners.keys())
      .map((code) => this.getStatus(code))
      .filter((s): s is BotStatus => s !== undefined);
  }

  private getWalletBalanceForSession(runCode: string): number | undefined {
    const credentialId = this.sessionCredentialMap.get(runCode);
    if (!credentialId) return undefined;
    const snap = this.accountSnapshot.getSnapshot(credentialId);
    return snap?.totalWalletBalance;
  }

  getAccountSnapshot(credentialId: string): AccountSnapshot | undefined {
    return this.accountSnapshot.getSnapshot(credentialId);
  }

  getAllAccountSnapshots(): AccountSnapshot[] {
    return this.accountSnapshot.getAllSnapshots();
  }

  async refreshAllSnapshots(): Promise<AccountSnapshot[]> {
    const inMemory = this.accountSnapshot.getAllSnapshots();
    const coveredIds = new Set(inMemory.map((s) => s.credentialId));

    const credentials = await this.prisma.exchangeAccount.findMany({
      where: { isActive: true },
    });

    const uncovered = credentials.filter((c) => !coveredIds.has(c.id));

    // 停止态账户也必须按其机器人 symbol 拉取交易所实时持仓——传空数组会把
    // 交易所残留仓位显示成空仓，掩盖"停止未平仓"类故障（BUG-A，2026-06-12 实测）。
    const robots = uncovered.length
      ? await this.prisma.robot.findMany({
          where: { accountId: { in: uncovered.map((c) => c.id) } },
          select: { accountId: true, symbol: true },
        })
      : [];
    const symbolsByAccount = new Map<string, Set<string>>();
    for (const r of robots) {
      if (!symbolsByAccount.has(r.accountId)) symbolsByAccount.set(r.accountId, new Set());
      symbolsByAccount.get(r.accountId)!.add(r.symbol);
    }

    const onDemandResults = await Promise.allSettled(
      uncovered.map(async (cred) => {
        const fullCred = await this.credentialService.findOneWithSecrets(cred.id);
        if (!fullCred) throw new Error(`Credential ${cred.id} not found`);

        const legacyAdapter = this.adapterFactory.createAdapter({
          exchangeId: fullCred.exchangeId,
          accountId: fullCred.accountId,
          apiKey: fullCred.apiKey,
          apiSecret: fullCred.apiSecret,
          passphrase: fullCred.passphrase ?? undefined,
        });
        const adapter = new ExchangeAdapterBridge(legacyAdapter);

        const timeoutMs = TradingEngineService.SNAPSHOT_FETCH_TIMEOUT_MS;
        return Promise.race([
          this.accountSnapshot.fetchOnDemand(cred.id, adapter, [...(symbolsByAccount.get(cred.id) ?? [])]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Snapshot fetch timed out after ${timeoutMs}ms`)), timeoutMs),
          ),
        ]);
      }),
    );

    const onDemand: AccountSnapshot[] = [];
    for (const result of onDemandResults) {
      if (result.status === 'fulfilled') {
        onDemand.push(result.value);
      } else {
        this.logger.warn(`Failed to fetch on-demand snapshot: ${result.reason?.message}`);
      }
    }

    return [...inMemory, ...onDemand];
  }

  /** 停止收尾用：一次性 REST 拉取该账户快照，返回指定 symbol 的持仓（无则 null）。
   *  不依赖 accountSnapshot 轮询器（停止后该账户可能已 stopPolling）。失败抛出，由调用方记 SNAPSHOT_UNAVAILABLE。 */
  async captureStopSnapshot(credentialId: string, symbol: string): Promise<PositionInfo | null> {
    const fullCred = await this.credentialService.findOneWithSecrets(credentialId);
    if (!fullCred) throw new Error(`Credential ${credentialId} not found`);
    const legacyAdapter = this.adapterFactory.createAdapter({
      exchangeId: fullCred.exchangeId,
      accountId: fullCred.accountId,
      apiKey: fullCred.apiKey,
      apiSecret: fullCred.apiSecret,
      passphrase: fullCred.passphrase ?? undefined,
    });
    const adapter = new ExchangeAdapterBridge(legacyAdapter);
    const timeoutMs = TradingEngineService.SNAPSHOT_FETCH_TIMEOUT_MS;
    const snapshot = await Promise.race([
      this.accountSnapshot.fetchOnDemand(credentialId, adapter, [symbol]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`captureStopSnapshot timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return snapshot.positions.find((p) => p.symbol === symbol) ?? null;
  }

  /** 校验 symbol 在该账户交易所可交易；不可交易抛 SYMBOL_NOT_TRADABLE，网络等不确定错误放行。 */
  async assertSymbolTradable(credentialId: string, symbol: string): Promise<void> {
    const credential = await this.credentialService.findOneWithSecrets(credentialId);
    if (!credential) throw new NotFoundException('Credential not found');
    const adapter = this.adapterFactory.createAdapter({
      exchangeId: credential.exchangeId,
      accountId: credential.accountId,
      apiKey: credential.apiKey,
      apiSecret: credential.apiSecret,
      passphrase: credential.passphrase ?? undefined,
    });
    try {
      await adapter.getMarketInfo(symbol);
    } catch (err) {
      const ex = err as { code?: string; message?: string };
      const notFound =
        ex.code === 'SYMBOL_NOT_FOUND' ||
        ex.code === 'INSTRUMENT_NOT_FOUND' ||
        /not found/i.test(ex.message ?? '');
      if (notFound) {
        throw new BadRequestException({
          code: 'SYMBOL_NOT_TRADABLE',
          message: `Symbol ${symbol} is not tradable on ${credential.exchangeId}`,
        });
      }
      // 网络/鉴权等不确定错误：放行 + 日志（避免临时故障挡创建；运行期仍有兜底）。
      this.logger.warn(
        `assertSymbolTradable(${credential.exchangeId}, ${symbol}) inconclusive: ${ex.message ?? String(err)}`,
      );
    }
  }

  private async evictRunnersOnSymbol(
    symbol: string,
    credentialId: string,
    excludeRunCode: string,
  ): Promise<void> {
    for (const [code, runner] of this.runners) {
      if (code === excludeRunCode) continue;
      // 仅驱逐「同账户 + 同 symbol」的僵尸 runner：不同 credential 的 runner 绑定
      // 各自的密钥，跨账户驱逐会 stop() 并撤掉别人正常箱体的真实挂单。
      if (runner.symbol === symbol && this.sessionCredentialMap.get(code) === credentialId) {
        this.logger.warn(`[${excludeRunCode}] Evicting stale runner ${code} on same symbol ${symbol}`);
        try {
          await runner.stop();
        } catch {
          // runner 可能已停止
        }
        this.runners.delete(code);
        this.sessionCredentialMap.delete(code);
        this.sessionAdapterMap.delete(code);
        this.stopReconcileSweepIfNoRunners();
        this.reconcileAccountPolling(credentialId);
      }
    }
  }

  getRunner(runCode: string): GridBotRunner | undefined {
    return this.runners.get(runCode);
  }

  /**
   * 声明式对账：账户轮询状态 = 该账户当前活跃 runner 的 symbol 并集。
   * 非空 → ensurePolling 覆盖这些 symbol（adapter 取任一存活 runner 的）；
   * 为空 → stopPolling。源自 runners+sessionCredentialMap 真相，不做增减计数。
   * 调用方须在「已把要移除的 session 从两张 map 删除后」再调本方法。
   * 不变量：sessionAdapterMap 与 runners 同步增删（仅在 startRunner 一处一起 set、
   * 各移除点一起 delete），故遍历到的存活 runner 必有 adapter，anyAdapter 不会为 undefined。
   * 每个 session 持有独立 adapter 实例（startBot 每次 new 一个 bridge）；reconcile 每次都
   * 改用某存活 runner 的 adapter——stop 会 destroy 退出 session 的 adapter，但它已先从 map
   * 删除，故 poller 永不持有已 destroy 的 adapter。
   */
  private reconcileAccountPolling(credentialId: string): void {
    const symbols = new Set<string>();
    let anyAdapter: ExchangeAdapter | undefined;
    for (const [code, runner] of this.runners) {
      if (this.sessionCredentialMap.get(code) !== credentialId) continue;
      symbols.add(runner.symbol);
      anyAdapter = anyAdapter ?? this.sessionAdapterMap.get(code);
    }
    if (symbols.size === 0) {
      this.accountSnapshot.stopPolling(credentialId);
    } else {
      this.accountSnapshot.ensurePolling(credentialId, [...symbols], anyAdapter);
    }
  }

  /** stopBot 兜底强平超时（与清算路径同口径）。REST 挂死时避免拖死同步的 stopBot。 */
  private static readonly FORCE_CLOSE_TIMEOUT_MS = 30_000;

  /** Promise 加超时：超时 reject，避免单个 REST 挂死阻塞调用方。 */
  private async withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** stopBot 收尾：以交易所实时仓位复核，残留即强平（BUG-C）。
   *  - getPosition 失败（瞬断常见）：warn，无法核查不强行告警。
   *  - 确认有残留却强平失败/挂死：资金风险裸仓，error + alert 通知，运维必须可见，
   *    否则等价于修复前的静默裸仓。整个流程加超时，避免 REST 挂死拖死同步 stopBot。 */
  private async forceCloseResidualAfterStop(runCode: string, adapter: ExchangeAdapter, symbol: string): Promise<boolean> {
    const timeout = TradingEngineService.FORCE_CLOSE_TIMEOUT_MS;
    let pos: Awaited<ReturnType<ExchangeAdapter['getPosition']>>;
    try {
      pos = await this.withTimeout(adapter.getPosition(symbol), timeout, 'post-stop getPosition');
    } catch (err) {
      this.logger.warn(`[${runCode}] Post-stop position check failed: ${(err as Error).message}`);
      return false;
    }
    if (!pos || Math.abs(pos.baseAssetQty) <= 1e-12) return false;

    const side = pos.baseAssetQty > 0 ? 'LONG' : 'SHORT';
    this.logger.error(
      `[${runCode}] Exchange still holds ${pos.baseAssetQty} ${symbol} after liquidation — force closing`,
    );
    try {
      await this.withTimeout(adapter.closePosition(symbol, side), timeout, 'post-stop closePosition');
    } catch (err) {
      this.logger.error(
        `[${runCode}] Post-stop force-close FAILED, position may remain on exchange: ${(err as Error).message}`,
      );
      await this.notifyResidualPositionRisk(runCode, symbol, pos.baseAssetQty, (err as Error).message);
      return true;
    }
    return false;
  }

  /** 停止后仍可能裸留持仓 → alert 通知，提示用户手动核查。通知失败只记日志不冒泡。 */
  private async notifyResidualPositionRisk(
    runCode: string,
    symbol: string,
    qty: number,
    reason: string,
  ): Promise<void> {
    try {
      await this.notificationService.createAndBroadcast({
        type: 'alert',
        title: 'Bot stopped but exchange position may remain — manual check required',
        body: `${symbol} ${runCode}: force-close failed (qty=${qty}), ${reason}`,
        code: 'STOP_RESIDUAL_POSITION',
        params: { symbol, runCode, qty: String(qty), reason },
      });
    } catch (err) {
      this.logger.error(`[${runCode}] residual-position alert failed: ${(err as Error).message}`);
    }
  }

  /** 已上报的关键事件（runCode:kind:reason）。内存去重：重启后重发可接受（设计 spec §五）。 */
  private readonly reportedCriticalEvents = new Set<string>();

  /** Runner 关键事件 → 系统通知。永不抛错（在 runner 回调链上）。 */
  private async reportCriticalEvent(runCode: string, symbol: string, event: RunnerCriticalEvent): Promise<void> {
    const key = `${runCode}:${event.kind}:${event.reason}`;
    if (this.reportedCriticalEvents.has(key)) return;
    this.reportedCriticalEvents.add(key);

    const meta: Record<RunnerCriticalEvent['kind'], { type: 'alert' | 'warn'; title: string; code: string }> = {
      ORDER_REJECTED: { type: 'warn', title: 'Order rejected', code: 'RUNNER_ORDER_REJECTED' },
      STOPPED_REJECTIONS: { type: 'alert', title: 'Orders rejected repeatedly, grid cannot operate', code: 'RUNNER_STOPPED_REJECTIONS' },
      PAUSED_PERMANENT_ERROR: { type: 'alert', title: 'Bot paused: permanent configuration error', code: 'RUNNER_PAUSED_PERMANENT_ERROR' },
      RESIDUAL_POSITION: { type: 'alert', title: 'Liquidation incomplete: residual position remains', code: 'RUNNER_RESIDUAL_POSITION' },
    };
    const { type, title, code } = meta[event.kind];
    try {
      await this.notificationService.createAndBroadcast({
        type,
        title,
        body: `${symbol} ${runCode}: ${event.message}`,
        code,
        params: { symbol, runCode, reason: event.reason },
      });
    } catch (err) {
      this.logger.error(`[${runCode}] reportCriticalEvent failed: ${(err as Error).message}`);
      this.reportedCriticalEvents.delete(key);
    }
  }

  private async startRunner(
    config: BotConfig,
    adapter: ExchangeAdapterBridge,
    runId: string,
    credentialId: string,
  ): Promise<GridBotRunner> {
    const fsm = new BotFsm();
    const strategy = new StrategyEngine();
    const execution = new ExecutionEngine(adapter);
    const truth = new ExchangeTruthService(adapter);
    const reconstructor = new BotStateReconstructor();

    const runner = new GridBotRunner(config, adapter, {
      fsm,
      strategy,
      execution,
      truth,
      reconstructor,
      persistence: this.persistence,
      onStateChange: (state: BotState) => {
        this.gateway?.broadcastSessionUpdate(config.runCode);
        const terminalKinds = ['LIQUIDATED', 'TAKE_PROFIT', 'CANCELLED'];
        if (terminalKinds.includes(state.fsm.kind)) {
          void this.handleAutoTermination(config.runCode, state.fsm.kind);
        } else {
          void this.syncRunStateFromFsm(config.runCode, state.fsm.kind);
        }
      },
      onFill: (fill) => {
        this.gateway?.broadcastFill(config.runCode, fill);
      },
      onOrderPlaced: (o) => {
        void this.prisma.order.create({
          data: {
            runId,
            // 平仓单无自定义 id（交易所回报空/平台默认值），存 null：
            // 归属只靠 exchangeOrderId，且不与 (runId, clientOrderId) 唯一约束冲突
            clientOrderId: o.clientOrderId || null,
            exchangeOrderId: o.exchangeOrderId,
            orderType: o.orderType,
            side: o.side,
            qty: o.qty,
            price: o.price,
            gridIndex: o.gridIndex >= 0 ? o.gridIndex : null,
            isAlgo: o.isAlgo,
            preOrderPosition: o.preOrderPosition,
            isEntry: o.isEntry,
            status: 'PENDING',
          },
        }).catch((e) => this.logger.error(`[${config.runCode}] order persist failed: ${(e as Error).message}`));
      },
      onFillEvent: (event) => {
        void this.fillIngestion
          .ingest(config.runCode, event)
          .then(() => this.gateway?.broadcastSessionUpdate(config.runCode))
          .catch((e) => this.logger.error(`[${config.runCode}] fill ingest failed: ${(e as Error).message}`));
      },
      onCriticalEvent: (event: RunnerCriticalEvent) => {
        void this.reportCriticalEvent(config.runCode, config.symbol, event);
      },
    });

    this.runners.set(config.runCode, runner);
    this.sessionCredentialMap.set(config.runCode, credentialId);
    this.sessionAdapterMap.set(config.runCode, adapter);
    this.reconcileAccountPolling(credentialId);
    try {
      await runner.start();
    } catch (err) {
      this.runners.delete(config.runCode);
      this.sessionCredentialMap.delete(config.runCode);
      this.sessionAdapterMap.delete(config.runCode);
      this.reconcileAccountPolling(credentialId);
      this.stopReconcileSweepIfNoRunners();
      // 启动失败的 run 必须立刻收尾，否则残留 RUNNING 行（激活重试会逐秒堆积）
      await this.prisma.run.update({
        where: { id: runId },
        data: { endedAt: new Date(), state: 'STOPPED', exitReason: 'START_FAILED' },
      }).catch((e) => this.logger.error(`[${config.runCode}] mark run START_FAILED failed: ${(e as Error).message}`));
      throw err;
    }

    void this.fillReconcile
      .reconcileRun(config.runCode, config.symbol, adapter)
      .catch((e) => this.logger.warn(`[${config.runCode}] cold-start reconcile failed: ${(e as Error).message}`));
    this.startReconcileSweepIfNeeded();

    this.logger.log(`[${config.runCode}] Bot started`);
    return runner;
  }

  private startReconcileSweepIfNeeded(): void {
    if (this.reconcileSweepInterval) return;
    this.reconcileSweepInterval = setInterval(() => {
      for (const [runCode, runner] of this.runners) {
        const adapter = this.sessionAdapterMap.get(runCode);
        if (!adapter) continue;
        void this.fillReconcile
          .reconcileRun(runCode, runner.symbol, adapter)
          .catch((e) => this.logger.warn(`[${runCode}] periodic reconcile failed: ${(e as Error).message}`));
      }
    }, TradingEngineService.RECONCILE_SWEEP_MS);
  }

  private stopReconcileSweepIfNoRunners(): void {
    if (this.runners.size === 0 && this.reconcileSweepInterval) {
      clearInterval(this.reconcileSweepInterval);
      this.reconcileSweepInterval = null;
    }
  }

  onModuleDestroy(): void {
    if (this.reconcileSweepInterval) {
      clearInterval(this.reconcileSweepInterval);
      this.reconcileSweepInterval = null;
    }
    for (const timer of this.finalReconcileTimers) clearTimeout(timer);
    this.finalReconcileTimers.clear();
  }

  private buildBotConfig(
    configRecord: {
      id: string;
      symbol: string;
      direction: string;
      takeProfitPrice: number;
      mainGridCount: number;
      mainGridStep: number;
      mainGridPortionSize: number;
      leverage: number;
      stopLossGridCount: number;
      stopLossGridStep: number;
      isolationStep: number | null;
      reorderThreshold: number;
      gtcBoundary: number;
      gtcThreshold?: number;
      trailingEntry: boolean;
      trailingCallbackRate: number | null;
      entryPrice: number | null;
    },
    runCode: string,
  ): BotConfig {
    return {
      configId: configRecord.id,
      runCode,
      symbol: configRecord.symbol,
      direction: configRecord.direction as 'LONG' | 'SHORT',
      takeProfitPrice: configRecord.takeProfitPrice,
      mainGridCount: configRecord.mainGridCount,
      mainGridStep: configRecord.mainGridStep,
      mainGridPortionSize: configRecord.mainGridPortionSize,
      leverage: configRecord.leverage,
      stopLossGridCount: configRecord.stopLossGridCount,
      stopLossGridStep: configRecord.stopLossGridStep,
      isolationStep: configRecord.isolationStep ?? configRecord.stopLossGridStep,
      reorderThreshold: configRecord.reorderThreshold,
      gtcBoundary: configRecord.gtcBoundary,
      gtcThreshold: configRecord.gtcThreshold ?? 0.001,
      trailingEntry: configRecord.trailingEntry,
      trailingCallbackRate: configRecord.trailingCallbackRate ?? undefined,
      entryPrice: configRecord.entryPrice ?? undefined,
    };
  }
}

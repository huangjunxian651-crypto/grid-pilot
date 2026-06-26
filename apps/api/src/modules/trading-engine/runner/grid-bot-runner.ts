import { Injectable, Logger } from '@nestjs/common';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import { BotFsm } from '../fsm/bot-fsm';
import { StrategyEngine } from '../strategy/strategy-engine';
import { ExecutionEngine } from '../execution/execution-engine';
import { ExchangeTruthService } from '../exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor, type RecoveryResult } from '../reconstructor/bot-state-reconstructor';
import { PersistenceService } from '../persistence/persistence.service';
import type { FillPayload } from '../types/fill-payload';
import type {
  BotState,
  BotPhase,
  TriggerEvent,
  ActiveOrder,
  Decision,
  Event,
  BotFsmState,
  OrderManagerState,
} from '../types/bot-state.types';
import type { Position, Ticker, OrderResult, OrderUpdate, AlgoOrder, FillEvent } from '../types/exchange.types';
import { effectiveGtcThreshold } from '../pricing';
import { abortableDelay } from './abortable-delay';
import {
  buildBoundaryDistances,
  whichZoneFromDistances,
  toDistance,
  toPrice,
  deriveBoxLines,
  validateBoxGeometry,
  type BoxDirection,
  type BoxTargetConfig as TargetPositionConfig,
} from '@gridpilot/shared-types';
import { computeFillSavings } from '../grid-geometry/avg-grid-price';
import { priceToGridIndex } from '../grid-geometry/index-utils';
import { encodeClientOrderId, sessionToken, isLegacyClientOrderId, parseClientOrderId, encodeAlgoClientOrderId, parseAlgoClientOrderId, ownsSessionAlgoClientOrderId } from "../../exchange/adapters/utils";
import { isActionableRejection } from './actionable-rejections';

export interface BotConfig {
  configId: string;
  runCode: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  reorderThreshold: number;
  gtcBoundary: number;
  gtcThreshold: number;
  tickSize?: number;
  trailingEntry: boolean;
  trailingCallbackRate?: number;
  entryPrice?: number;
  pollIntervalMs?: number;
  pocRetryIntervalMs?: number;
  reconcileIntervalMs?: number;
  /** 清算时市价平仓未清干净的重试间隔（毫秒），默认 1000。 */
  liquidationRetryDelayMs?: number;
}

export interface PlacedOrder {
  runCode: string;
  clientOrderId: string;
  exchangeOrderId: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  gridIndex: number;
  orderType: string; // 'GRID_BUY' | 'GRID_SELL' | 'CLOSE'
  isAlgo: boolean;
  preOrderPosition: number;
  /** 进入箱体时的首笔市价建仓（加仓且下单前仓位≈0）：非网格往返，不计超额收益。 */
  isEntry: boolean;
}

export type RunnerCriticalEvent =
  | { kind: 'ORDER_REJECTED'; reason: string; message: string }
  | { kind: 'STOPPED_REJECTIONS'; reason: string; message: string }
  | { kind: 'PAUSED_PERMANENT_ERROR'; reason: string; message: string }
  | { kind: 'RESIDUAL_POSITION'; reason: string; message: string };

@Injectable()
export class GridBotRunner {
  private readonly logger = new Logger(GridBotRunner.name);
  private running = false;
  private phase: BotPhase = 'IDLE';
  private activeOrder: ActiveOrder | null = null;
  private lastTicker: { bid: number; ask: number; last: number } | null = null;
  private lastZone = -1;
  private nextSeq = 1;
  /** 配置性永久错误（如 id 超长）暂停标志：止损路径停止逐 tick 重试；USER_RESUME 复位后重试一次 */
  private permanentErrorPaused = false;
  private ownOrderIds = new Set<string>();
  private abortController = new AbortController();
  private pumps: Promise<void>[] = [];
  private mainLoopPromise: Promise<void> | null = null;

  private triggerResolver: ((trigger: TriggerEvent) => void) | null = null;
  private lastFillUpdate: OrderUpdate | null = null;
  private orderSettleResolver: ((outcome: 'FILLED' | 'CANCELLED' | 'EXPIRED', source: 'ws' | 'invalidation') => void) | null = null;
  private pendingUserAction: TriggerEvent | null = null;
  private liquidationDonePromise: Promise<void> | null = null;
  private liquidationDoneResolve: (() => void) | null = null;
  /** 会话成交台账：交易所 REST 持仓对刚成交的单有滞后，单凭 REST 会反复
   * 看到同一缺口而满额补差跑飞（实测 OKX 累积到目标上限 ~10×）。台账由
   * 本会话自有成交累计，作为敞口下界与 REST 取按方向极值。 */
  private sessionStartPositionQty = 0;
  private sessionNetFilledQty = 0;
  private lastOwnFillAtMs = 0;
  private static readonly LEDGER_REANCHOR_QUIET_MS = 60_000;
  private lastSettlementSource: 'ws' | 'invalidation' = 'ws';
  private cancelHistory: { price: number; side: string; ts: number }[] = [];
  private static readonly CANCEL_LOOP_THRESHOLD = 3;
  private static readonly CANCEL_LOOP_WINDOW_MS = 60_000;
  private cachedBoundaryDistances: number[] = [];
  private consecutiveRejections = 0;
  private static readonly MAX_FAST_REJECTIONS = 3;
  private static readonly REJECTION_BACKOFF_BASE_MS = 2_000;
  private static readonly REJECTION_BACKOFF_MAX_MS = 60_000;
  private static readonly MAX_CONSECUTIVE_REJECTIONS = 50;

  /** 交易所最小名义价值（USDT，启动时拉取一次）。注入策略做下单前 minNotional 预校验，
   * 避免下出名义价值 < 交易所最小名义的小单被反复拒（Binance -4164 连续拒单 backoff 死循环）。
   * 拉取失败、适配器不支持、或交易所未暴露该值（如 Gate adapter 当前硬编码 0）时保持 0，
   * 策略降级为不做名义预校验（旧行为）——此时该交易所上不享受本地小单拦截。 */
  private marketMinNotional = 0;

  private fsmState: BotFsmState = { kind: 'HOLD', reason: 'initializing' };
  private position: Position | null = null;
  private lastPrice = 0;
  private lastPriceTime = 0;
  private gridActiveSince: number | undefined;

  private stats = {
    totalOrdersPlaced: 0,
    totalFills: 0,
    totalReorders: 0,
    lastPersistTime: 0,
    realizedPnl: 0,
  };
  private tickCount = 0;
  private static readonly DEFAULT_RECONCILE_INTERVAL_MS = 60_000;
  /** 清算市价平仓最多尝试次数（含首次），超过仍残留则告警收尾。 */
  private static readonly LIQUIDATION_MAX_ATTEMPTS = 3;
  /** 清算重试默认间隔（毫秒），可被 config.liquidationRetryDelayMs 覆盖。 */
  private static readonly DEFAULT_LIQUIDATION_RETRY_DELAY_MS = 1000;

  constructor(
    private readonly config: BotConfig,
    private readonly adapter: ExchangeAdapter,
    private readonly deps: {
      fsm: BotFsm;
      strategy: StrategyEngine;
      execution: ExecutionEngine;
      truth: ExchangeTruthService;
      reconstructor: BotStateReconstructor;
      persistence?: PersistenceService;
      onStateChange?: (state: BotState) => void;
      onFill?: (payload: FillPayload) => void;
      onOrderPlaced?: (o: PlacedOrder) => void;
      onFillEvent?: (event: FillEvent & { clientOrderId?: string; side?: 'BUY' | 'SELL' }) => void;
      /** 关键可操作事件上报（可操作拒单/连续拒单自停）；回调异常不得影响主循环 */
      onCriticalEvent?: (event: RunnerCriticalEvent) => void;
    },
  ) {}

  get runCode(): string {
    return this.config.runCode;
  }

  /** @deprecated Use runCode. Kept for HTTP route URL contract compatibility. */
  get sessionCode(): string {
    return this.config.runCode;
  }

  get symbol(): string {
    return this.config.symbol;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPhase(): BotPhase {
    return this.phase;
  }

  getActiveOrder(): ActiveOrder | null {
    return this.activeOrder;
  }

  getAlgoOrders() {
    return this.deps.truth.getAlgoOrders(this.config.symbol);
  }

  getState(): BotState | null {
    if (!this.running && !this.mainLoopPromise) return null;
    return this.buildState();
  }

  private buildState(): BotState {
    return {
      fsm: this.fsmState,
      config: this.config as unknown as Record<string, unknown>,
      position: this.position,
      openOrders: [],
      lastPrice: this.lastPrice,
      lastPriceTime: this.lastPriceTime,
      orderManager: {
        activeOrder: this.activeOrder,
        recentlyCancelled: new Set(),
      },
      nextSeq: this.nextSeq,
      gridActiveSince: this.gridActiveSince,
      stats: { ...this.stats },
    };
  }

  submitUserAction(action: 'USER_PAUSE' | 'USER_RESUME' | 'USER_LIQUIDATE'): void {
    if (this.phase === 'ORDER_ACTIVE' && (action === 'USER_PAUSE' || action === 'USER_LIQUIDATE')) {
      this.pendingUserAction = { type: action } as TriggerEvent;
      this.resolveOrderSettlement('CANCELLED', 'invalidation');
      return;
    }
    if (this.triggerResolver) {
      this.resolveTrigger({ type: action } as TriggerEvent);
      return;
    }
    // 主循环正忙于 tick（无人等待触发器）：直接 resolve 会被丢弃，
    // 暂存到 pendingUserAction，待 waitForNextTrigger 优先消费。
    this.pendingUserAction = { type: action } as TriggerEvent;
  }

  /** 请求清算并等待其真正完成（撤单+市价平仓+终态转移）。幂等：重复调用
   * 返回同一个 promise。runner 未运行时立即 resolve。 */
  requestLiquidation(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (!this.liquidationDonePromise) {
      this.liquidationDonePromise = new Promise<void>((resolve) => {
        this.liquidationDoneResolve = resolve;
      });
      this.submitUserAction('USER_LIQUIDATE');
    }
    return this.liquidationDonePromise;
  }

  private resolveLiquidationDone(): void {
    if (this.liquidationDoneResolve) {
      const r = this.liquidationDoneResolve;
      this.liquidationDoneResolve = null;
      r();
    }
  }

  submitEvent(event: Event): void {
    if (event.type === 'USER_PAUSE' || event.type === 'USER_RESUME' || event.type === 'USER_LIQUIDATE') {
      this.submitUserAction(event.type as 'USER_PAUSE' | 'USER_RESUME' | 'USER_LIQUIDATE');
    }
  }

  async start(initialState?: BotState): Promise<void> {
    if (this.running) {
      this.logger.warn(`[${this.config.runCode}] Already running`);
      return;
    }

    const geom = {
      takeProfitPrice: this.config.takeProfitPrice,
      mainGridCount: this.config.mainGridCount,
      mainGridStep: this.config.mainGridStep,
      mainGridPortionSize: this.config.mainGridPortionSize,
      stopLossGridCount: this.config.stopLossGridCount,
      stopLossGridStep: this.config.stopLossGridStep,
      isolationStep: this.config.isolationStep ?? 0,
      direction: this.config.direction as BoxDirection,
    };
    const validation = validateBoxGeometry(geom);
    const lines = deriveBoxLines(this.buildTargetPositionConfig());
    this.logger.log(
      `[${this.config.runCode}] Grid config: ${geom.direction} takeProfitPrice=${geom.takeProfitPrice} ` +
      `grids=${geom.mainGridCount} step=${geom.mainGridStep.toFixed(4)} ` +
      `fullPosition=${lines.fullPositionPrice.toFixed(2)} liquidation=${lines.liquidationPrice.toFixed(2)} ` +
      `stopLoss=${geom.stopLossGridCount}x${geom.stopLossGridStep}`,
    );
    if (!validation.valid) {
      const msg = `Invalid grid config: ${validation.errors.join('; ')}`;
      this.logger.error(`[${this.config.runCode}] ${msg}`);
      throw new Error(msg);
    }

    this.running = true;
    this.abortController = new AbortController();

    const tpConfig = this.buildTargetPositionConfig();
    this.cachedBoundaryDistances = buildBoundaryDistances(tpConfig);

    await this.loadMarketConstraints();

    if (initialState) {
      this.restoreFromState(initialState);
      this.logger.log(`[${this.config.runCode}] Starting with provided initial state`);
    } else {
      await this.coldStartRecover();
    }

    this.sessionStartPositionQty = this.position?.baseAssetQty ?? 0;
    this.sessionNetFilledQty = 0;
    this.lastOwnFillAtMs = 0;

    await this.adapter.connect();

    await this.cancelOwnOrders(this.config.symbol);
    await this.cancelStaleOrdersOnSymbol(this.config.symbol);

    // 紧急止损必须在上面两道启动清扫之后下：清扫按 clientOrderId 前缀认领
    // 本会话挂单，恢复期刚下的止损会被当作上一会话残留撤掉，持仓在下一个
    // tick 重建前裸奔（2026-06-12 OKX 实测，历史最长 24 分钟无保护）。
    if (this.hasProtectablePosition()) {
      await this.ensureEmergencyStopLoss();
    }

    await this.adapter.setLeverage(this.config.symbol, this.config.leverage);
    this.logger.log(`[${this.config.runCode}] Leverage set to ${this.config.leverage}x`);

    try {
      await this.adapter.setMarginMode(this.config.symbol, true);
      this.logger.log(`[${this.config.runCode}] Margin mode set to cross`);
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] setMarginMode failed (may already be cross): ${(err as Error).message}`);
    }

    this.pumps = [
      this.tickerPump(),
      this.orderUpdatePump(),
      this.fillsPump(),
    ];

    this.mainLoopPromise = this.runMainLoop();
    this.logger.log(`[${this.config.runCode}] Runner started`);
  }

  async stop(): Promise<{ cancelFailed: string[] }> {
    if (!this.running) return { cancelFailed: [] };
    this.running = false;

    this.resolveTrigger({ type: 'TIMER', source: 'poll' });
    this.resolveOrderSettlement('CANCELLED', 'invalidation');

    const cancelFailed: string[] = [];

    if (this.activeOrder) {
      try {
        await this.adapter.cancelOrder(this.activeOrder.orderId, this.config.symbol, this.abortController.signal);
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] Failed to cancel active order on stop: ${(err as Error).message}`);
        cancelFailed.push(this.activeOrder.orderId);
      }
      this.activeOrder = null;
    }

    const ownResult = await this.cancelOwnOrders(this.config.symbol);
    cancelFailed.push(...ownResult.failed);
    this.abortController.abort();

    await this.adapter.disconnect();

    const pumpShutdown = Promise.allSettled(this.pumps);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([pumpShutdown, timeout]);
    this.pumps = [];

    if (this.mainLoopPromise) {
      await Promise.race([this.mainLoopPromise, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
      this.mainLoopPromise = null;
    }

    this.phase = 'IDLE';
    // 兜底：清算未走完 runner 就被拆除时，不能让 requestLiquidation 调用方挂死
    this.resolveLiquidationDone();
    if (cancelFailed.length > 0) {
      this.logger.warn(`[${this.config.runCode}] Runner stopped with ${cancelFailed.length} uncancelled orders: ${cancelFailed.join(', ')}`);
    } else {
      this.logger.log(`[${this.config.runCode}] Runner stopped`);
    }
    return { cancelFailed };
  }

  private restoreFromState(state: BotState): void {
    this.fsmState = state.fsm;
    this.position = state.position;
    this.lastPrice = state.lastPrice;
    this.lastPriceTime = state.lastPriceTime;
    // 注意：信任快照中的 nextSeq。生产路径恒走 coldStartRecover（已对齐 DB
    // 最大序号）；若将来接入快照恢复，陈旧快照会重新引入 clientOrderId 复用，
    // 须在此同样取 max(state.nextSeq, persistence.getMaxOrderSeq()+1)。
    this.nextSeq = state.nextSeq;
    this.gridActiveSince = state.gridActiveSince;
    this.stats = { ...state.stats };
    if (state.orderManager.activeOrder) {
      this.activeOrder = state.orderManager.activeOrder;
      this.phase = 'ORDER_ACTIVE';
    }
  }

  private async coldStartRecover(): Promise<void> {
    this.logger.log(`[${this.config.runCode}] Cold start: syncing with exchange...`);

    const syncResult = await this.deps.truth.invalidateAndRefresh(this.config.symbol);

    // clean-switch 部署告警：交易所上若残留旧格式（SYMBOL_<13位ms>_SIDE_seq）挂单，
    // 新所有权逻辑无法认领它们，其成交会被静默丢弃。把静默失败转成可见信号。
    const legacyOrders = [
      ...syncResult.openOrders,
      ...syncResult.algoOrders,
    ].filter((o) => isLegacyClientOrderId(o.clientOrderId));
    if (legacyOrders.length > 0) {
      this.logger.warn(
        `[${this.config.runCode}] 发现 ${legacyOrders.length} 个旧格式残留挂单，新版本无法认领（可能为部署前遗留）。` +
        `请在交易所手动核对/撤销，否则其成交不会被本机器人跟踪。clientOrderIds=` +
        legacyOrders.map((o) => o.clientOrderId).join(', '),
      );
    }

    const ticker = await this.adapter.getTicker(this.config.symbol);
    const configRecord = this.config as unknown as Record<string, unknown>;
    // 查询失败让异常上抛终止启动：拿不到历史最大序号就下单，等于带着 id 复用
    // 风险交易。persistence 仅测试构造可缺省（生产 DI 恒注入），缺省回 0。
    const persistedMaxSeq = this.deps.persistence
      ? await this.deps.persistence.getMaxOrderSeq(this.config.runCode)
      : 0;
    const recovery = this.deps.reconstructor.reconstruct(syncResult, ticker.last, configRecord, { persistedMaxSeq });

    for (const o of recovery.ordersToCancel) {
      try {
        await this.adapter.cancelOrder(o.orderId, this.config.symbol, this.abortController.signal);
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] Cancel stale order ${o.orderId} failed: ${(err as Error).message}`);
      }
    }

    const staleAlgos = syncResult.algoOrders.filter(
      (a) => this.isOwnAlgoOrder(a.clientOrderId),
    );
    if (staleAlgos.length > 0) {
      this.logger.log(`[${this.config.runCode}] Cleaning ${staleAlgos.length} stale algo orders (old sessions)`);
      for (const a of staleAlgos) {
        try {
          await this.adapter.cancelAlgoOrder(a.algoOrderId, this.config.symbol, this.abortController.signal);
        } catch (err) {
          this.logger.warn(`[${this.config.runCode}] Cancel stale algo ${a.algoOrderId} failed: ${(err as Error).message}`);
        }
      }
    }

    if (recovery.activeOrder) {
      const marketInfo = this.lastTicker ?? { bid: ticker.last * 0.999, ask: ticker.last * 1.001 };
      const decision = this.deps.strategy.computeDesiredOrders(
        ticker.last,
        recovery.position ?? {
          symbol: this.config.symbol,
          baseAssetQty: 0,
          quoteAssetQty: 0,
          entryPrice: 0,
          leverage: this.config.leverage,
          marginType: 'CROSS',
        },
        this.buildStrategyConfig(),
        { tickSize: this.config.tickSize ?? 0.01, bestBid: marketInfo.bid, bestAsk: marketInfo.ask },
      );

      if (decision.action === 'PLACE' && recovery.activeOrder.price && recovery.activeOrder.side === decision.side) {
        this.activeOrder = recovery.activeOrder;
        this.phase = 'ORDER_ACTIVE';
      } else {
        try {
          await this.adapter.cancelOrder(recovery.activeOrder.orderId, this.config.symbol, this.abortController.signal);
        } catch (err) {
          this.logger.warn(`[${this.config.runCode}] Cancel recovered order ${recovery.activeOrder.orderId} failed: ${(err as Error).message}`);
        }
        this.phase = 'IDLE';
      }
    } else {
      this.phase = 'IDLE';
    }

    this.fsmState = recovery.fsmState;
    this.position = recovery.position;
    this.lastPrice = ticker.last;
    this.lastPriceTime = ticker.timestamp;
    this.nextSeq = recovery.nextSeq;
    this.gridActiveSince = recovery.gridActiveSince;
    this.stats = { ...recovery.stats };
    const zoneConfig = this.buildTargetPositionConfig();
    const zoneDistances = this.cachedBoundaryDistances.length > 0
      ? this.cachedBoundaryDistances
      : buildBoundaryDistances(zoneConfig);
    this.lastZone = whichZoneFromDistances(toDistance(ticker.last, zoneConfig), zoneDistances);

    this.logger.log(
      `[${this.config.runCode}] Recovered state: ${this.fsmState.kind}, price=${ticker.last}, phase=${this.phase}`,
    );

    if (this.position && Math.abs(this.position.baseAssetQty) > 1e-12 && this.deps.persistence) {
      try {
        const { total } = await this.deps.persistence.getFillsByConfigId(this.config.configId, 1);
        if (total === 0) {
          await this.deps.persistence.writeEventLog(
            this.config.configId,
            {
              type: 'POSITION_INHERITED',
              symbol: this.config.symbol,
              qty: this.position.baseAssetQty,
              entryPrice: this.position.entryPrice,
              reason: 'Pre-existing position detected on cold start',
            },
            this.nextSeq,
            this.config.runCode,
          );
          this.logger.warn(`[${this.config.runCode}] Pre-existing position detected: ${this.position.baseAssetQty} @ ${this.position.entryPrice}`);
        }
      } catch (err) {
        this.logger.error(`[${this.config.runCode}] Failed to check/record inherited position: ${(err as Error).message}`);
      }
    }
  }

  private async runMainLoop(): Promise<void> {
    while (this.running) {
      try {
        const trigger = await this.waitForNextTrigger();
        if (!this.running) break;
        await this.handleTrigger(trigger);
        this.broadcastState();
      } catch (err) {
        this.logger.error(
          `[${this.config.runCode}] Main loop error: ${(err as Error).message}`,
          (err as Error).stack,
        );
        if (!this.running) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async waitForNextTrigger(): Promise<TriggerEvent> {
    if (this.pendingUserAction) {
      const action = this.pendingUserAction;
      this.pendingUserAction = null;
      return action;
    }

    const intervalMs = this.config.pollIntervalMs ?? 10000;

    const timerPromise = new Promise<TriggerEvent>((resolve) => {
      const timer = setTimeout(() => {
        if (this.triggerResolver === resolveAsTrigger) {
          this.triggerResolver = null;
        }
        resolve({ type: 'TIMER', source: 'poll' });
      }, intervalMs);
      const resolveAsTrigger = (trigger: TriggerEvent) => {
        clearTimeout(timer);
        resolve(trigger);
      };
      this.triggerResolver = resolveAsTrigger;
    });

    return timerPromise;
  }

  private resolveTrigger(trigger: TriggerEvent): void {
    if (this.triggerResolver) {
      const r = this.triggerResolver;
      this.triggerResolver = null;
      r(trigger);
    }
  }

  private resolveOrderSettlement(outcome: 'FILLED' | 'CANCELLED' | 'EXPIRED', source: 'ws' | 'invalidation' = 'invalidation', update?: OrderUpdate): void {
    if (this.orderSettleResolver) {
      const r = this.orderSettleResolver;
      this.orderSettleResolver = null;
      this.lastSettlementSource = source;
      if (update && outcome === 'FILLED') {
        this.lastFillUpdate = update;
      }
      r(outcome, source);
    }
  }

  private async handleTrigger(trigger: TriggerEvent): Promise<void> {
    if (trigger.type === 'USER_PAUSE') {
      this.fsmState = this.deps.fsm.transition(
        this.fsmState,
        { type: 'USER_PAUSE' } as Event,
        this.buildFsmConfig(),
        this.position ?? undefined,
      ).newState;
      this.broadcastState();
      return;
    }

    if (trigger.type === 'USER_RESUME') {
      // 复位永久错误标志：恢复后重试一次，仍失败会再次落入 PAUSED（收敛，
      // 非死循环）。不复位则恢复后无止损裸跑且完全无声。
      this.permanentErrorPaused = false;
      this.fsmState = this.deps.fsm.transition(
        this.fsmState,
        { type: 'USER_RESUME' } as Event,
        this.buildFsmConfig(),
        this.position ?? undefined,
      ).newState;
      this.resolveTrigger({ type: 'TIMER', source: 'poll' });
      return;
    }

    if (trigger.type === 'USER_LIQUIDATE') {
      this.fsmState = this.deps.fsm.transition(
        this.fsmState,
        { type: 'USER_LIQUIDATE' } as Event,
        this.buildFsmConfig(),
        this.position ?? undefined,
      ).newState;
      await this.executeLiquidation();
      this.broadcastState();
      return;
    }

    if (this.phase === 'ORDER_ACTIVE') {
      return;
    }

    const terminalKinds = ['LIQUIDATED', 'CANCELLED', 'TAKE_PROFIT'];
    if (terminalKinds.includes(this.fsmState.kind)) {
      setImmediate(() => this.stop().catch(() => {}));
      return;
    }

    if (this.fsmState.kind === 'PAUSED') {
      return;
    }

    await this.cleanStateCycle();
  }

  private async cleanStateCycle(): Promise<void> {
    let syncResult;
    try {
      syncResult = await this.deps.truth.invalidateAndRefresh(this.config.symbol);
    } catch (err) {
      this.logger.error(`[${this.config.runCode}] Position refresh failed: ${(err as Error).message}`);
      return;
    }
    this.position = syncResult.position;
    this.maybeReanchorSessionFillLedger();

    this.tickCount++;
    const reconcileInterval = this.config.reconcileIntervalMs ?? GridBotRunner.DEFAULT_RECONCILE_INTERVAL_MS;
    const pollInterval = this.config.pollIntervalMs ?? 10_000;
    const ticksPerReconcile = Math.max(1, Math.round(reconcileInterval / pollInterval));
    if (this.tickCount % ticksPerReconcile === 0) {
      await this.reconcileOrphanOrders(syncResult);
    }

    if (this.hasProtectablePosition()) {
      await this.ensureEmergencyStopLoss();
    }

    const price = this.lastTicker?.last ?? this.lastPrice;
    if (!Number.isFinite(price) || price <= 0) {
      this.logger.warn(`[${this.config.runCode}] Skipping tick: no valid price yet (price=${price})`);
      return;
    }
    this.lastPrice = price;
    this.lastPriceTime = Date.now();

    const fsmResult = this.deps.fsm.transition(
      this.fsmState,
      { type: 'TICK', price, timestamp: Date.now() } as Event,
      this.buildFsmConfig(),
      this.position ?? undefined,
    );
    this.fsmState = fsmResult.newState;

    if (fsmResult.action === 'START_MAIN_GRID') {
      this.logger.log(`[${this.config.runCode}] START_MAIN_GRID — grid is now active`);
      this.gridActiveSince = Date.now();
      await this.ensureEmergencyStopLoss();
    }

    if (this.fsmState.kind === 'LIQUIDATING') {
      await this.executeLiquidation();
      return;
    }

    const terminalKinds = ['LIQUIDATED', 'CANCELLED', 'TAKE_PROFIT'];
    if (terminalKinds.includes(this.fsmState.kind)) {
      setImmediate(() => this.stop().catch(() => {}));
      return;
    }

    if (this.fsmState.kind === 'TRAILING_ENTRY') {
      return;
    }

    if (this.fsmState.kind !== 'RUNNING') {
      return;
    }

    if (!this.position) {
      return;
    }

    const marketInfo = this.lastTicker ?? { bid: price * 0.999, ask: price * 1.001 };
    const decision = this.deps.strategy.computeDesiredOrders(
      price,
      this.position,
      this.buildStrategyConfig(),
      { tickSize: this.config.tickSize ?? 0.01, bestBid: marketInfo.bid, bestAsk: marketInfo.ask },
    );

    if (decision.action === 'PLACE') {
      await this.executeOrderLoop(decision);
    }
  }

  /** 网格满仓上限（基础资产数量）。策略合法的"补到目标"单永不超过它。 */
  private maxPositionSizeFromGrid(): number {
    return this.config.mainGridCount * this.config.mainGridPortionSize;
  }

  /** 加仓方向：LONG 的 BUY / SHORT 的 SELL。 */
  private isPositionIncreasingOrder(side: 'BUY' | 'SELL'): boolean {
    return this.config.direction === 'LONG' ? side === 'BUY' : side === 'SELL';
  }

  /**
   * 进入箱体时的首笔市价建仓：加仓方向且下单前仓位≈0。传统网格进场也会做同样的
   * 市价建仓，不存在「相对网格线的额外价差」，故不计超额收益（savings 记 0）。
   * 箱体策略内「从 0 加仓」仅发生于首次进场——卖到止盈端仓位归 0 即进 TAKE_PROFIT
   * 终态、run 结束，不会再从 0 回补，故无需一次性标志即可精确识别。
   */
  private isInitialEntryBuild(side: 'BUY' | 'SELL', preOrderPosition: number): boolean {
    if (!this.isPositionIncreasingOrder(side)) return false;
    const flatEps = Math.max(this.config.mainGridPortionSize * 0.5, 1e-8);
    return Math.abs(preOrderPosition) <= flatEps;
  }

  /** 敞口下界：REST 持仓与台账推算持仓按方向取极值（更大敞口者）。 */
  private exposureBoundPositionQty(): number {
    const restQty = this.position?.baseAssetQty ?? 0;
    const ledgerQty = this.sessionStartPositionQty + this.sessionNetFilledQty;
    return this.config.direction === 'LONG'
      ? Math.max(restQty, ledgerQty)
      : Math.min(restQty, ledgerQty);
  }

  /** REST 敞口持续低于台账且 60s 内无自有成交（滞后窗口必已过去）→ 发生了
   * 台账外减仓（紧急止损/手动平仓），收敛到 REST，避免加仓被永久锁死。 */
  private maybeReanchorSessionFillLedger(): void {
    const restQty = this.position?.baseAssetQty ?? 0;
    const ledgerQty = this.sessionStartPositionQty + this.sessionNetFilledQty;
    const sign = this.config.direction === 'LONG' ? 1 : -1;
    if (
      restQty * sign < ledgerQty * sign - 1e-12 &&
      Date.now() - this.lastOwnFillAtMs > GridBotRunner.LEDGER_REANCHOR_QUIET_MS
    ) {
      this.logger.warn(
        `[${this.config.runCode}] Session fill ledger re-anchored to exchange position: ledger=${ledgerQty.toFixed(6)} → rest=${restQty.toFixed(6)}`,
      );
      this.sessionStartPositionQty = restQty;
      this.sessionNetFilledQty = 0;
    }
  }

  /** 加仓护栏：预计敞口超过网格满仓上限即拒单。防止 REST 持仓滞后导致
   * 反复满额补差跑飞（BUG-06，实测累积到上限 ~10×）。减仓单永不拦截。 */
  private positionIncreaseGuardBlocks(decision: Decision): boolean {
    if (decision.action !== 'PLACE') return false;
    if (!this.isPositionIncreasingOrder(decision.side)) return false;
    const signedQty = decision.side === 'BUY' ? decision.qty : -decision.qty;
    const projectedQty = this.exposureBoundPositionQty() + signedQty;
    const cap = this.maxPositionSizeFromGrid() + 1e-6;
    if (Math.abs(projectedQty) <= cap) return false;
    this.logger.error(
      `[${this.config.runCode}] Position increase blocked: projected=${projectedQty.toFixed(6)} exceeds grid cap=${this.maxPositionSizeFromGrid().toFixed(6)} ` +
      `(rest=${(this.position?.baseAssetQty ?? 0).toFixed(6)}, ledger=${(this.sessionStartPositionQty + this.sessionNetFilledQty).toFixed(6)}, order=${decision.side} ${decision.qty})`,
    );
    return true;
  }

  private isCancelLoop(price: number, side: string): boolean {
    const recent = this.cancelHistory.filter(
      (e) => e.ts > Date.now() - GridBotRunner.CANCEL_LOOP_WINDOW_MS,
    );
    const matches = recent.filter((e) => Math.abs(e.price - price) < 1e-6 && e.side === side);
    return matches.length >= GridBotRunner.CANCEL_LOOP_THRESHOLD;
  }

  private async executeOrderLoop(decision: Decision): Promise<void> {
    if (decision.action !== 'PLACE') return;
    let currentDecision = decision;

    while (this.running) {
      if (this.positionIncreaseGuardBlocks(currentDecision)) {
        return;
      }

      if (this.isCancelLoop(currentDecision.price, currentDecision.side)) {
        this.logger.warn(
          `[${this.config.runCode}] Cancel-loop detected for ${currentDecision.side}@${currentDecision.price}, skipping`,
        );
        this.cancelHistory = this.cancelHistory.filter(
          (e) => Math.abs(e.price - currentDecision.price) >= 1e-6 || e.side !== currentDecision.side,
        );
        return;
      }

      const clientOrderId = this.generateClientOrderId(currentDecision.side);
      const result = await this.deps.execution.execute(
        {
          symbol: this.config.symbol,
          side: currentDecision.side,
          qty: currentDecision.qty,
          price: currentDecision.price,
          tif: currentDecision.tif,
          clientOrderId,
        },
        {
          currentPrice: this.lastTicker?.last ?? this.lastPrice,
          signal: this.abortController.signal,
          getTicker: async () => {
            const t = await this.adapter.getTicker(this.config.symbol);
            return { bid: t.bid, ask: t.ask };
          },
          gridPrice: currentDecision.gridPrice,
          gtcThreshold: this.config.gtcThreshold,
          pocRetryIntervalMs: this.config.pocRetryIntervalMs ?? 3000,
          log: (msg: string) => this.logger.warn(`[${this.config.runCode}] ${msg}`),
        },
      );

      if (result.outcome === 'REJECTED') {
        // 配置性永久错误：重试只会让 id 更长（nextSeq 递增），50 次退避后
        // 下一 tick 再来 50 次的无限慢速循环必须掐断，与 algo 路径同策略。
        if (result.errorCode === 'CLIENT_ID_TOO_LONG') {
          this.pauseOnPermanentError('CLIENT_ID_TOO_LONG', result.error ?? '');
          return;
        }
        this.logger.warn(
          `[${this.config.runCode}] Order rejected (${this.consecutiveRejections + 1}): ${result.error}`,
        );
        this.consecutiveRejections++;

        if (isActionableRejection(result.errorCode)) {
          this.emitCriticalEvent({ kind: 'ORDER_REJECTED', reason: result.errorCode, message: result.error ?? '' });
        }

        if (this.consecutiveRejections >= GridBotRunner.MAX_CONSECUTIVE_REJECTIONS) {
          this.logger.error(
            `[${this.config.runCode}] ${this.consecutiveRejections} consecutive rejections, exiting order loop (will retry on next tick)`,
          );
          this.emitCriticalEvent({ kind: 'STOPPED_REJECTIONS', reason: result.errorCode ?? 'UNKNOWN', message: result.error ?? '' });
          return;
        }

        if (this.consecutiveRejections >= GridBotRunner.MAX_FAST_REJECTIONS) {
          const delay = Math.min(
            GridBotRunner.REJECTION_BACKOFF_BASE_MS * Math.pow(2, this.consecutiveRejections - GridBotRunner.MAX_FAST_REJECTIONS),
            GridBotRunner.REJECTION_BACKOFF_MAX_MS,
          ) * (0.75 + Math.random() * 0.5);
          this.logger.warn(
            `[${this.config.runCode}] Rejection backoff: ${Math.round(delay)}ms after ${this.consecutiveRejections} consecutive rejections`,
          );
          await abortableDelay(delay, this.abortController.signal);
          if (!this.running) return;
        }

        const wsPrice = this.lastTicker?.last;
        if (!wsPrice) {
          return;
        }

        const marketInfo = this.lastTicker ?? { bid: wsPrice * 0.999, ask: wsPrice * 1.001 };
        const newDecision = this.deps.strategy.computeDesiredOrders(
          wsPrice,
          this.position ?? {
            symbol: this.config.symbol,
            baseAssetQty: 0,
            quoteAssetQty: 0,
            entryPrice: 0,
            leverage: this.config.leverage,
            marginType: 'CROSS',
          },
          this.buildStrategyConfig(),
          { tickSize: this.config.tickSize ?? 0.01, bestBid: marketInfo.bid, bestAsk: marketInfo.ask },
        );

        if (newDecision.action !== 'PLACE') {
          return;
        }

        currentDecision = newDecision;
        this.nextSeq++;
        this.stats.totalOrdersPlaced++;
        continue;
      }

      if (result.orderId) {
        this.ownOrderIds.add(result.orderId);
      }

      if (result.outcome === 'FILLED') {
        this.consecutiveRejections = 0;
        this.stats.totalFills++;
        const fillPrice = result.avgFillPrice ?? result.price ?? currentDecision.price;
        const fillQty = result.filledQty || result.qty || currentDecision.qty;
        this.emitOrderPlaced(result.clientOrderId ?? clientOrderId, result.orderId ?? '', currentDecision.side, currentDecision.qty, currentDecision.price, currentDecision.gridPrice);
        await this.recordFill(
          currentDecision.side,
          fillPrice,
          fillQty,
          currentDecision.gridPrice,
          currentDecision.tif,
          result.orderId,
          result.clientOrderId,
        );
        this.nextSeq++;
        this.stats.totalOrdersPlaced++;
        this.broadcastState();
        return;
      }

      this.activeOrder = {
        orderId: result.orderId ?? '',
        clientOrderId,
        side: currentDecision.side,
        qty: currentDecision.qty,
        price: currentDecision.price,
        gridPrice: currentDecision.gridPrice,
        tif: currentDecision.tif,
        placedAt: Date.now(),
        preOrderPosition: this.position?.baseAssetQty ?? 0,
      };
      this.emitOrderPlaced(clientOrderId, result.orderId ?? '', currentDecision.side, currentDecision.qty, currentDecision.price, currentDecision.gridPrice);
      this.consecutiveRejections = 0;
      this.phase = 'ORDER_ACTIVE';
      this.nextSeq++;
      this.stats.totalOrdersPlaced++;
      this.broadcastState();

      const settlementOutcome = await this.waitForOrderSettlement();

      this.phase = 'IDLE';

      if (settlementOutcome === 'FILLED') {
        this.stats.totalFills++;
        if (this.activeOrder) {
          const wsUpdate = this.lastFillUpdate;
          const fillPrice = wsUpdate?.avgFillPrice ?? this.activeOrder.gridPrice ?? this.activeOrder.price;
          const fillQty = wsUpdate?.filledQty ?? this.activeOrder.qty;
          await this.recordFill(
            this.activeOrder.side,
            fillPrice,
            fillQty,
            this.activeOrder.gridPrice,
            this.activeOrder.tif,
            wsUpdate?.orderId ?? this.activeOrder.orderId,
            wsUpdate?.clientOrderId ?? this.activeOrder.clientOrderId,
          );
        }
        this.lastFillUpdate = null;
        this.activeOrder = null;
        this.broadcastState();
        return;
      }

      if (this.lastSettlementSource === 'invalidation' && this.activeOrder?.orderId) {
        try {
          await this.adapter.cancelOrder(this.activeOrder.orderId, this.config.symbol, this.abortController.signal);
        } catch (err) {
          this.logger.warn(`[${this.config.runCode}] Cancel on invalidation failed: ${(err as Error).message}`);
          // Cancel likely failed because the order was already filled on the exchange.
          // Refresh position from exchange so the next strategy computation uses correct data.
          // RACE: a concurrent onTickerUpdate could read stale this.position while this
          // await is in-flight. Acceptable because the next cleanStateCycle tick will
          // call invalidateAndRefresh again and self-correct.
          try {
            const syncResult = await this.deps.truth.invalidateAndRefresh(this.config.symbol);
            this.position = syncResult.position;
          } catch (refreshErr) {
            this.logger.warn(`[${this.config.runCode}] Position refresh after cancel failure also failed: ${(refreshErr as Error).message}`);
          }
        }
      }

      this.activeOrder = null;
      if (this.lastSettlementSource === 'invalidation' && currentDecision) {
        // 价格失效撤换单 = 一次改单（OBS-B：此前从未累加，页面「改单次数」恒 0）
        this.stats.totalReorders++;
        this.cancelHistory.push({ price: currentDecision.price, side: currentDecision.side, ts: Date.now() });
        this.cancelHistory = this.cancelHistory.filter(
          (e) => e.ts > Date.now() - GridBotRunner.CANCEL_LOOP_WINDOW_MS,
        );
      }
      return;
    }
  }

  private waitForOrderSettlement(): Promise<'FILLED' | 'CANCELLED' | 'EXPIRED'> {
    return new Promise((resolve) => {
      this.orderSettleResolver = (outcome, _source) => { resolve(outcome); };
    });
  }

  private async onTickerUpdate(ticker: Ticker): Promise<void> {
    // 无效价格帧（交易所订阅确认/心跳被误映射成 0 价 ticker）一旦入账，
    // FSM 会把 price=0 当真实价：LONG 的 d=TP-0 必然超网格深度 → 秒清算
    // → 调度器再激活 → 死循环（2026-06-12 Gate 实测）。直接丢弃。
    if (!Number.isFinite(ticker.last) || ticker.last <= 0) {
      this.logger.warn(`[${this.config.runCode}] Dropped invalid ticker frame: last=${ticker.last}`);
      return;
    }
    const prevLast = this.lastTicker?.last ?? this.lastPrice;
    this.lastTicker = { bid: ticker.bid, ask: ticker.ask, last: ticker.last };
    this.lastPrice = ticker.last;
    this.lastPriceTime = ticker.timestamp;

    if (this.phase === 'IDLE') {
      const zoneConfig = this.buildTargetPositionConfig();
      const prevZone = whichZoneFromDistances(toDistance(prevLast, zoneConfig), this.cachedBoundaryDistances);
      const currentZone = whichZoneFromDistances(toDistance(ticker.last, zoneConfig), this.cachedBoundaryDistances);

      if (prevZone !== currentZone) {
        this.lastZone = currentZone;
        this.resolveTrigger({
          type: 'ZONE_CROSS',
          price: ticker.last,
          previousZone: prevZone,
          currentZone,
        });
      }
    }

    if (this.phase === 'ORDER_ACTIVE' && this.activeOrder) {
      const marketInfo = { bid: ticker.bid, ask: ticker.ask };
      const marketPrice = this.activeOrder.side === 'BUY' ? marketInfo.ask : marketInfo.bid;

      const tickSize = this.config.tickSize ?? 0.01;
      const gtcThreshold = effectiveGtcThreshold({
        gtcThreshold: this.config.gtcThreshold,
      });

      const reorder = this.deps.strategy.computeReorder({
        side: this.activeOrder.side,
        gridPrice: this.activeOrder.gridPrice ?? this.activeOrder.price,
        placedPrice: this.activeOrder.price,
        marketPrice,
        tickSize,
        gtcThreshold,
        reorderThreshold: this.config.reorderThreshold,
      });

      if (reorder.shouldReorder && !reorder.blocked) {
        this.resolveOrderSettlement('CANCELLED', 'invalidation');
      }

      if (!this.position) return;
      const newDecision = this.deps.strategy.computeDesiredOrders(
        ticker.last,
        this.position,
        this.buildStrategyConfig(),
        { tickSize: tickSize, bestBid: marketInfo.bid, bestAsk: marketInfo.ask },
      );

      if (newDecision.action !== 'PLACE' || newDecision.side !== this.activeOrder.side) {
        this.resolveOrderSettlement('CANCELLED', 'invalidation');
      }
    }
  }

  private async executeLiquidation(): Promise<void> {
    this.phase = 'LIQUIDATING';

    if (this.activeOrder) {
      try {
        await this.adapter.cancelOrder(this.activeOrder.orderId, this.config.symbol, this.abortController.signal);
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] Cancel active order for liquidation failed: ${(err as Error).message}`);
      }
      this.activeOrder = null;
    }

    const { failed: cancelFailed } = await this.cancelOwnOrders(this.config.symbol);
    if (cancelFailed.length > 0) {
      this.logger.warn(`[${this.config.runCode}] Liquidation: ${cancelFailed.length} orders failed to cancel: ${cancelFailed.join(', ')}`);
    }

    // 市价平仓可能未全成交（滑点/部分成交/接口报错）。单次平仓清不干净会让持仓
    // 静默残留交易所，故重试至清零或耗尽次数，避免误报"已清算"。
    const retryDelayMs = this.config.liquidationRetryDelayMs ?? GridBotRunner.DEFAULT_LIQUIDATION_RETRY_DELAY_MS;
    for (let attempt = 1; attempt <= GridBotRunner.LIQUIDATION_MAX_ATTEMPTS; attempt++) {
      // 关停（stop/abort）中不再继续下平仓单；末尾的兜底 resolveLiquidationDone 仍会触发。
      if (!this.running) {
        break;
      }
      if (!this.position || Math.abs(this.position.baseAssetQty) <= 1e-12) {
        break;
      }

      const side = this.position.baseAssetQty > 0 ? 'LONG' : 'SHORT';
      const closeQty = Math.abs(this.position.baseAssetQty);
      try {
        const closeOrder = await this.adapter.closePosition(this.config.symbol, side);
        // 平仓单无自定义 clientOrderId（如 Gate 回报 text="api"），必须落库
        // exchangeOrderId 并认领其 orderId，否则平仓成交无法归属本 run，
        // 清算盈亏全部丢失。
        if (closeOrder?.orderId) {
          this.ownOrderIds.add(closeOrder.orderId);
          this.emitCloseOrderPlaced(closeOrder, side === 'LONG' ? 'SELL' : 'BUY', closeQty);
        }
      } catch (err) {
        this.logger.error(`[${this.config.runCode}] Close position failed (attempt ${attempt}/${GridBotRunner.LIQUIDATION_MAX_ATTEMPTS}): ${(err as Error).message}`);
      }

      // 持仓刷新失败（接口抖动）视为"本次未清零"，继续重试；绝不让异常逃逸出本函数，
      // 否则会跳过下方的终态判定/残留告警/resolveLiquidationDone，使调用方挂死。
      try {
        const syncResult = await this.deps.truth.invalidateAndRefresh(this.config.symbol);
        this.position = syncResult.position;
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] Position refresh failed during liquidation (attempt ${attempt}/${GridBotRunner.LIQUIDATION_MAX_ATTEMPTS}): ${(err as Error).message}`);
      }

      if (this.fsmState.kind === 'LIQUIDATING') {
        this.fsmState = { ...this.fsmState, attemptCount: attempt };
      }

      if (!this.position || Math.abs(this.position.baseAssetQty) <= 1e-12) {
        break;
      }
      if (attempt < GridBotRunner.LIQUIDATION_MAX_ATTEMPTS && this.running) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }

    if (!this.position || Math.abs(this.position.baseAssetQty) <= 1e-12) {
      this.fsmState = { kind: 'LIQUIDATED', finalPnl: 0, closedAt: Date.now() };
    } else {
      // 重试耗尽仍有残留：不谎报已清算终态。注意本函数开头 cancelOwnOrders 已撤掉
      // 本会话的紧急止损 algo 单，故此刻交易所侧已无软件保护——必须发关键事件，由
      // 上层复核/强平兜底（用户停止路径有 forceCloseResidualAfterStop）并提醒用户手动平仓。
      const residualQty = this.position.baseAssetQty;
      this.logger.error(`[${this.config.runCode}] Liquidation incomplete: residual position ${residualQty} after ${GridBotRunner.LIQUIDATION_MAX_ATTEMPTS} attempts`);
      this.emitCriticalEvent({
        kind: 'RESIDUAL_POSITION',
        reason: 'LIQUIDATION_RESIDUAL',
        message: `Residual position ${residualQty} remains after ${GridBotRunner.LIQUIDATION_MAX_ATTEMPTS} liquidation attempts`,
      });
    }

    this.phase = 'IDLE';
    this.broadcastState();
    this.resolveLiquidationDone();

    setImmediate(() => this.stop().catch(() => {}));
  }

  /** 运行中且有非零持仓——需要紧急止损保护的状态。 */
  private hasProtectablePosition(): boolean {
    return (
      this.fsmState.kind === 'RUNNING' &&
      this.position !== null &&
      Math.abs(this.position.baseAssetQty) > 1e-12
    );
  }

  private async ensureEmergencyStopLoss(): Promise<void> {
    const { stopLossGridCount } = this.config;
    if (stopLossGridCount <= 0) return;
    if (this.permanentErrorPaused) return;

    const lines = deriveBoxLines(this.buildTargetPositionConfig());
    const allAlgos = await this.adapter.getAlgoOrders(this.config.symbol);
    const ownAlgos = allAlgos.filter((a) => this.isOwnAlgoOrder(a.clientOrderId));

    const emergencyPrice = lines.liquidationPrice;
    const hasOwnEmergency = ownAlgos.some((a) => Math.abs(a.triggerPrice - emergencyPrice) < 0.01);

    if (hasOwnEmergency) return;

    const side = this.config.direction === 'LONG' ? 'SELL' : 'BUY';
    const qty = Math.abs(this.position?.baseAssetQty ?? 0);
    if (qty <= 1e-12) return;

    // 无分隔符格式：OKX 去除非字母数字后必须原样保留，否则前缀匹配不上
    // 回报 id → hasOwnEmergency 永远 false → 每个 tick 重下被拒重复。
    const clientAlgoId = encodeAlgoClientOrderId(this.config.runCode, 'emergency', this.generateRandomSuffix());

    try {
      await this.adapter.createAlgoOrder(
        {
          symbol: this.config.symbol,
          side,
          qty,
          price: emergencyPrice,
          tif: 'GTC',
          clientOrderId: clientAlgoId,
          triggerPrice: emergencyPrice,
          triggerCondition: this.config.direction === 'LONG' ? 'price_below' : 'price_above',
          closePosition: true,
        },
        this.abortController.signal,
      );
      this.logger.log(`[${this.config.runCode}] Emergency stop-loss algo placed: ${side} @ ${emergencyPrice} (qty=${qty})`);
    } catch (err) {
      // 超长 id 属配置性永久错误（symbol 超出该所长度预算）：重试无意义，
      // 每 tick 重试就是 WARN 死循环。且"止损永久不可用但继续开仓"是风险
      // 敞口——转 PAUSED 停止交易（创建入口预检使此路径常态不可达）。
      if ((err as { code?: string }).code === 'CLIENT_ID_TOO_LONG') {
        this.pauseOnPermanentError('CLIENT_ID_TOO_LONG', (err as Error).message);
        return;
      }
      this.logger.warn(`[${this.config.runCode}] Failed to place emergency stop-loss: ${(err as Error).message}`);
    }
  }

  /**
   * 配置性永久错误：停止交易转 PAUSED 并经关键事件管线通知（持仓可能无止损
   * 裸露，用户必须立即知情）。USER_RESUME 复位标志后重试一次，仍失败再次
   * 落入此处，自然收敛。
   */
  private pauseOnPermanentError(reason: string, message: string): void {
    this.permanentErrorPaused = true;
    this.fsmState = { kind: 'PAUSED', reason: `${reason}: ${message}`, since: Date.now() };
    this.logger.error(`[${this.config.runCode}] Permanent config error (${reason}), pausing bot: ${message}`);
    this.emitCriticalEvent({ kind: 'PAUSED_PERMANENT_ERROR', reason, message });
    this.broadcastState();
  }

  private generateRandomSuffix(): string {
    return Math.random().toString(36).substring(2, 4);
  }

  private async reconcileOrphanOrders(syncResult: { algoOrders: AlgoOrder[] }): Promise<void> {
    const signal = this.abortController.signal;

    const orphanAlgos = syncResult.algoOrders.filter(
      (a) =>
        (a.clientOrderId?.includes('_algo_') || parseAlgoClientOrderId(a.clientOrderId)) &&
        !this.isOwnAlgoOrder(a.clientOrderId),
    );

    if (orphanAlgos.length === 0) return;

    this.logger.warn(
      `[${this.config.runCode}] Reconcile: found ${orphanAlgos.length} orphan algo orders`,
    );

    for (const a of orphanAlgos) {
      try {
        await this.adapter.cancelAlgoOrder(a.algoOrderId, this.config.symbol, signal);
        this.logger.warn(`[${this.config.runCode}] Reconcile: cancelled orphan algo ${a.algoOrderId} (${a.clientOrderId ?? 'no-clientId'})`);
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] Reconcile: cancel orphan algo ${a.algoOrderId} failed: ${(err as Error).message}`);
      }
    }
  }

  /**
   * 判断某挂单/回报是否属于本会话。
   * 网格单 clientOrderId = 去下划线的 sessionToken（新格式）；
   * 算法单 clientOrderId = 带下划线的 `${sessionCode}_...`（范围外，仍旧格式）。
   * 两类前缀互不相交，须分别匹配，否则冷启动时（ownOrderIds 已清空）无法认领
   * 自己上一会话的紧急止损算法单或其触发成交。
   */
  private isOwnOrder(clientOrderId: string | undefined, exchangeOrderId: string): boolean {
    if (this.ownOrderIds.has(exchangeOrderId)) return true;
    if (!clientOrderId) return false;
    return (
      clientOrderId.startsWith(sessionToken(this.config.runCode)) ||
      clientOrderId.startsWith(`${this.config.runCode}_`)
    );
  }

  /** 判断算法单是否属于本会话（新/旧/OKX 截断态三种格式，谓词统一在 utils）。 */
  private isOwnAlgoOrder(clientOrderId: string | undefined): boolean {
    return ownsSessionAlgoClientOrderId(clientOrderId, this.config.runCode);
  }

  private async cancelOwnOrders(symbol: string): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    const owned = (clientOrderId: string | undefined, id: string) =>
      this.isOwnOrder(clientOrderId, id);

    let openOrders: OrderResult[] = [];
    try {
      openOrders = await this.adapter.getOpenOrders(symbol);
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] cancelOwnOrders: getOpenOrders failed: ${(err as Error).message}`);
      failed.push(`getOpenOrders`);
    }

    for (const o of openOrders) {
      if (!owned(o.clientOrderId, o.orderId)) continue;
      if (!(await this.cancelWithRetry(o.orderId, symbol, 'cancelOrder'))) {
        failed.push(o.orderId);
      }
    }

    let algoOrders: AlgoOrder[] = [];
    try {
      algoOrders = await this.adapter.getAlgoOrders(symbol);
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] cancelOwnOrders: getAlgoOrders failed: ${(err as Error).message}`);
      failed.push(`getAlgoOrders`);
    }

    for (const a of algoOrders) {
      if (!owned(a.clientOrderId, a.algoOrderId)) continue;
      if (!(await this.cancelWithRetry(a.algoOrderId, symbol, 'cancelAlgoOrder'))) {
        failed.push(a.algoOrderId);
      }
    }

    return { failed };
  }

  private isStaleOrder(clientOrderId: string | undefined, orderId: string): boolean {
    if (this.isOwnOrder(clientOrderId, orderId)) return false;
    if (!clientOrderId) return false;
    const myToken = sessionToken(this.config.runCode);
    const myPrefix = `${this.config.runCode}_`;
    if (clientOrderId.startsWith(myToken) || clientOrderId.startsWith(myPrefix)) return false;
    const expectedSymbolPrefix = this.config.symbol.replace(/[/\\]/g, '');
    const parsed = parseClientOrderId(clientOrderId);
    if (parsed && parsed.symbol === expectedSymbolPrefix) return true;
    if (isLegacyClientOrderId(clientOrderId)) return true;
    if (clientOrderId.includes('_algo_')) return true;
    const algoParsed = parseAlgoClientOrderId(clientOrderId);
    if (algoParsed && algoParsed.token.startsWith(expectedSymbolPrefix)) return true;
    return false;
  }

  private async cancelStaleOrdersOnSymbol(symbol: string): Promise<void> {
    let staleCount = 0;
    let failedCount = 0;

    try {
      const openOrders = await this.adapter.getOpenOrders(symbol);
      for (const o of openOrders) {
        if (!this.isStaleOrder(o.clientOrderId, o.orderId)) continue;
        staleCount++;
        this.logger.warn(`[${this.config.runCode}] Cancelling stale order ${o.orderId} (clientOrderId=${o.clientOrderId})`);
        if (!(await this.cancelWithRetry(o.orderId, symbol, 'cancelOrder'))) {
          failedCount++;
        }
      }
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] cancelStaleOrdersOnSymbol (grid) failed: ${(err as Error).message}`);
    }

    try {
      const algoOrders = await this.adapter.getAlgoOrders(symbol);
      for (const a of algoOrders) {
        if (!this.isStaleOrder(a.clientOrderId, a.algoOrderId)) continue;
        staleCount++;
        this.logger.warn(`[${this.config.runCode}] Cancelling stale algo order ${a.algoOrderId} (clientOrderId=${a.clientOrderId})`);
        if (!(await this.cancelWithRetry(a.algoOrderId, symbol, 'cancelAlgoOrder'))) {
          failedCount++;
        }
      }
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] cancelStaleOrdersOnSymbol (algo) failed: ${(err as Error).message}`);
    }

    if (staleCount > 0) {
      const msg = failedCount > 0
        ? `Cleaned ${staleCount - failedCount}/${staleCount} stale orders on ${symbol} (${failedCount} failed)`
        : `Cleaned ${staleCount} stale orders on ${symbol}`;
      this.logger.log(`[${this.config.runCode}] ${msg}`);
    }
  }

  private static readonly CANCEL_RETRY_ATTEMPTS = 3;
  private static readonly CANCEL_RETRY_BASE_MS = 500;

  private async cancelWithRetry(
    orderId: string, symbol: string, method: 'cancelOrder' | 'cancelAlgoOrder',
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= GridBotRunner.CANCEL_RETRY_ATTEMPTS; attempt++) {
      try {
        if (method === 'cancelOrder') {
          await this.adapter.cancelOrder(orderId, symbol, this.abortController.signal);
        } else {
          await this.adapter.cancelAlgoOrder(orderId, symbol, this.abortController.signal);
        }
        return true;
      } catch (err) {
        const isLast = attempt === GridBotRunner.CANCEL_RETRY_ATTEMPTS;
        this.logger.warn(
          `[${this.config.runCode}] ${method}(${orderId}) attempt ${attempt}/${GridBotRunner.CANCEL_RETRY_ATTEMPTS} failed: ${(err as Error).message}`,
        );
        if (isLast) return false;
        const delay = GridBotRunner.CANCEL_RETRY_BASE_MS * (2 ** (attempt - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    return false;
  }

  private broadcastState(): void {
    if (this.deps.onStateChange) {
      this.deps.onStateChange(this.buildState());
    }
  }

  private emitCriticalEvent(event: RunnerCriticalEvent): void {
    try {
      const result = this.deps.onCriticalEvent?.(event) as unknown;
      if (result instanceof Promise) {
        result.catch((err: unknown) => {
          this.logger.warn(`[${this.config.runCode}] onCriticalEvent async callback failed: ${(err as Error).message}`);
        });
      }
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] onCriticalEvent callback failed: ${(err as Error).message}`);
    }
  }

  private async recordFill(
    side: 'BUY' | 'SELL',
    price: number,
    qty: number,
    gridPrice?: number,
    tif?: 'POC' | 'GTC',
    exchangeOrderId?: string,
    exchangeClientOrderId?: string,
  ): Promise<void> {
    this.sessionNetFilledQty += side === 'BUY' ? qty : -qty;
    this.lastOwnFillAtMs = Date.now();

    let gridIndex = -1;
    try {
      gridIndex = this.computeGridIndex(gridPrice ?? price);
    } catch {
      gridIndex = -1;
    }

    // 计算策略节省金额（广播为非权威路径：整笔成交从下单前仓位一次算）
    let savings = 0;
    let savingsRate = 0;
    let avgGridPrice = 0;
    try {
      const targetConfig = this.buildTargetPositionConfig();
      const preOrderPosition = this.activeOrder?.preOrderPosition ?? this.position?.baseAssetQty ?? 0;
      const r = computeFillSavings({
        side,
        price,
        config: targetConfig,
        preOrderPosition,
        prevFilledQty: 0,
        thisFillQty: qty,
        // 与权威落库口径一致：进场首笔市价建仓不计超额收益（广播 savings 同步归 0）。
        isEntry: this.isInitialEntryBuild(side, preOrderPosition),
      });
      savings = r.savings;
      savingsRate = r.savingsRate;
      avgGridPrice = r.avgGridPrice;
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] Failed to compute savings: ${(err as Error).message}`);
    }

    const fillId = exchangeClientOrderId
      ? `${this.config.runCode}_fill_${exchangeClientOrderId}`
      : `${this.config.runCode}_fill_${this.nextSeq}`;

    if (this.deps.onFill) {
      const payload: FillPayload = {
        sessionCode: this.config.runCode,
        id: fillId,
        side: side.toLowerCase() as 'buy' | 'sell',
        price,
        qty,
        gridIndex,
        route: tif ?? 'POC',
        // fee 由权威成交摄入(FillIngestionService)从交易所回报记账；此处广播仅供 UI 实时展示，暂置 0。
        fee: 0,
        ts: Date.now(),
        savings,
        savingsRate,
        avgGridPrice,
      };

      try {
        this.deps.onFill(payload);
      } catch (err) {
        this.logger.warn(`[${this.config.runCode}] onFill callback error: ${(err as Error).message}`);
      }
    }

    // 审计用 EventLog（业务读路径已改读权威 Fill 表；此 FILL 事件仅作审计/冷启动持仓推断）。
    if (this.deps.persistence) {
      try {
        await this.deps.persistence.writeEventLog(
          this.config.configId,
          {
            type: 'FILL',
            orderId: exchangeOrderId ?? this.activeOrder?.orderId ?? '',
            clientOrderId: exchangeClientOrderId ?? this.activeOrder?.clientOrderId ?? '',
            fillQty: qty,
            fillPrice: price,
            side,
            gridIndex,
            savings,
            savingsRate,
          },
          this.nextSeq,
          this.config.runCode,
        );
      } catch (err) {
        this.logger.error(`[${this.config.runCode}] CRITICAL: Failed to persist FILL event: ${(err as Error).message}`);
      }
    }
  }

  private emitOrderPlaced(
    clientOrderId: string,
    exchangeOrderId: string,
    side: 'BUY' | 'SELL',
    qty: number,
    price: number,
    gridPrice: number | undefined,
  ): void {
    if (!this.deps.onOrderPlaced) return;
    let gridIndex = -1;
    try {
      gridIndex = this.computeGridIndex(gridPrice ?? price);
    } catch {
      gridIndex = -1;
    }
    const preOrderPosition = this.position?.baseAssetQty ?? 0;
    try {
      this.deps.onOrderPlaced({
        runCode: this.config.runCode,
        clientOrderId,
        exchangeOrderId,
        side,
        qty,
        price,
        gridIndex,
        orderType: side === 'BUY' ? 'GRID_BUY' : 'GRID_SELL',
        isAlgo: false,
        preOrderPosition,
        isEntry: this.isInitialEntryBuild(side, preOrderPosition),
      });
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] onOrderPlaced callback error: ${(err as Error).message}`);
    }
  }

  private computeGridIndex(price: number): number {
    const config = this.buildTargetPositionConfig();
    const idx = priceToGridIndex(price, config);
    return idx ?? -1;
  }

  /**
   * 平仓单落库：clientOrderId 置空（交易所回报的是平台默认值如 Gate "api"，
   * 并非本机器人的 id，存入会被 byClient 匹配误用），归属只靠 exchangeOrderId。
   */
  private emitCloseOrderPlaced(closeOrder: OrderResult, side: 'BUY' | 'SELL', qty: number): void {
    if (!this.deps.onOrderPlaced) return;
    try {
      this.deps.onOrderPlaced({
        runCode: this.config.runCode,
        clientOrderId: '',
        exchangeOrderId: closeOrder.orderId,
        side,
        qty: closeOrder.filledQty || qty,
        price: closeOrder.avgFillPrice ?? 0,
        gridIndex: -1,
        orderType: 'CLOSE',
        isAlgo: false,
        preOrderPosition: this.position?.baseAssetQty ?? 0,
        isEntry: false,
      });
    } catch (err) {
      this.logger.warn(`[${this.config.runCode}] onOrderPlaced callback error: ${(err as Error).message}`);
    }
  }

  private generateClientOrderId(side: string): string {
    const seq = this.nextSeq;
    if (!this.config.runCode || typeof this.config.runCode !== 'string') {
      throw new Error('Invalid botId');
    }
    if (side !== 'BUY' && side !== 'SELL') {
      throw new Error('Invalid side');
    }
    return encodeClientOrderId(this.config.runCode, side as 'BUY' | 'SELL', seq);
  }

  private buildFsmConfig() {
    const lines = deriveBoxLines(this.buildTargetPositionConfig());
    return {
      takeProfitPrice: this.config.takeProfitPrice,
      mainGridDepth: lines.mainGridDepth,
      stopLossGridCount: this.config.stopLossGridCount,
      direction: this.config.direction as 'LONG' | 'SHORT',
      activationPrice: toPrice(lines.mainGridDepth / 2, {
        takeProfitPrice: this.config.takeProfitPrice,
        direction: this.config.direction as 'LONG' | 'SHORT',
      }),
    };
  }

  /** 启动时拉取交易所交易规则缓存 minNotional（USDT 名义，三所通用：策略层 qty 为基础币、
   * notional = qty×price 即 USDT）。适配器未实现或拉取失败均降级为 0（不做名义预校验），
   * 不阻塞启动——临时网络故障不该挡机器人上线，运行期仍有交易所兜底拒单。 */
  private async loadMarketConstraints(): Promise<void> {
    if (!this.adapter.getMarketInfo) return;
    try {
      const info = await this.adapter.getMarketInfo(this.config.symbol);
      this.marketMinNotional = info.minNotional ?? 0;
      this.logger.log(`[${this.config.runCode}] Market constraints: minNotional=${this.marketMinNotional}`);
    } catch (err) {
      this.logger.warn(
        `[${this.config.runCode}] getMarketInfo failed, skipping minNotional pre-check: ${(err as Error).message}`,
      );
    }
  }

  private buildStrategyConfig() {
    return {
      takeProfitPrice: this.config.takeProfitPrice,
      mainGridCount: this.config.mainGridCount,
      mainGridStep: this.config.mainGridStep,
      mainGridPortionSize: this.config.mainGridPortionSize,
      direction: this.config.direction as 'LONG' | 'SHORT',
      reorderThreshold: this.config.reorderThreshold,
      stopLossGridCount: this.config.stopLossGridCount,
      stopLossGridStep: this.config.stopLossGridStep,
      isolationStep: this.config.isolationStep,
      gtcThreshold: this.config.gtcThreshold,
      minNotional: this.marketMinNotional,
    };
  }

  private buildTargetPositionConfig(): TargetPositionConfig {
    return {
      takeProfitPrice: this.config.takeProfitPrice,
      mainGridCount: this.config.mainGridCount,
      mainGridStep: this.config.mainGridStep,
      mainGridPortionSize: this.config.mainGridPortionSize,
      stopLossGridCount: this.config.stopLossGridCount,
      stopLossGridStep: this.config.stopLossGridStep,
      isolationStep: this.config.isolationStep,
      direction: this.config.direction as 'LONG' | 'SHORT',
    };
  }

  private async tickerPump(): Promise<void> {
    while (this.running) {
      try {
        for await (const ticker of this.adapter.subscribeTicker(this.config.symbol)) {
          if (!this.running) break;
          await this.onTickerUpdate(ticker);
        }
      } catch (err) {
        // 自愈：下方 while(running) 循环会在 1s 后重新订阅，多为瞬时网络抖动/流 stall，故 warn 而非 error。
        this.logger.warn(`[${this.config.runCode}] Ticker pump error (will resubscribe): ${(err as Error).message}`);
      }
      if (this.running) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async orderUpdatePump(): Promise<void> {
    while (this.running) {
      try {
        for await (const update of this.adapter.subscribeOrderUpdates()) {
          if (!this.running) break;

          const isOwn = this.isOwnOrder(update.clientOrderId, update.orderId);
          if (!isOwn) continue;

          if (update.status === 'FILLED') {
            this.resolveOrderSettlement('FILLED', 'ws', update);
          } else if (update.status === 'CANCELLED' || update.status === 'REJECTED') {
            this.resolveOrderSettlement('CANCELLED', 'ws', update);
          }
        }
      } catch (err) {
        // 自愈：下方 while(running) 循环会在 2s 后重新订阅，多为瞬时网络抖动，故 warn 而非 error。
        this.logger.warn(`[${this.config.runCode}] Order update pump error (will resubscribe): ${(err as Error).message}`);
      }
      if (this.running) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async fillsPump(): Promise<void> {
    while (this.running) {
      try {
        for await (const fill of this.adapter.subscribeFills()) {
          if (!this.running) break;
          if (!this.isOwnOrder(fill.clientOrderId, fill.orderId)) continue;
          try {
            this.deps.onFillEvent?.(fill);
          } catch (err) {
            this.logger.warn(`[${this.config.runCode}] onFillEvent callback error: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        // 自愈：下方 while(running) 循环会重新订阅，多为瞬时网络抖动，故 warn 而非 error。
        this.logger.warn(`[${this.config.runCode}] Fills pump error (will resubscribe): ${(err as Error).message}`);
      }
      if (this.running) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}

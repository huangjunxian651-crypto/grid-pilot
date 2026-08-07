import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { GridBotRunner, type BotConfig } from './grid-bot-runner';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type { BotState, BotFsmState } from '../types/bot-state.types';
import type { AlgoOrder } from '../types/exchange.types';
import type { SyncResult } from '../exchange-truth-service/exchange-truth.service';
import type { BotFsm } from '../fsm/bot-fsm';
import type { StrategyEngine } from '../strategy/strategy-engine';
import type { ExecutionEngine } from '../execution/execution-engine';
import type { ExchangeTruthService } from '../exchange-truth-service/exchange-truth.service';
import type { BotStateReconstructor, RecoveryResult } from '../reconstructor/bot-state-reconstructor';
import type { PersistenceService } from '../persistence/persistence.service';

const createMockAdapter = (): ExchangeAdapter => ({
  exchange: 'BINANCE',
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  subscribeTicker: vi.fn().mockImplementation(async function* () {
    yield { symbol: 'ETH/USDT', bid: 1999, ask: 2001, last: 2000, timestamp: Date.now() };
  }),
  subscribeOrderUpdates: vi.fn().mockImplementation(async function* () {}),
  subscribePosition: vi.fn().mockImplementation(async function* () {}),
  subscribeFills: vi.fn().mockImplementation(async function* () {}),
  getTicker: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', bid: 1999, ask: 2001, last: 2000, timestamp: Date.now() }),
  createOrder: vi.fn().mockResolvedValue({ orderId: 'o1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 }),
  cancelOrder: vi.fn().mockResolvedValue(undefined),
  getOpenOrders: vi.fn().mockResolvedValue([]),
  createAlgoOrder: vi.fn().mockResolvedValue({ orderId: 'a1', clientOrderId: 'ca1', status: 'PENDING', filledQty: 0, algoOrderId: 'a1' }),
  cancelAlgoOrder: vi.fn().mockResolvedValue(undefined),
  getAlgoOrders: vi.fn().mockResolvedValue([]),
  cancelAllOrders: vi.fn().mockResolvedValue(undefined),
  cancelAllAlgoOrders: vi.fn().mockResolvedValue(undefined),
  closePosition: vi.fn().mockResolvedValue({ orderId: 'o2', clientOrderId: 'c2', status: 'FILLED', filledQty: 0.5 }),
  getPosition: vi.fn().mockResolvedValue({ symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' }),
  getBalance: vi.fn().mockResolvedValue({ asset: 'USDT', free: 1000, locked: 0 }),
  setLeverage: vi.fn().mockResolvedValue(undefined),
  setMarginMode: vi.fn().mockResolvedValue(undefined),
  getPositionMode: vi.fn().mockResolvedValue(true),
  setPositionMode: vi.fn().mockResolvedValue(undefined),
  getMarketInfo: vi.fn().mockResolvedValue({
    symbol: 'ETH/USDT',
    rawSymbol: 'ETHUSDT',
    minQty: 0.001,
    minNotional: 20,
    stepSize: 0.001,
    tickSize: 0.01,
    contractSize: 1,
    makerFeeRate: 0.0002,
    takerFeeRate: 0.0005,
  }),
});

const createMockDeps = () => ({
  fsm: {
    transition: vi.fn().mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } }),
  } as unknown as BotFsm,
  strategy: {
    computeDesiredOrders: vi.fn().mockReturnValue({ action: 'HOLD', reason: 'test' }),
    computeReorder: vi.fn().mockReturnValue({ shouldReorder: false }),
  } as unknown as StrategyEngine,
  execution: {
    execute: vi.fn().mockResolvedValue({ outcome: 'PLACED', orderId: 'ex1' }),
  } as unknown as ExecutionEngine,
  truth: {
    invalidateAndRefresh: vi.fn().mockResolvedValue({
      position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
      openOrders: [],
      algoOrders: [],
      timestamp: Date.now(),
    } as SyncResult),
  } as unknown as ExchangeTruthService,
  reconstructor: {
    reconstruct: vi.fn().mockImplementation((): RecoveryResult => ({
      fsmState: { kind: 'RUNNING', since: Date.now() },
      position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
      activeOrder: null,
      lastPrice: 2000,
      ordersToCancel: [],
      nextSeq: 1,
      gridActiveSince: undefined,
      stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
    })),
  } as unknown as BotStateReconstructor,
  persistence: {
    writeSnapshot: vi.fn().mockResolvedValue(undefined),
    writeEventLog: vi.fn().mockResolvedValue(undefined),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    getEventLogs: vi.fn().mockResolvedValue([]),
    getMaxOrderSeq: vi.fn().mockResolvedValue(0),
  } as unknown as PersistenceService,
  onOrderPlaced: vi.fn(),
});

const createBotConfig = (): BotConfig => ({
  configId: 'cfg1',
  runCode: 'test-session',
  symbol: 'ETH/USDT',
  direction: 'LONG',
  takeProfitPrice: 2200,
  mainGridCount: 10,
  mainGridStep: 36,
  mainGridPortionSize: 0.01,
  leverage: 10,
  stopLossGridCount: 4,
  stopLossGridStep: 10,
  isolationStep: 2.5,
  reorderThreshold: 0.0002,
  gtcThreshold: 1.0,
  trailingEntry: false,
  pollIntervalMs: 10000,
});

const createInitialState = (): BotState => ({
  fsm: { kind: 'RUNNING', since: Date.now() },
  config: {
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 36,
    mainGridPortionSize: 0.01,
    direction: 'LONG',
    reorderThreshold: 0.0002,
    stopLossGridCount: 4,
    stopLossGridStep: 10,
    isolationStep: 2.5,
    leverage: 10,
    gtcThreshold: 1.0,
    trailingEntry: false,
  },
  position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
  openOrders: [],
  lastPrice: 2000,
  lastPriceTime: Date.now(),
  orderManager: { activeOrder: null, recentlyCancelled: new Set() },
  nextSeq: 1,
  stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
});

async function startRunner(
  runner: GridBotRunner,
  adapter: ExchangeAdapter,
  deps: ReturnType<typeof createMockDeps>,
  state?: BotState,
) {
  adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
  adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
  adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});
  adapter.subscribeFills = vi.fn().mockImplementation(async function* () {});
  await runner.start(state);
}

describe('GridBotRunner', () => {
  let runner: GridBotRunner;
  let adapter: ExchangeAdapter;
  let deps: ReturnType<typeof createMockDeps>;
  let config: BotConfig;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;
  let loggerWarnSpy: ReturnType<typeof vi.spyOn>;
  let loggerLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    adapter = createMockAdapter();
    deps = createMockDeps();
    config = createBotConfig();
    runner = new GridBotRunner(config, adapter, deps);
  });

  afterEach(async () => {
    if (runner.isRunning()) {
      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    }
    vi.useRealTimers();
    vi.clearAllMocks();
    loggerErrorSpy.mockRestore();
    loggerWarnSpy.mockRestore();
    loggerLogSpy.mockRestore();
  });

  describe('Lifecycle', () => {
    it('start() validates config, connects adapter, cancels stale orders, starts subs', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      expect(runner.isRunning()).toBe(true);
      expect(adapter.connect).toHaveBeenCalledTimes(1);
      expect(adapter.setLeverage).toHaveBeenCalledWith('ETH/USDT', 10);
      expect(adapter.setMarginMode).toHaveBeenCalledWith('ETH/USDT', true);
      expect(adapter.getOpenOrders).toHaveBeenCalled();
      expect(adapter.subscribeTicker).toHaveBeenCalledWith('ETH/USDT');
      expect(adapter.subscribeOrderUpdates).toHaveBeenCalled();
      expect(runner.getState()).toBeTruthy();
    });

    it('账户处于对冲模式时，启动切回单向模式——否则 OKX 每单必拒 "Parameter posSide error"', async () => {
      // 2026-08-04 生产事故：OKX 账户为 long_short_mode，下单必须带 posSide，
      // 而全代码库（三个适配器）都按单向模式设计、从不发 posSide，导致该机器人
      // 连续拒单 592 次、网格停摆数小时。接口文档第 7 行早已写明启动序列
      // setPositionMode → setLeverage → setMarginMode，但第一步从未被实现。
      adapter.getPositionMode = vi.fn().mockResolvedValue(false); // 对冲模式

      await startRunner(runner, adapter, deps, createInitialState());

      expect(adapter.setPositionMode).toHaveBeenCalledWith(true);
    });

    it('账户已是单向模式时，不触碰账户设置（不做无谓的全局改动）', async () => {
      adapter.getPositionMode = vi.fn().mockResolvedValue(true); // 已单向

      await startRunner(runner, adapter, deps, createInitialState());

      expect(adapter.setPositionMode).not.toHaveBeenCalled();
    });

    it('切换持仓模式失败（如有未平持仓）不中断启动——持仓保护优先于模式纠正', async () => {
      // OKX 在有持仓/挂单时拒绝切换持仓模式。此时若让启动抛错中断，
      // 已建仓位会失去后续的止损与网格管理，比模式不对更危险。
      adapter.getPositionMode = vi.fn().mockResolvedValue(false);
      adapter.setPositionMode = vi.fn().mockRejectedValue(new Error('Position exists, cannot switch'));

      await expect(startRunner(runner, adapter, deps, createInitialState())).resolves.toBeUndefined();
      expect(runner.isRunning()).toBe(true);
      expect(adapter.setPositionMode).toHaveBeenCalledWith(true);
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('setPositionMode'));
    });

    it('读取持仓模式失败（网络抖动等）不中断启动，且报错要指名 getPositionMode 而非误报成写入失败', async () => {
      // 读失败与写失败混为一谈会误导下次事故的排查方向：前者是查不到模式（可能只是
      // 瞬时 5xx/限流），后者是切换被交易所拒绝（通常是有持仓）。两者处置完全不同。
      adapter.getPositionMode = vi.fn().mockRejectedValue(new Error('temporary 5xx'));

      await expect(startRunner(runner, adapter, deps, createInitialState())).resolves.toBeUndefined();
      expect(runner.isRunning()).toBe(true);
      expect(adapter.setPositionMode).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('getPositionMode'));
    });

    it('start() when already running warns and returns early', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      const connectCalls = adapter.connect.mock.calls.length;

      await runner.start(createInitialState());

      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Already running'));
      expect(adapter.connect).toHaveBeenCalledTimes(connectCalls);
    });

    it('start() rejects invalid grid config', async () => {
      config.stopLossGridCount = 10;
      config.stopLossGridStep = 100;
      const badRunner = new GridBotRunner(config, adapter, deps);

      await expect(badRunner.start(createInitialState())).rejects.toThrow(/config/i);
      expect(badRunner.isRunning()).toBe(false);
    });

    it('stop() cancels own orders, disconnects adapter', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      expect(runner.isRunning()).toBe(true);

      const stopPromise = runner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;

      expect(runner.isRunning()).toBe(false);
      expect(adapter.disconnect).toHaveBeenCalledTimes(1);
      expect(runner.getState()).toBeNull();
    });

    it('isRunning() returns correct state', async () => {
      expect(runner.isRunning()).toBe(false);
      await startRunner(runner, adapter, deps, createInitialState());
      expect(runner.isRunning()).toBe(true);
    });

    it('getState() returns null when not running', () => {
      expect(runner.getState()).toBeNull();
    });

    it('sessionCode and symbol getters return config values', () => {
      expect(runner.sessionCode).toBe('test-session');
      expect(runner.symbol).toBe('ETH/USDT');
    });

    it('submitEvent with user actions does not throw when not running', () => {
      expect(() => runner.submitEvent({ type: 'USER_PAUSE' })).not.toThrow();
    });

    it('start() launches the fills pump (subscribeFills called)', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      expect(adapter.subscribeFills).toHaveBeenCalled();
    });

    it('submitUserAction delegates to trigger resolver', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'PAUSED', reason: 'user', since: Date.now() } });

      runner.submitUserAction('USER_PAUSE');
      await vi.advanceTimersByTimeAsync(50);

      expect(deps.fsm.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'USER_PAUSE' }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('Main Loop — Timer Trigger', () => {
    it('timer trigger triggers REST position query, strategy computation, and order placement', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.truth.invalidateAndRefresh).toHaveBeenCalledWith('ETH/USDT');
      expect(deps.strategy.computeDesiredOrders).toHaveBeenCalled();
      expect(deps.execution.execute).toHaveBeenCalled();
    });

    it('emits onOrderPlaced with order details when a grid order is placed', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        gridPrice: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.onOrderPlaced).toHaveBeenCalled();
      const arg = (deps.onOrderPlaced as any).mock.calls[0][0];
      expect(arg).toMatchObject({
        runCode: 'test-session',
        clientOrderId: expect.any(String),
        exchangeOrderId: 'ex1',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        orderType: 'GRID_BUY',
        isAlgo: false,
      });
      expect(typeof arg.gridIndex).toBe('number');
      expect(deps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({ preOrderPosition: expect.any(Number) }),
      );
    });

    it('把 currentDecision.tif 透传进 onOrderPlaced 的 payload（供 route 数据落库）', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        gridPrice: 2100,
        tif: 'POC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({ tif: 'POC' }),
      );
    });

    it('从 0 仓位的首单建仓标记 isEntry=true（进入箱体的市价建仓，不计超额收益）', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.05, price: 2100, gridPrice: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'BUY', orderType: 'GRID_BUY', isEntry: true }),
      );
    });

    it('持仓非 0 时的网格加仓单标记 isEntry=false（仅首笔进场建仓算 entry）', async () => {
      deps.truth.invalidateAndRefresh.mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 2000, leverage: 1, marginType: 'CROSS' },
        openOrders: [], algoOrders: [], timestamp: Date.now(),
      } as SyncResult);
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 1900, gridPrice: 1900, tif: 'POC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'BUY', isEntry: false }),
      );
    });

    it('isEntry 阈值固化：下单前仓位 ≤ 半个 portion(flatEps) 才算进场建仓，略高于则按普通网格', async () => {
      // 不变式：箱体内「从 0 加仓」仅发生于首次进场（卖到顶进 TAKE_PROFIT 终态、不会从 0 回补）。
      // flatEps = mainGridPortionSize(0.01) × 0.5 = 0.005。固化阈值边界，防后续重构破坏不变式而无测试拦截。
      // 略高于阈值（0.006 > 0.005）→ 普通网格加仓，isEntry=false
      deps.truth.invalidateAndRefresh.mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.006, quoteAssetQty: -12, entryPrice: 2000, leverage: 1, marginType: 'CROSS' },
        openOrders: [], algoOrders: [], timestamp: Date.now(),
      } as SyncResult);
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 1900, gridPrice: 1900, tif: 'POC', reason: 'test',
      });
      await vi.advanceTimersByTimeAsync(10000);
      expect(deps.onOrderPlaced).toHaveBeenCalledWith(expect.objectContaining({ side: 'BUY', isEntry: false }));
    });

    it('HOLD decision does not place an order', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'nothing to do' });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).not.toHaveBeenCalled();
    });

    it('PAUSED state ignores timer triggers', async () => {
      const state = createInitialState();
      state.fsm = { kind: 'PAUSED', reason: 'user', since: Date.now() };
      await startRunner(runner, adapter, deps, state);

      deps.strategy.computeDesiredOrders.mockClear();

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.strategy.computeDesiredOrders).not.toHaveBeenCalled();
    });
  });

  describe('Exchange constraint injection (minNotional)', () => {
    it('start() 拉取交易规则并把 minNotional 注入策略配置（拦下会被交易所拒的小单）', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'test' });

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.getMarketInfo).toHaveBeenCalledWith('ETH/USDT');
      const lastCall = deps.strategy.computeDesiredOrders.mock.calls.at(-1)!;
      expect(lastCall[2]).toMatchObject({ minNotional: 20 });
    });

    it('getMarketInfo 拉取失败时启动不崩溃，降级为不做名义预校验', async () => {
      (adapter.getMarketInfo as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));

      await expect(
        startRunner(runner, adapter, deps, createInitialState()),
      ).resolves.toBeUndefined();
      expect(runner.isRunning()).toBe(true);
    });

    it('start() 同时把 minQty 注入策略配置（此前只透传 minNotional，OKX/Gate.io 的 minQty 校验形同虚设）', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'test' });

      await vi.advanceTimersByTimeAsync(10000);

      const lastCall = deps.strategy.computeDesiredOrders.mock.calls.at(-1)!;
      expect(lastCall[2]).toMatchObject({ minQty: 0.001 });
    });
  });

  describe('Order Rejection → Immediate Retry', () => {
    it('on REJECTED outcome, retries with latest WS price without REST query', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let callCount = 0;
      deps.execution.execute.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'would not match' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ex2' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 1998,
        tif: 'GTC',
        reason: 'retry',
      });

      (runner as any).lastTicker = { bid: 1997, ask: 1999, last: 1998 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(callCount).toBeGreaterThanOrEqual(2);
      const lastCall = deps.strategy.computeDesiredOrders.mock.calls.at(-1)!;
      expect(lastCall[0]).toBe(1998);
    });
  });

  describe('Rejection Backoff', () => {
    it('allows up to MAX_FAST_REJECTIONS without delay', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let rejections = 0;
      deps.execution.execute.mockImplementation(() => {
        rejections++;
        if (rejections <= 3) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'margin' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ex-ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 2099, ask: 2101, last: 2100 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(rejections).toBeGreaterThanOrEqual(3);
    });

    it('applies exponential backoff after MAX_FAST_REJECTIONS', async () => {
      // 退避延迟含 Math.random() 抖动（0.75~1.25 倍），固定推进时间会偶发跨不过随机边界 →
      // 把 random 钉到 0.5（抖动因子=1.0，延迟为精确的 2000/4000ms），消除测试 flakiness。
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
      try {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let rejections = 0;
      deps.execution.execute.mockImplementation(() => {
        rejections++;
        return Promise.resolve({ outcome: 'REJECTED', error: 'margin' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 2099, ask: 2101, last: 2100 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(rejections).toBe(3);

      await vi.advanceTimersByTimeAsync(5000);

      expect(rejections).toBe(4);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it('resets consecutiveRejections on successful PLACED', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let callIdx = 0;
      deps.execution.execute.mockImplementation(() => {
        callIdx++;
        if (callIdx <= 2) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'margin' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ex-ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 2099, ask: 2101, last: 2100 };

      await vi.advanceTimersByTimeAsync(10000);

      expect((runner as any).consecutiveRejections).toBe(0);
    });

    it('stops retrying after MAX_CONSECUTIVE_REJECTIONS', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let rejections = 0;
      deps.execution.execute.mockImplementation(() => {
        rejections++;
        return Promise.resolve({ outcome: 'REJECTED', error: 'margin' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 2099, ask: 2101, last: 2100 };

      (runner as any).consecutiveRejections = 49;

      await vi.advanceTimersByTimeAsync(10000);

      expect(rejections).toBe(1);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('consecutive rejections, exiting order loop'));
    });
  });

  describe('Order Placed → Wait for Settlement', () => {
    it('execution returns PLACED, runner enters ORDER_ACTIVE phase', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(runner.getActiveOrder()).not.toBeNull();
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');
    });

    it('order FILLED resolves settlement and clears active order', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      (runner as any).resolveOrderSettlement('FILLED');
      await vi.advanceTimersByTimeAsync(50);

      expect(runner.getActiveOrder()).toBeNull();
      expect(runner.getPhase()).toBe('IDLE');
    });
  });

  describe('Price Invalidation — Order Active', () => {
    it('ticker update with different strategy side resolves order as CANCELLED', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'SELL',
        qty: 0.01,
        price: 2150,
        tif: 'GTC',
        reason: 'flip',
      });
      deps.strategy.computeReorder.mockReturnValue({ shouldReorder: false });

      const position = { symbol: 'ETH/USDT', baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 1900, leverage: 10, marginType: 'CROSS' as const };
      (runner as any).position = position;

      await (runner as any).onTickerUpdate({
        symbol: 'ETH/USDT',
        bid: 2149,
        ask: 2151,
        last: 2150,
        timestamp: Date.now(),
      });

      await vi.advanceTimersByTimeAsync(50);

      expect(runner.getPhase()).toBe('IDLE');
    });

    it('撤换单计入 stats.totalReorders——改单次数不再恒 0 (OBS-B)', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'SELL', qty: 0.01, price: 2150, tif: 'GTC', reason: 'flip',
      });
      deps.strategy.computeReorder.mockReturnValue({ shouldReorder: false });
      (runner as any).position = { symbol: 'ETH/USDT', baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 1900, leverage: 10, marginType: 'CROSS' as const };

      await (runner as any).onTickerUpdate({ symbol: 'ETH/USDT', bid: 2149, ask: 2151, last: 2150, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(50);

      expect(runner.getState()?.stats.totalReorders).toBe(1);
    });
  });

  describe('Liquidation', () => {
    it('USER_LIQUIDATE cancels active order and closes position', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.fsm.transition.mockReturnValue({
        newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 },
        action: 'LIQUIDATE_ALL',
      });

      runner.submitUserAction('USER_LIQUIDATE');
      await vi.advanceTimersByTimeAsync(50);

      expect(adapter.getOpenOrders).toHaveBeenCalled();
      expect(adapter.closePosition).toHaveBeenCalledWith('ETH/USDT', 'LONG');
    });

    it('FSM LIQUIDATING from tick cancels active order and closes position', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.truth.invalidateAndRefresh.mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });

      deps.fsm.transition.mockReturnValue({
        newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 },
        action: 'LIQUIDATE_ALL',
      });
      adapter.closePosition.mockClear();

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.closePosition).toHaveBeenCalledTimes(1);
    });

    it('LIQUIDATING does not place grid orders', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.fsm.transition.mockReturnValue({
        newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 },
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.strategy.computeDesiredOrders).not.toHaveBeenCalled();
    });

    it('平仓单通过 onOrderPlaced 落库，成交才能归属本 run（清算盈亏不丢失）', async () => {
      // closePosition 下的市价平仓单若不落库，其成交（Gate 回报 text="api"）
      // 永远无法 resolve 到 Order 行，LIQUIDATED run 的平仓盈亏全部丢失。
      adapter.closePosition = vi.fn().mockResolvedValue({
        orderId: 'close-ex-1',
        clientOrderId: 'api',
        status: 'FILLED',
        filledQty: 0.5,
        avgFillPrice: 1990,
      });
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.fsm.transition.mockReturnValue({
        newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 },
        action: 'LIQUIDATE_ALL',
      });

      runner.submitUserAction('USER_LIQUIDATE');
      await vi.advanceTimersByTimeAsync(50);

      expect(deps.onOrderPlaced).toHaveBeenCalledWith(
        expect.objectContaining({
          exchangeOrderId: 'close-ex-1',
          orderType: 'CLOSE',
          side: 'SELL',
          qty: 0.5,
          isEntry: false,
        }),
      );
    });

    it('USER_LIQUIDATE 在 tick 进行中提交不丢失——tick 结束后立即平仓 (BUG-07)', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      // TICK 保持 RUNNING，仅 USER_LIQUIDATE 转 LIQUIDATING——隔离"事件投递"本身
      deps.fsm.transition.mockImplementation((_st: unknown, ev: { type: string }) =>
        ev.type === 'USER_LIQUIDATE'
          ? { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 }, action: 'LIQUIDATE_ALL' }
          : { newState: { kind: 'RUNNING', since: Date.now() } },
      );

      // 下一个 tick 卡在交易所刷新（模拟慢 REST），此期间主循环不在等待触发器
      let releaseRefresh!: () => void;
      deps.truth.invalidateAndRefresh.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefresh = () =>
              resolve({ position: state.position, openOrders: [], algoOrders: [], timestamp: Date.now() });
          }),
      );

      await vi.advanceTimersByTimeAsync(10000); // 触发 tick，挂起在 refresh
      runner.submitUserAction('USER_LIQUIDATE'); // triggerResolver 为 null 的窗口
      releaseRefresh();
      await vi.advanceTimersByTimeAsync(100); // 当前 tick 完成 + 事件应被立即消费

      expect(adapter.closePosition).toHaveBeenCalledWith('ETH/USDT', 'LONG');
    });

    it('requestLiquidation() 在平仓动作完成后才 resolve (BUG-07)', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.fsm.transition.mockImplementation((_st: unknown, ev: { type: string }) =>
        ev.type === 'USER_LIQUIDATE'
          ? { newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 }, action: 'LIQUIDATE_ALL' }
          : { newState: { kind: 'RUNNING', since: Date.now() } },
      );

      let closeFinished = false;
      adapter.closePosition = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 1500)); // 市价平仓远超 500ms
        closeFinished = true;
        return { orderId: 'o-close', clientOrderId: 'c-close', status: 'FILLED', filledQty: 0.5 };
      });

      const done = runner.requestLiquidation();
      let settled = false;
      void done.then(() => { settled = true; });

      await vi.advanceTimersByTimeAsync(1000);
      expect(settled).toBe(false); // 平仓未完成不得提前 resolve

      await vi.advanceTimersByTimeAsync(2000);
      await done;
      expect(closeFinished).toBe(true);
      expect(adapter.closePosition).toHaveBeenCalledTimes(1);
    });
  });

  describe('Invalid Ticker Frame Guard（0 价帧曾致 LONG 秒清算+激活死循环）', () => {
    it('0 价 ticker 帧被丢弃——不污染价格、不触发 FSM 清算', async () => {
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      // 模拟 Gate 订阅确认帧映射出的 0 价 ticker
      await (runner as any).onTickerUpdate({ symbol: 'ETH/USDT', bid: 0, ask: 0, last: 0, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(10000); // 下一个 tick

      // FSM 不得收到 price<=0 的 TICK（LONG: d=TP-0 > 网格深度 → 误清算）
      const tickCalls = (deps.fsm.transition as ReturnType<typeof vi.fn>).mock.calls
        .filter((c) => (c[1] as { type: string }).type === 'TICK');
      expect(tickCalls.length).toBeGreaterThan(0);
      for (const call of tickCalls) {
        expect((call[1] as { price: number }).price).toBeGreaterThan(0);
      }
      expect(adapter.closePosition).not.toHaveBeenCalled();
    });
  });

  describe('Position Runaway Guard (BUG-06)', () => {
    // 满仓上限 = mainGridCount(10) × mainGridPortionSize(0.01) = 0.1
    const stalePosition = { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 10, marginType: 'CROSS' as const };

    function setupRunawayScenario(side: 'BUY' | 'SELL', qty: number, restQty = 0) {
      // REST 持仓恒为 restQty——模拟交易所持仓接口滞后于刚发生的成交
      deps.truth.invalidateAndRefresh.mockResolvedValue({
        position: { ...stalePosition, baseAssetQty: restQty },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      // 策略始终看到缺口，要求满额补差
      deps.strategy.computeDesiredOrders = vi.fn().mockReturnValue({
        action: 'PLACE', side, qty, price: 2000, tif: 'POC', gridPrice: 2000,
      });
      // 下单即成交
      deps.execution.execute = vi.fn().mockImplementation(async (req: { qty: number }) => ({
        outcome: 'FILLED', orderId: `ex-${Math.random().toString(36).slice(2, 8)}`, filledQty: req.qty, avgFillPrice: 2000,
      }));
    }

    it('交易所 REST 持仓滞后时不无限重复补差——会话成交台账触发加仓护栏', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      setupRunawayScenario('BUY', 0.04);

      // 4 个 tick：无护栏会下 4 单(0.16=1.6×满仓)；有护栏 0.04+0.04 后第 3 单(0.12>0.1)被拒
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }

      expect(deps.execution.execute).toHaveBeenCalledTimes(2);
    });

    it('减仓单不受加仓护栏拦截（即使交易所持仓已超满仓上限）', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      setupRunawayScenario('SELL', 0.05, 0.12); // LONG 方向 SELL=减仓；REST 持仓 0.12 已超上限

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).toHaveBeenCalledTimes(1);
    });

    it('台账外减仓(紧急止损等)后台账随 REST 收敛——加仓不被永久锁死', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      setupRunawayScenario('BUY', 0.04);

      // 前 3 个 tick：两单成交后护栏挡住第 3 单
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }
      expect(deps.execution.execute).toHaveBeenCalledTimes(2);

      // 此后 REST 持续报 0 且 60s 内无任何自有成交（滞后窗口已过）→
      // 台账应重锚到 REST，恢复允许加仓（真实场景：紧急止损在台账外平掉了仓位）
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(10000);
      }

      expect(deps.execution.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Zone Crossing', () => {
    it('onTickerUpdate detects zone change and resolves trigger', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'test' });

      const config = {
        takeProfitPrice: 2200,
        mainGridCount: 10,
        mainGridStep: 36,
        mainGridPortionSize: 0.01,
        stopLossGridCount: 4,
        stopLossGridStep: 10,
        isolationStep: 2.5,
        direction: 'LONG' as const,
      };

      await (runner as any).onTickerUpdate({
        symbol: 'ETH/USDT',
        bid: 1999,
        ask: 2001,
        last: 2000,
        timestamp: Date.now(),
      });

      deps.strategy.computeDesiredOrders.mockClear();
      deps.truth.invalidateAndRefresh.mockClear();

      await (runner as any).onTickerUpdate({
        symbol: 'ETH/USDT',
        bid: 2159,
        ask: 2161,
        last: 2160,
        timestamp: Date.now(),
      });

      await vi.advanceTimersByTimeAsync(50);

      expect(deps.truth.invalidateAndRefresh).toHaveBeenCalled();
    });
  });

  describe('USER_PAUSE / USER_RESUME', () => {
    it('USER_PAUSE transitions FSM to PAUSED', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'PAUSED', reason: 'user', since: Date.now() } });

      runner.submitUserAction('USER_PAUSE');
      await vi.advanceTimersByTimeAsync(50);

      expect(deps.fsm.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'USER_PAUSE' }),
        expect.anything(),
        expect.anything(),
      );
      expect(runner.getState()!.fsm.kind).toBe('PAUSED');
    });

    it('USER_RESUME triggers immediate cycle', async () => {
      const state = createInitialState();
      state.fsm = { kind: 'PAUSED', reason: 'user', since: Date.now() };
      await startRunner(runner, adapter, deps, state);
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'test' });

      runner.submitUserAction('USER_RESUME');
      await vi.advanceTimersByTimeAsync(50);

      expect(deps.fsm.transition).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'USER_RESUME' }),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('onStateChange callback', () => {
    it('calls onStateChange during handleTrigger cycle', async () => {
      const onStateChange = vi.fn();
      const localDeps = { ...deps, onStateChange };
      const runnerWithCallback = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      await runnerWithCallback.start(createInitialState());

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'test' });

      await vi.advanceTimersByTimeAsync(10000);

      expect(onStateChange).toHaveBeenCalled();

      const stopPromise = runnerWithCallback.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });
  });

  describe('Crash Recovery (Cold Start)', () => {
    it('start() without initialState calls coldStartRecover which uses reconstructor', async () => {
      await runner.start();

      expect(deps.truth.invalidateAndRefresh).toHaveBeenCalledWith('ETH/USDT');
      expect(adapter.getTicker).toHaveBeenCalledWith('ETH/USDT');
      expect(deps.reconstructor.reconstruct).toHaveBeenCalled();
    });

    it('cold start cancels ordersToCancel from reconstructor', async () => {
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        activeOrder: null,
        lastPrice: 2000,
        ordersToCancel: [
          { orderId: 'stale-1', clientOrderId: 'test-session_BUY_1', status: 'PENDING', filledQty: 0 },
          { orderId: 'stale-2', clientOrderId: 'test-session_SELL_2', status: 'PENDING', filledQty: 0 },
        ],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });

      await runner.start();

      expect(adapter.cancelOrder).toHaveBeenCalledWith('stale-1', 'ETH/USDT', expect.any(AbortSignal));
      expect(adapter.cancelOrder).toHaveBeenCalledWith('stale-2', 'ETH/USDT', expect.any(AbortSignal));
    });

    it('cold start recovers activeOrder when reconstructor returns one', async () => {
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        activeOrder: {
          orderId: 'o-recovered',
          clientOrderId: 'test-session_BUY_1',
          side: 'BUY',
          qty: 0.01,
          price: 2100,
          tif: 'GTC',
          placedAt: Date.now(),
        },
        lastPrice: 2000,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });

      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE',
        side: 'BUY',
        qty: 0.01,
        price: 2100,
        tif: 'GTC',
        reason: 'test',
      });

      await runner.start();

      expect(runner.getActiveOrder()).not.toBeNull();
      expect(runner.getActiveOrder()!.orderId).toBe('o-recovered');
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');
    });

    it('cold start cancels recovered order if strategy disagrees', async () => {
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        activeOrder: {
          orderId: 'o-recovered',
          clientOrderId: 'test-session_BUY_1',
          side: 'BUY',
          qty: 0.01,
          price: 2100,
          tif: 'GTC',
          placedAt: Date.now(),
        },
        lastPrice: 2000,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });

      deps.strategy.computeDesiredOrders.mockReturnValue({ action: 'HOLD', reason: 'no order needed' });

      await runner.start();

      expect(adapter.cancelOrder).toHaveBeenCalledWith('o-recovered', 'ETH/USDT', expect.any(AbortSignal));
      expect(runner.getPhase()).toBe('IDLE');
    });

    it('cold start 把 DB 最大订单序号传给 reconstructor，防止重启后 clientOrderId 复用', async () => {
      deps.persistence.getMaxOrderSeq = vi.fn().mockResolvedValue(5);

      await runner.start();

      expect(deps.persistence.getMaxOrderSeq).toHaveBeenCalledWith('test-session');
      expect(deps.reconstructor.reconstruct).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        { persistedMaxSeq: 5 },
      );
    });

    it('coldStartRecover only cancels algos matching own session prefix, not other sessions', async () => {
      const ownAlgo = { algoOrderId: 'a1', clientOrderId: 'SC_1_algo_emergency_001', triggerPrice: 1400 };
      const otherAlgo = { algoOrderId: 'a2', clientOrderId: 'SC_2_algo_emergency_001', triggerPrice: 1450 };

      deps.truth.invalidateAndRefresh = vi.fn().mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [ownAlgo, otherAlgo],
        timestamp: Date.now(),
      } as SyncResult);

      config.runCode = 'SC_1';
      const scopedRunner = new GridBotRunner(config, adapter, deps);

      await scopedRunner.start();

      expect(adapter.cancelAlgoOrder).toHaveBeenCalledTimes(1);
      expect(adapter.cancelAlgoOrder).toHaveBeenCalledWith('a1', 'ETH/USDT', expect.any(AbortSignal));
      expect(adapter.cancelAlgoOrder).not.toHaveBeenCalledWith('a2', 'ETH/USDT', expect.any(AbortSignal));

      const stopPromise = scopedRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('start() with initialState skips cold start recovery', async () => {
      await startRunner(runner, adapter, deps, createInitialState());

      expect(deps.truth.invalidateAndRefresh).not.toHaveBeenCalled();
      expect(adapter.getTicker).not.toHaveBeenCalled();
    });

    it('start() with initialState restores activeOrder from state', async () => {
      const state = createInitialState();
      state.orderManager.activeOrder = {
        orderId: 'o-restored',
        clientOrderId: 'test-session_BUY_1',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'GTC',
        placedAt: Date.now(),
      };

      await startRunner(runner, adapter, deps, state);

      expect(runner.getActiveOrder()).not.toBeNull();
      expect(runner.getActiveOrder()!.orderId).toBe('o-restored');
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');
    });
  });

  describe('Settlement Source Tracking', () => {
    it('ws-reported FILLED does not call cancelOrder', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      (runner as any).resolveOrderSettlement('FILLED', 'ws');
      await vi.advanceTimersByTimeAsync(50);

      expect(adapter.cancelOrder).not.toHaveBeenCalled();
      expect(runner.getActiveOrder()).toBeNull();
      expect(runner.getPhase()).toBe('IDLE');
    });

    it('invalidation CANCELLED calls cancelOrder on active order', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');
      const orderId = runner.getActiveOrder()!.orderId;

      (runner as any).resolveOrderSettlement('CANCELLED', 'invalidation');
      await vi.advanceTimersByTimeAsync(50);

      expect(adapter.cancelOrder).toHaveBeenCalledWith(orderId, expect.any(String), expect.anything());
      expect(runner.getActiveOrder()).toBeNull();
    });

    it('ws-reported CANCELLED does not call cancelOrder', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      (runner as any).resolveOrderSettlement('CANCELLED', 'ws');
      await vi.advanceTimersByTimeAsync(50);

      expect(adapter.cancelOrder).not.toHaveBeenCalled();
      expect(runner.getActiveOrder()).toBeNull();
    });

    it('invalidation CANCELLED refreshes position when cancelOrder fails (order already filled)', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      adapter.cancelOrder = vi.fn().mockRejectedValue(new Error('Order already filled'));
      const refreshSpy = vi.spyOn(deps.truth, 'invalidateAndRefresh').mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.01, quoteAssetQty: -21, entryPrice: 2100, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      } as SyncResult);

      (runner as any).resolveOrderSettlement('CANCELLED', 'invalidation');
      await vi.advanceTimersByTimeAsync(50);

      expect(adapter.cancelOrder).toHaveBeenCalled();
      expect(refreshSpy).toHaveBeenCalledWith('ETH/USDT');
      expect((runner as any).position.baseAssetQty).toBe(0.01);
      expect(runner.getActiveOrder()).toBeNull();
    });

    it('invalidation CANCELLED clears activeOrder even when both cancel and refresh fail', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      adapter.cancelOrder = vi.fn().mockRejectedValue(new Error('Order already filled'));
      vi.spyOn(deps.truth, 'invalidateAndRefresh').mockRejectedValue(new Error('REST timeout'));

      (runner as any).resolveOrderSettlement('CANCELLED', 'invalidation');
      await vi.advanceTimersByTimeAsync(50);

      expect(runner.getActiveOrder()).toBeNull();
      expect(runner.getPhase()).toBe('IDLE');
    });
  });

  describe('Cancel-Loop Guard', () => {
    it('skips order placement after 3 cancels on same price/side within window', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      const history = (runner as any).cancelHistory;
      for (let i = 0; i < 3; i++) {
        history.push({ price: 2100, side: 'BUY', ts: Date.now() });
      }

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Cancel-loop'));
    });

    it('allows order after cancel history expires', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      const history = (runner as any).cancelHistory;
      history.push({ price: 2100, side: 'BUY', ts: Date.now() - 120_000 });
      history.push({ price: 2100, side: 'BUY', ts: Date.now() - 120_000 });
      history.push({ price: 2100, side: 'BUY', ts: Date.now() - 120_000 });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).toHaveBeenCalled();
    });
  });

  describe('Pending User Action During ORDER_ACTIVE', () => {
    it('USER_PAUSE during ORDER_ACTIVE queues action and resolves settlement', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'PAUSED', reason: 'user', since: Date.now() } });

      runner.submitUserAction('USER_PAUSE');
      await vi.advanceTimersByTimeAsync(50);

      expect(runner.getPhase()).toBe('IDLE');
      expect(runner.getState()!.fsm.kind).toBe('PAUSED');
    });

    it('USER_LIQUIDATE during ORDER_ACTIVE queues action and triggers liquidation', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(runner.getPhase()).toBe('ORDER_ACTIVE');

      deps.fsm.transition.mockReturnValue({ newState: { kind: 'LIQUIDATING', startTime: Date.now(), attemptCount: 0 } });

      runner.submitUserAction('USER_LIQUIDATE');
      await vi.advanceTimersByTimeAsync(200);

      expect(adapter.cancelOrder).toHaveBeenCalled();
    });
  });

  describe('TRAILING_ENTRY State', () => {
    it('does not place orders when FSM is TRAILING_ENTRY', async () => {
      const state = createInitialState();
      state.fsm = { kind: 'TRAILING_ENTRY', entryPrice: 2000, extremePrice: 2000, trailingCallbackRate: 0.002 };
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'TRAILING_ENTRY', entryPrice: 2000, extremePrice: 1990, trailingCallbackRate: 0.002 } });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).not.toHaveBeenCalled();
      expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');
    });

    it('transitions to RUNNING via FSM tick and then places orders', async () => {
      const state = createInitialState();
      state.fsm = { kind: 'TRAILING_ENTRY', entryPrice: 2000, extremePrice: 1990, trailingCallbackRate: 0.002 };
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await startRunner(runner, adapter, deps, state);

      deps.fsm.transition.mockReturnValueOnce({
        newState: { kind: 'RUNNING', since: Date.now() },
        action: 'START_MAIN_GRID',
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'SELL', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test',
      });

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).toHaveBeenCalled();
      expect(runner.getState()!.fsm.kind).toBe('RUNNING');
    });
  });

  describe('POSITION_INHERITED on cold start', () => {
    it('writes POSITION_INHERITED event when pre-existing position detected with no prior fills', async () => {
      deps.truth.invalidateAndRefresh = vi.fn().mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 1.7, quoteAssetQty: -2641.46, entryPrice: 1553.8, leverage: 20, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      } as SyncResult);
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 1.7, quoteAssetQty: -2641.46, entryPrice: 1553.8, leverage: 20, marginType: 'CROSS' },
        activeOrder: null,
        lastPrice: 1553.8,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });
      deps.persistence.getFillsByConfigId = vi.fn().mockResolvedValue({ fills: [], total: 0 });

      config.runCode = 'SC_1';
      config.configId = 'cfg-1';
      const inheritedRunner = new GridBotRunner(config, adapter, deps);

      await inheritedRunner.start();

      expect(deps.persistence.writeEventLog).toHaveBeenCalledWith(
        'cfg-1',
        expect.objectContaining({
          type: 'POSITION_INHERITED',
          qty: 1.7,
          entryPrice: 1553.8,
        }),
        expect.any(Number),
        'SC_1',
      );

      const stopPromise = inheritedRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('does not write POSITION_INHERITED when fills exist', async () => {
      deps.truth.invalidateAndRefresh = vi.fn().mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 1.7, quoteAssetQty: -2641.46, entryPrice: 1553.8, leverage: 20, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      } as SyncResult);
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 1.7, quoteAssetQty: -2641.46, entryPrice: 1553.8, leverage: 20, marginType: 'CROSS' },
        activeOrder: null,
        lastPrice: 1553.8,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });
      deps.persistence.getFillsByConfigId = vi.fn().mockResolvedValue({ fills: [{ id: 'f1' }], total: 1 });

      config.runCode = 'SC_1';
      config.configId = 'cfg-1';
      const inheritedRunner = new GridBotRunner(config, adapter, deps);

      await inheritedRunner.start();

      const inheritedCalls = (deps.persistence.writeEventLog as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[1]?.type === 'POSITION_INHERITED',
      );
      expect(inheritedCalls).toHaveLength(0);

      const stopPromise = inheritedRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('does not write POSITION_INHERITED when no position', async () => {
      deps.truth.invalidateAndRefresh = vi.fn().mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      } as SyncResult);
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' },
        activeOrder: null,
        lastPrice: 2000,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });
      deps.persistence.getFillsByConfigId = vi.fn().mockResolvedValue({ fills: [], total: 0 });

      config.runCode = 'SC_1';
      config.configId = 'cfg-1';
      const inheritedRunner = new GridBotRunner(config, adapter, deps);

      await inheritedRunner.start();

      const inheritedCalls = (deps.persistence.writeEventLog as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: any[]) => c[1]?.type === 'POSITION_INHERITED',
      );
      expect(inheritedCalls).toHaveLength(0);

      const stopPromise = inheritedRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });
  });

  describe('冷启动紧急止损与启动清扫顺序', () => {
    it('start() 结束时紧急止损必须存活——启动清扫不得撤掉自己刚下的止损', async () => {
      // 实测（2026-06-12 OKX）：恢复流程先下紧急止损，随后 start() 的
      // cancelOwnOrders/cancelStaleOrdersOnSymbol 把它当上一会话残留撤掉，
      // 持仓在下一个 tick 重建止损前裸奔（历史最长 24 分钟无保护）。
      // 用有状态 mock 模拟交易所挂单簿，黑盒断言最终状态。
      const liveAlgos: Array<{ algoOrderId: string; clientOrderId: string; triggerPrice: number }> = [];
      let nextAlgoId = 1;
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockImplementation(async (params: { clientOrderId: string; triggerPrice: number }) => {
        const algo = {
          algoOrderId: `algo-${nextAlgoId++}`,
          clientOrderId: params.clientOrderId,
          triggerPrice: params.triggerPrice,
        };
        liveAlgos.push(algo);
        return { orderId: algo.algoOrderId, clientOrderId: algo.clientOrderId, status: 'PENDING', filledQty: 0, algoOrderId: algo.algoOrderId };
      });
      (adapter.cancelAlgoOrder as ReturnType<typeof vi.fn>).mockImplementation(async (algoOrderId: string) => {
        const index = liveAlgos.findIndex((a) => a.algoOrderId === algoOrderId);
        if (index >= 0) liveAlgos.splice(index, 1);
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockImplementation(async () => [...liveAlgos]);
      (deps.reconstructor.reconstruct as ReturnType<typeof vi.fn>).mockReturnValue({
        fsmState: { kind: 'RUNNING', since: Date.now() },
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: -200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        activeOrder: null,
        lastPrice: 2000,
        ordersToCancel: [],
        nextSeq: 1,
        gridActiveSince: undefined,
        stats: { totalOrdersPlaced: 0, totalFills: 0, totalReorders: 0, lastPersistTime: 0, realizedPnl: 0 },
      });
      deps.persistence.getFillsByConfigId = vi.fn().mockResolvedValue({ fills: [{ id: 'f1' }], total: 1 });

      await startRunner(runner, adapter, deps); // 冷启动，无 initialState

      expect(adapter.createAlgoOrder).toHaveBeenCalled();
      const placed = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(placed.closePosition).toBe(true);
      // 存活的必须正是那张紧急止损（而非碰巧残留的其他 algo 单）
      expect(liveAlgos).toHaveLength(1);
      expect(liveAlgos[0].clientOrderId).toBe(placed.clientOrderId);
      expect(liveAlgos[0].triggerPrice).toBe(placed.triggerPrice);
    });

    it('start(initialState) 快照恢复路径：RUNNING 且有持仓时启动即补挂紧急止损', async () => {
      // 该路径原先不在启动期下止损（只靠后续 tick）；现与冷启动对齐，
      // 此用例钉住这一保护性增强，防止回归。
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };

      await startRunner(runner, adapter, deps, state);

      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(1);
      const placed = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(placed.closePosition).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('main loop error does not crash runner, logs error', async () => {
      await startRunner(runner, adapter, deps, createInitialState());
      deps.truth.invalidateAndRefresh.mockRejectedValueOnce(new Error('REST boom'));

      await vi.advanceTimersByTimeAsync(10000);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Position refresh failed'),
      );
      expect(runner.isRunning()).toBe(true);
    });
  });

  describe('onFill callback', () => {
    it('calls onFill with exchange fill data when order settlement resolves FILLED', async () => {
      const onFill = vi.fn();
      const localDeps = { ...deps, onFill };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await fillRunner.start(state);

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test', gridPrice: 2100,
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(fillRunner.getPhase()).toBe('ORDER_ACTIVE');

      (fillRunner as any).resolveOrderSettlement('FILLED', 'ws', {
        orderId: 'ws-order-1',
        clientOrderId: 'ETH_test_3',
        status: 'FILLED',
        filledQty: 0.008,
        avgFillPrice: 2099.5,
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(onFill).toHaveBeenCalledTimes(1);
      const fillArg = onFill.mock.calls[0][0];
      expect(fillArg.side).toBe('buy');
      expect(fillArg.price).toBe(2099.5);
      expect(fillArg.qty).toBe(0.008);
      expect(fillArg.id).toContain('ETH_test_3');

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('onFill payload 带 avgGridPrice', async () => {
      const onFill = vi.fn();
      const localDeps = { ...deps, onFill };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await fillRunner.start(state);

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'SELL', qty: 0.01, price: 2150, tif: 'GTC', reason: 'test', gridPrice: 2150,
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(fillRunner.getPhase()).toBe('ORDER_ACTIVE');

      (fillRunner as any).resolveOrderSettlement('FILLED', 'ws', {
        orderId: 'ws-order-agp',
        clientOrderId: 'ETH_test_agp',
        status: 'FILLED',
        filledQty: 0.01,
        avgFillPrice: 2150,
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(onFill).toHaveBeenCalledWith(
        expect.objectContaining({ avgGridPrice: expect.any(Number) }),
      );

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('calls onFill with exchange fill data when execution returns FILLED immediately', async () => {
      const onFill = vi.fn();
      const localDeps = { ...deps, onFill };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      await fillRunner.start(createInitialState());

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.execution.execute.mockResolvedValue({
        outcome: 'FILLED',
        orderId: 'imm-fill-1',
        clientOrderId: 'ETH_test_2',
        filledQty: 0.018,
        avgFillPrice: 2148.5,
      });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'SELL', qty: 0.02, price: 2150, tif: 'POC', reason: 'test', gridPrice: 2150,
      });
      (fillRunner as any).lastTicker = { bid: 2149, ask: 2151, last: 2150 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onFill).toHaveBeenCalledTimes(1);
      const fillArg = onFill.mock.calls[0][0];
      expect(fillArg.side).toBe('sell');
      expect(fillArg.price).toBe(2148.5);
      expect(fillArg.qty).toBe(0.018);
      expect(fillArg.id).toContain('ETH_test_2');

      expect(localDeps.persistence.writeEventLog).toHaveBeenCalledWith(
        'cfg1',
        expect.objectContaining({ type: 'FILL' }),
        expect.any(Number),
        'test-session',
      );

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('立即成交分支：持仓非零时广播 avgGridPrice 用下单前仓位兜底（非零）', async () => {
      // 立即成交（immediate FILLED）分支 this.activeOrder 为 null，preOrderPosition
      // 兜底取 this.position?.baseAssetQty。此处起始持仓非零且触发 SELL 减仓（gap>0），
      // 钉住兜底 position 被真正用上：avgGridPrice 必须非零。
      // 若兜底被误删回 `?? 0`，gap 用 pos=0 → 计划空 → avgGridPrice=0，本用例变红。
      const onFill = vi.fn();
      // 周期开头 cleanStateCycle 会用 truth 刷新 this.position，故让权威态报告非零持仓
      // （0.05 落在主网格内 = 5 格；SELL 减仓跨越的网格档可归属 → avgGridPrice 非零）。这正是
      // 立即成交分支 preOrderPosition 兜底取 this.position.baseAssetQty 的取值来源；
      // 若兜底被误删回 `?? 0`，减仓从 0 起 → 持仓区间为空 → avgGridPrice=0，本用例变红。
      const nonZeroPosition = { symbol: 'ETH/USDT', baseAssetQty: 0.05, quoteAssetQty: -1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' as const };
      const localDeps = {
        ...deps,
        onFill,
        truth: {
          invalidateAndRefresh: vi.fn().mockResolvedValue({
            position: nonZeroPosition,
            openOrders: [],
            algoOrders: [],
            timestamp: Date.now(),
          } as SyncResult),
        } as unknown as ExchangeTruthService,
      };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      const state = createInitialState();
      state.position = nonZeroPosition;
      await fillRunner.start(state);

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.execution.execute.mockResolvedValue({
        outcome: 'FILLED',
        orderId: 'imm-fill-agp',
        clientOrderId: 'ETH_test_agp_imm',
        filledQty: 0.01,
        avgFillPrice: 2150,
      });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'SELL', qty: 0.01, price: 2150, tif: 'POC', reason: 'test', gridPrice: 2150,
      });
      (fillRunner as any).lastTicker = { bid: 2149, ask: 2151, last: 2150 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onFill).toHaveBeenCalledTimes(1);
      const fillCall = (onFill as any).mock.calls.at(-1)?.[0];
      // 核心断言：兜底用上非零 position → 非零 avgGridPrice（删兜底则为 0，变红）
      expect(fillCall.avgGridPrice).toBeGreaterThan(0);
      // savings 取决于成交价 vs avgGridPrice；avgGridPrice 非零即证明兜底 position 被用上
      expect(fillCall.savings).not.toBe(0);

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('recordFill does not return until writeEventLog resolves for FILL', async () => {
      let resolveWrite!: () => void;
      const writePromise = new Promise<void>((resolve) => { resolveWrite = resolve; });

      const localDeps = {
        ...deps,
        persistence: {
          ...deps.persistence,
          writeEventLog: vi.fn().mockImplementation(async () => {
            await writePromise;
          }),
        },
      };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);
      (fillRunner as any).nextSeq = 5;
      (fillRunner as any).activeOrder = {
        orderId: 'o1',
        clientOrderId: 'c1',
        side: 'buy',
        qty: 0.05,
        price: 2000,
        gridPrice: 2000,
        tif: 'GTC',
        placedAt: Date.now(),
      };

      const result = (fillRunner as any).recordFill('BUY', 2000, 0.05, 2000, 'GTC', 'o1', 'c1');

      expect(result).toBeInstanceOf(Promise);

      let resolved = false;
      result.then(() => { resolved = true; });
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);

      resolveWrite();
      await result;
    });

    it('does not call onFill when settlement is CANCELLED', async () => {
      const onFill = vi.fn();
      const localDeps = { ...deps, onFill };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      await fillRunner.start(createInitialState());

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test', gridPrice: 2100,
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(fillRunner.getPhase()).toBe('ORDER_ACTIVE');

      (fillRunner as any).resolveOrderSettlement('CANCELLED', 'ws');
      await vi.advanceTimersByTimeAsync(50);

      expect(onFill).not.toHaveBeenCalled();

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });
  });

  describe('onOwnFillSettled callback', () => {
    it('calls onOwnFillSettled with clientOrderId when order settlement resolves FILLED', async () => {
      const onOwnFillSettled = vi.fn();
      const localDeps = { ...deps, onOwnFillSettled };
      const fillRunner = new GridBotRunner(config, adapter, localDeps);

      adapter.subscribeTicker = vi.fn().mockImplementation(async function* () {});
      adapter.subscribeOrderUpdates = vi.fn().mockImplementation(async function* () {});
      adapter.subscribePosition = vi.fn().mockImplementation(async function* () {});

      const state = createInitialState();
      state.position = { symbol: 'ETH/USDT', baseAssetQty: 0.5, quoteAssetQty: -100, entryPrice: 2000, leverage: 10, marginType: 'CROSS' };
      await fillRunner.start(state);

      localDeps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });
      localDeps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2100, tif: 'GTC', reason: 'test', gridPrice: 2100,
      });

      await vi.advanceTimersByTimeAsync(10000);
      expect(fillRunner.getPhase()).toBe('ORDER_ACTIVE');

      (fillRunner as any).resolveOrderSettlement('FILLED', 'ws', {
        orderId: 'ws-order-1',
        clientOrderId: 'ETH_test_3',
        status: 'FILLED',
        filledQty: 0.008,
        avgFillPrice: 2099.5,
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(onOwnFillSettled).toHaveBeenCalledWith('ETH_test_3');

      const stopPromise = fillRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });
  });

  describe('reconcileOrphanOrders', () => {
    it('取消所有其他 session 的 algo 单（包括 emergency）', async () => {
      const foreignEmergency: AlgoOrder = {
        algoOrderId: 'ae1',
        clientOrderId: 'ETHUSDT_260608044136_algo_emergency_a3f2',
        symbol: 'ETH/USDT',
        side: 'SELL',
        qty: 2.75,
        triggerPrice: 1550,
        status: 'PENDING',
        closePosition: true,
      };
      const foreignGrid: AlgoOrder = {
        algoOrderId: 'ae2',
        clientOrderId: 'ETHUSDT_260608044136_algo_grid_0001',
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        triggerPrice: 1800,
        status: 'PENDING',
      };
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [foreignEmergency, foreignGrid],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([foreignEmergency, foreignGrid]);
      await startRunner(runner, adapter, deps, createInitialState());

      config.reconcileIntervalMs = 10000;
      config.pollIntervalMs = 10000;
      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.cancelAlgoOrder).toHaveBeenCalledWith('ae2', 'ETH/USDT', expect.anything());
      expect(adapter.cancelAlgoOrder).toHaveBeenCalledWith('ae1', 'ETH/USDT', expect.anything());
    });
  });

  describe('ensureEmergencyStopLoss', () => {
    it('无已有止损时正常下单', async () => {
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(runner, adapter, deps, createInitialState());

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(1);
      const call = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.side).toBe('SELL');
      expect(call.closePosition).toBe(true);
    });

    it('algo id 为 OKX 兼容格式（纯字母数字 ≤32），回报原样 id 时不再重下', async () => {
      // 旧格式 `${runCode}_algo_emergency_<rand>` 被 OKX 去下划线截断后丢失
      // 随机后缀（恒为同一 id → 拒重复），且带下划线前缀匹配不上回报 id →
      // hasOwnEmergency 永远 false → 每个 tick 重下、WARN 无限刷。
      config.runCode = 'ETHUSDT_260611071735';
      const prodRunner = new GridBotRunner(config, adapter, deps);
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(prodRunner, adapter, deps, createInitialState());

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(1);
      const call = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.clientOrderId).toMatch(/^[a-zA-Z0-9]+$/);
      expect(call.clientOrderId.length).toBeLessThanOrEqual(32);
      expect(call.clientOrderId.startsWith('ETHUSDT260611071735')).toBe(true);

      // 交易所（OKX）回报的 id 与下单时一字不差 → 必须识别为自己的止损，不重下
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([
        { algoOrderId: 'a9', clientOrderId: call.clientOrderId, triggerPrice: call.triggerPrice },
      ]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockClear();

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).not.toHaveBeenCalled();

      const stopPromise = prodRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('兼容存量旧格式止损单：同价旧格式单存在时不重下', async () => {
      config.runCode = 'ETHUSDT_260611071735';
      const prodRunner = new GridBotRunner(config, adapter, deps);
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      // 先让一次下单发生，抓到 triggerPrice，再用旧格式 id 同价位喂回去
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(prodRunner, adapter, deps, createInitialState());
      await vi.advanceTimersByTimeAsync(10000);
      const call = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];

      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([
        { algoOrderId: 'a8', clientOrderId: 'ETHUSDT_260611071735_algo_emergency_ab12', triggerPrice: call.triggerPrice },
      ]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockClear();

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).not.toHaveBeenCalled();

      const stopPromise = prodRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('兼容 OKX 截断态旧 id（无下划线 token+algo…）：同价单存在时不重下', async () => {
      // 旧格式 id 在 OKX 上被去下划线截断为 token+algoemergency；若启动撤单
      // 失败残留，必须仍能被识别为自己的止损，否则永久滞留且每 tick 重下。
      config.runCode = 'ETHUSDT_260611071735';
      const prodRunner = new GridBotRunner(config, adapter, deps);
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(prodRunner, adapter, deps, createInitialState());
      await vi.advanceTimersByTimeAsync(10000);
      const call = (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];

      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([
        { algoOrderId: 'a7', clientOrderId: 'ETHUSDT260611071735algoemergency', triggerPrice: call.triggerPrice },
      ]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockClear();

      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).not.toHaveBeenCalled();

      const stopPromise = prodRunner.stop();
      await vi.advanceTimersByTimeAsync(6000);
      await stopPromise;
    });

    it('CLIENT_ID_TOO_LONG 为永久失败：只报一次 error，不每 tick 重试，且转 PAUSED 停止交易', async () => {
      // fail-loud 落进每 tick 的 catch-warn 循环就不再是 fail-loud：
      // 超长 id 属配置性永久错误，重试无意义且重现 WARN 死循环。
      // 且"止损永久不可用但继续开仓"是风险敞口——必须停止交易而非只记日志。
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('id too long'), { code: 'CLIENT_ID_TOO_LONG' }),
      );
      // 贴近真实 FSM：PAUSED + TICK 保持 PAUSED（恒返回 RUNNING 的桩会掩盖暂停）
      (deps.fsm.transition as ReturnType<typeof vi.fn>).mockImplementation(
        (state: { kind: string }) => ({ newState: state.kind === 'PAUSED' ? state : { kind: 'RUNNING', since: Date.now() } }),
      );
      await startRunner(runner, adapter, deps, createInitialState());

      await vi.advanceTimersByTimeAsync(10000);
      await vi.advanceTimersByTimeAsync(10000);
      await vi.advanceTimersByTimeAsync(10000);

      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(1);
      expect((runner as unknown as { fsmState: { kind: string } }).fsmState.kind).toBe('PAUSED');
      // PAUSED 后不再计算/放置网格单
      (deps.strategy.computeDesiredOrders as ReturnType<typeof vi.fn>).mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(deps.strategy.computeDesiredOrders).not.toHaveBeenCalled();
    });

    it('永久错误暂停经关键事件管线通知（持仓无止损裸露期用户必须知情）', async () => {
      const onCriticalEvent = vi.fn();
      (deps as any).onCriticalEvent = onCriticalEvent;
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('id too long'), { code: 'CLIENT_ID_TOO_LONG' }),
      );
      await startRunner(runner, adapter, deps, createInitialState());

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).toHaveBeenCalledWith({
        kind: 'PAUSED_PERMANENT_ERROR', reason: 'CLIENT_ID_TOO_LONG', message: 'id too long',
      });
    });

    it('USER_RESUME 复位永久错误标志：恢复后重试一次，仍失败则再次 PAUSED（不静默裸跑）', async () => {
      // 不复位的话：用户恢复 → FSM 回 RUNNING → flag 早退不重试、不再暂停、
      // 不再记日志 → 机器人从此无止损裸跑且完全无声。
      (deps.truth.invalidateAndRefresh as ReturnType<typeof vi.fn>).mockResolvedValue({
        position: { symbol: 'ETH/USDT', baseAssetQty: 0.1, quoteAssetQty: 200, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
        openOrders: [],
        algoOrders: [],
        timestamp: Date.now(),
      });
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (adapter.createAlgoOrder as ReturnType<typeof vi.fn>).mockRejectedValue(
        Object.assign(new Error('id too long'), { code: 'CLIENT_ID_TOO_LONG' }),
      );
      (deps.fsm.transition as ReturnType<typeof vi.fn>).mockImplementation(
        (state: { kind: string }, event: { type: string }) => {
          if (event.type === 'USER_RESUME') return { newState: { kind: 'RUNNING', since: Date.now() } };
          return { newState: state.kind === 'PAUSED' ? state : { kind: 'RUNNING', since: Date.now() } };
        },
      );
      await startRunner(runner, adapter, deps, createInitialState());

      await vi.advanceTimersByTimeAsync(10000);
      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(1);
      expect((runner as unknown as { fsmState: { kind: string } }).fsmState.kind).toBe('PAUSED');

      runner.submitUserAction('USER_RESUME');
      await vi.advanceTimersByTimeAsync(10000);

      // 恢复后重试了一次（第 2 次调用），仍失败 → 再次 PAUSED,收敛而非死循环
      expect(adapter.createAlgoOrder).toHaveBeenCalledTimes(2);
      expect((runner as unknown as { fsmState: { kind: string } }).fsmState.kind).toBe('PAUSED');
    });

    it('网格下单路径的 CLIENT_ID_TOO_LONG 同样转 PAUSED，不进入拒单重试循环', async () => {
      // 与 algo 路径同策略：配置性永久错误重试只会更长（nextSeq 递增），
      // 50 次退避后下一 tick 再来 50 次的无限慢速循环必须掐断。
      const onCriticalEvent = vi.fn();
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockImplementation(
        (state: { kind: string }) => ({ newState: state.kind === 'PAUSED' ? state : { kind: 'RUNNING', since: Date.now() } }),
      );
      (deps.execution.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        outcome: 'REJECTED', error: 'clOrdId too long', errorCode: 'CLIENT_ID_TOO_LONG',
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(deps.execution.execute).toHaveBeenCalledTimes(1);
      expect((runner as unknown as { fsmState: { kind: string } }).fsmState.kind).toBe('PAUSED');
      expect(onCriticalEvent).toHaveBeenCalledWith({
        kind: 'PAUSED_PERMANENT_ERROR', reason: 'CLIENT_ID_TOO_LONG', message: 'clOrdId too long',
      });

      (deps.execution.execute as ReturnType<typeof vi.fn>).mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(deps.execution.execute).not.toHaveBeenCalled();
    });
  });

  describe('stop — 清理失败上报', () => {
    it('返回 cancelFailed 列表（含 getOpenOrders 失败和单个 cancel 失败）', async () => {
      (adapter.getOpenOrders as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
      await startRunner(runner, adapter, deps, createInitialState());

      let resolved = false;
      const stopPromise = runner.stop().then((r) => { resolved = true; return r; });
      for (let i = 0; i < 20 && !resolved; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      const result = await stopPromise;

      expect(result.cancelFailed).toContain('getOpenOrders');
    });

    it('所有 cancel 成功时返回空 cancelFailed', async () => {
      (adapter.getOpenOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(runner, adapter, deps, createInitialState());

      let resolved = false;
      const stopPromise = runner.stop().then((r) => { resolved = true; return r; });
      for (let i = 0; i < 20 && !resolved; i++) {
        await vi.advanceTimersByTimeAsync(1000);
      }
      const result = await stopPromise;

      expect(result.cancelFailed).toEqual([]);
    });
  });

  describe('cancelStaleOrdersOnSymbol', () => {
    it('清理旧 session 的网格单和 algo 单，不清理自己的', async () => {
      const myOrder = { orderId: 'my1', clientOrderId: 'test-sessionB1', symbol: 'ETH/USDT', status: 'PENDING' as const };
      const staleGrid = { orderId: 'stale1', clientOrderId: 'ETHUSDT260607120000B1', symbol: 'ETH/USDT', status: 'PENDING' as const };
      const staleAlgo: AlgoOrder = {
        algoOrderId: 'sa1',
        clientOrderId: 'ETHUSDT_260607120000_algo_grid_0001',
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        triggerPrice: 1800,
        status: 'PENDING',
      };
      const getOpenOrdersMock = adapter.getOpenOrders as ReturnType<typeof vi.fn>;
      const getAlgoOrdersMock = adapter.getAlgoOrders as ReturnType<typeof vi.fn>;

      getOpenOrdersMock.mockResolvedValue([staleGrid]);
      getAlgoOrdersMock.mockResolvedValue([staleAlgo]);
      await startRunner(runner, adapter, deps, createInitialState());

      expect(adapter.cancelOrder).toHaveBeenCalledWith('stale1', 'ETH/USDT', expect.anything());
      expect(adapter.cancelOrder).not.toHaveBeenCalledWith('my1', 'ETH/USDT', expect.anything());
      expect(adapter.cancelAlgoOrder).toHaveBeenCalledWith('sa1', 'ETH/USDT', expect.anything());

      const cancelCalls = (adapter.cancelOrder as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of cancelCalls) {
        expect(call[0]).not.toBe('my1');
      }
    });
  });

  describe('cancelWithRetry', () => {
    it('重试 3 次后返回 false', async () => {
      (adapter.getAlgoOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (adapter.getOpenOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await startRunner(runner, adapter, deps, createInitialState());

      const cancelOrderMock = adapter.cancelOrder as ReturnType<typeof vi.fn>;
      cancelOrderMock.mockClear();
      cancelOrderMock.mockRejectedValue(new Error('timeout'));
      const getOpenMock = adapter.getOpenOrders as ReturnType<typeof vi.fn>;
      getOpenMock.mockClear();
      getOpenMock.mockResolvedValue([
        { orderId: 'o1', clientOrderId: 'test-sessionB1', symbol: 'ETH/USDT', status: 'PENDING' as const },
      ]);

      let resolved = false;
      const stopPromise = runner.stop().then((r) => { resolved = true; return r; });

      for (let i = 0; i < 30 && !resolved; i++) {
        await vi.advanceTimersByTimeAsync(500);
      }

      if (!resolved) await stopPromise;
      const result = await stopPromise;

      expect(cancelOrderMock).toHaveBeenCalledTimes(3);
      expect(result.cancelFailed).toContain('o1');
    });
  });

  describe('Critical events (onCriticalEvent)', () => {
    it('可操作拒单触发 ORDER_REJECTED 事件', async () => {
      const onCriticalEvent = vi.fn();
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let calls = 0;
      deps.execution.execute.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'account restricted', errorCode: 'ACCOUNT_MODE_RESTRICTED' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).toHaveBeenCalledWith({
        kind: 'ORDER_REJECTED', reason: 'ACCOUNT_MODE_RESTRICTED', message: 'account restricted',
      });
    });

    it('非白名单拒单不触发事件', async () => {
      const onCriticalEvent = vi.fn();
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let calls = 0;
      deps.execution.execute.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'would not match', errorCode: 'SOME_RANDOM_CODE' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).not.toHaveBeenCalled();
    });

    it('连续拒单达上限自停时触发 STOPPED_REJECTIONS 事件', async () => {
      const onCriticalEvent = vi.fn();
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      // 内部预置是为了避免推进 50 轮退避计时器；非白名单码也能触发自停（自停事件不要求可操作原因）
      (runner as any).consecutiveRejections = (GridBotRunner as any).MAX_CONSECUTIVE_REJECTIONS - 1;
      deps.execution.execute.mockResolvedValue({ outcome: 'REJECTED', error: 'margin', errorCode: 'SOME_RANDOM_CODE' });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).toHaveBeenCalledWith({
        kind: 'STOPPED_REJECTIONS', reason: 'SOME_RANDOM_CODE', message: 'margin',
      });
    });

    it('回调抛错不影响主循环（后续仍能重试下单）', async () => {
      const onCriticalEvent = vi.fn().mockImplementation(() => { throw new Error('callback boom'); });
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let calls = 0;
      deps.execution.execute.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'account restricted', errorCode: 'ACCOUNT_MODE_RESTRICTED' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).toHaveBeenCalled();
      expect(calls).toBeGreaterThanOrEqual(2); // 回调抛错被吞，重试继续
    });

    it('async 回调 rejected 不产生 unhandled rejection，主循环继续', async () => {
      const onCriticalEvent = vi.fn().mockImplementation(async () => { throw new Error('async boom'); });
      (deps as any).onCriticalEvent = onCriticalEvent;
      await startRunner(runner, adapter, deps, createInitialState());
      deps.fsm.transition.mockReturnValue({ newState: { kind: 'RUNNING', since: Date.now() } });

      let calls = 0;
      deps.execution.execute.mockImplementation(() => {
        calls++;
        if (calls === 1) {
          return Promise.resolve({ outcome: 'REJECTED', error: 'account restricted', errorCode: 'ACCOUNT_MODE_RESTRICTED' });
        }
        return Promise.resolve({ outcome: 'PLACED', orderId: 'ok' });
      });
      deps.strategy.computeDesiredOrders.mockReturnValue({
        action: 'PLACE', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', reason: 'test',
      });
      (runner as any).lastTicker = { bid: 1999, ask: 2001, last: 2000 };

      await vi.advanceTimersByTimeAsync(10000);

      expect(onCriticalEvent).toHaveBeenCalled();
      // async rejection 必须被 .catch() 捕获并记录 warn，而非静默逃逸
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('async callback failed'),
      );
      expect(calls).toBeGreaterThanOrEqual(2); // rejection 被吞后主循环未中断
    });
  });
});

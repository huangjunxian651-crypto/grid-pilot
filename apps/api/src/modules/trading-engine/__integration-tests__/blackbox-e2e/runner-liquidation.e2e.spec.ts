import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockExchangeAdapter } from './mock-exchange-adapter';
import { GridBotRunner, type BotConfig } from '../../runner/grid-bot-runner';
import { BotFsm } from '../../fsm/bot-fsm';
import { StrategyEngine } from '../../strategy/strategy-engine';
import { ExecutionEngine } from '../../execution/execution-engine';
import { ExchangeTruthService } from '../../exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor } from '../../reconstructor/bot-state-reconstructor';
import { delay, waitForState } from './test-helpers';

function makeConfig(): BotConfig {
  return {
    configId: 'test-cfg',
    runCode: 'session-1',
    symbol: 'ETH_USDT',
    direction: 'LONG',
    takeProfitPrice: 2800,
    mainGridCount: 235,
    mainGridStep: 2.5,
    mainGridPortionSize: 0.05,
    leverage: 20,
    stopLossGridCount: 4,
    stopLossGridStep: 2.5,
    isolationStep: 2.5,
    reorderThreshold: 0.0002,
    gtcBoundary: 1.02,
    gtcThreshold: 0.001,
    trailingEntry: false,
    pollIntervalMs: 100,
  };
}

describe('GridBotRunner LIQUIDATING lifecycle (blackbox)', () => {
  let adapter: MockExchangeAdapter;
  let runner: GridBotRunner;

  beforeEach(() => {
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(makeConfig(), adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
    });
  });

  afterEach(async () => {
    if (runner?.isRunning?.()) {
      await runner.stop();
    }
  });

  it('transitions to LIQUIDATING and cancels orders + closes position on stop-loss breach', async () => {
    adapter.pushPosition(5.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2500);
    await delay(300);
    expect(adapter.placedOrders.length).toBeGreaterThan(0);

    adapter.resetTracking();

    adapter.pushTick(2190);
    await delay(500);

    expect(adapter.cancelledOrders.length).toBeGreaterThan(0);
    expect(adapter.closedPositions.length).toBeGreaterThan(0);
    expect(adapter.closedPositions[0].side).toBe('LONG');
    expect(adapter.closedPositions[0].qty).toBeCloseTo(5.0, 10);
  });

  it('does not liquidate when stopLossGridCount is 0 (no-stop-loss mode)', async () => {
    const noSlConfig: BotConfig = { ...makeConfig(), stopLossGridCount: 0 };
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(noSlConfig, adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
    });

    adapter.pushPosition(5.0, 2500);
    await runner.start();
    await delay(100);

    // Price below fullPositionPrice but stopLossGridCount === 0 → stay RUNNING
    adapter.pushTick(2190);
    await waitForState(runner, 'RUNNING');

    const state = runner.getState();
    expect(state).not.toBeNull();
    expect(state!.fsm.kind).toBe('RUNNING');
    expect(adapter.closedPositions.length).toBe(0);

    await runner.stop();
  });

  it('cancels grid orders and closes position when entering LIQUIDATING', async () => {
    adapter.setAlgoOrders([
      {
        algoOrderId: 'existing-algo-1',
        symbol: 'ETH_USDT',
        side: 'SELL',
        qty: 0.5,
        triggerPrice: 2200,
        status: 'PENDING',
      },
    ]);

    adapter.pushPosition(5.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2500);
    await delay(300);

    adapter.resetTracking();

    adapter.pushTick(2190);
    await delay(500);

    expect(adapter.cancelledOrders.length).toBeGreaterThan(0);
    expect(adapter.closedPositions.length).toBeGreaterThan(0);
    expect(adapter.closedPositions[0].qty).toBeCloseTo(5.0, 3);

    if (runner.isRunning()) {
      await runner.stop();
    }
  });

  it('transitions to LIQUIDATED after position is closed', async () => {
    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2190);
    await delay(500);

    expect(runner.isRunning()).toBe(false);
    expect(adapter.closedPositions.length).toBeGreaterThan(0);
  });

  it('retries the market close when the exchange leaves a residual position', async () => {
    const residualConfig: BotConfig = { ...makeConfig(), liquidationRetryDelayMs: 20 };
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(residualConfig, adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
    });

    // 市价平仓永远留 1.0 残留：单次平仓清不干净
    adapter.setCloseResidual(1.0);
    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2190);
    await delay(500);

    // 现状只平一次就收尾；期望：清不干净要重试，平仓被调用多次
    expect(adapter.closedPositions.length).toBeGreaterThan(1);
  });

  it('emits a RESIDUAL_POSITION critical event when the position cannot be fully closed', async () => {
    const events: import('../../runner/grid-bot-runner').RunnerCriticalEvent[] = [];
    const residualConfig: BotConfig = { ...makeConfig(), liquidationRetryDelayMs: 20 };
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(residualConfig, adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
      onCriticalEvent: (e) => { events.push(e); },
    });

    adapter.setCloseResidual(1.0);
    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2190);
    await delay(500);

    expect(events.some((e) => e.kind === 'RESIDUAL_POSITION')).toBe(true);
    // 残留未清干净，不得谎报已清算终态
    expect(runner.getState()?.fsm.kind).not.toBe('LIQUIDATED');
  });

  it('stops cleanly when fully closed after retrying (no residual alert)', async () => {
    const events: import('../../runner/grid-bot-runner').RunnerCriticalEvent[] = [];
    const retryConfig: BotConfig = { ...makeConfig(), liquidationRetryDelayMs: 20 };
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(retryConfig, adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
      onCriticalEvent: (e) => { events.push(e); },
    });

    // 前两次平仓留残留，第三次清干净
    adapter.setCloseResidual(1.0, 3);
    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2190);
    await delay(500);

    expect(adapter.closedPositions.length).toBe(3);
    expect(events.some((e) => e.kind === 'RESIDUAL_POSITION')).toBe(false);
    expect(runner.getState()?.fsm.kind).toBe('LIQUIDATED');
  });

  it('does not hang requestLiquidation when position refresh fails mid-liquidation', async () => {
    const events: import('../../runner/grid-bot-runner').RunnerCriticalEvent[] = [];
    const retryConfig: BotConfig = { ...makeConfig(), liquidationRetryDelayMs: 20 };
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    runner = new GridBotRunner(retryConfig, adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
      onCriticalEvent: (e) => { events.push(e); },
    });

    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(100);

    // 清算开始后持仓刷新接口持续抛错：不得让 requestLiquidation 调用方挂死
    adapter.setPositionFetchError(true);
    const liquidation = runner.requestLiquidation();
    const outcome = await Promise.race([
      liquidation.then(() => 'RESOLVED'),
      delay(800).then(() => 'HANG'),
    ]);

    expect(outcome).toBe('RESOLVED');
    expect(events.some((e) => e.kind === 'RESIDUAL_POSITION')).toBe(true);
  });

  it('does not emit RESIDUAL_POSITION when the close fully succeeds', async () => {
    const events: import('../../runner/grid-bot-runner').RunnerCriticalEvent[] = [];
    const cleanAdapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(cleanAdapter as any);
    const execution = new ExecutionEngine(cleanAdapter as any);
    const cleanRunner = new GridBotRunner(makeConfig(), cleanAdapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
      onCriticalEvent: (e) => { events.push(e); },
    });

    cleanAdapter.pushPosition(3.0, 2500);
    await cleanRunner.start();
    await delay(100);

    cleanAdapter.pushTick(2190);
    await delay(500);

    expect(events.some((e) => e.kind === 'RESIDUAL_POSITION')).toBe(false);
    if (cleanRunner.isRunning()) {
      await cleanRunner.stop();
    }
  });

  it('fires onStateChange with LIQUIDATED state when auto-liquidation completes', async () => {
    const stateChanges: import('../../types/bot-state.types').BotFsmState[] = [];
    const trackingAdapter = new MockExchangeAdapter();
    const trackingTruth = new ExchangeTruthService(trackingAdapter as any);
    const trackingExecution = new ExecutionEngine(trackingAdapter as any);
    const trackingRunner = new GridBotRunner(makeConfig(), trackingAdapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution: trackingExecution,
      truth: trackingTruth,
      reconstructor: new BotStateReconstructor(),
      onStateChange: (state) => { stateChanges.push(state.fsm); },
    });

    trackingAdapter.pushPosition(3.0, 2500);
    await trackingRunner.start();
    await delay(100);

    trackingAdapter.pushTick(2190);
    await delay(600);

    const terminalState = stateChanges.find((s) => s.kind === 'LIQUIDATED');
    expect(terminalState).toBeDefined();
    expect(terminalState!.kind).toBe('LIQUIDATED');

    if (trackingRunner.isRunning()) {
      await trackingRunner.stop();
    }
  });
});

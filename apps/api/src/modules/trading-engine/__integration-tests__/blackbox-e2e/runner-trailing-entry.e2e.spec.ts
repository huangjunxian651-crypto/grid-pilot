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
    trailingEntry: true,
    trailingCallbackRate: 0.002,
    entryPrice: 2300,
    pollIntervalMs: 100,
  };
}

describe('GridBotRunner TRAILING_ENTRY → RUNNING (blackbox)', () => {
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

  it('starts in TRAILING_ENTRY when price is below entryPrice', async () => {
    // entryPrice = 2300, price = 2250 (< entryPrice) → shouldTrail = true
    // Push tick BEFORE start so cold-start getTicker() sees the right price.
    adapter.pushTick(2250);
    adapter.pushPosition(0, 0);
    await runner.start();
    await delay(200);

    const state = runner.getState();
    expect(state).not.toBeNull();
    expect(state!.fsm.kind).toBe('TRAILING_ENTRY');

    await runner.stop();
  });

  it('transitions to RUNNING when price rebounds by trailingCallbackRate', async () => {
    // entryPrice = 2300, trailingCallbackRate = 0.002
    adapter.pushTick(2250);
    adapter.pushPosition(0, 0);
    await runner.start();
    await delay(200);

    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Price drops to 2240 — new extreme
    adapter.pushTick(2240);
    await delay(200);
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Rebound: triggerPrice = 2240 * 1.002 = 2244.48
    adapter.pushTick(2250);
    await waitForState(runner, 'RUNNING');

    const state = runner.getState();
    expect(state!.fsm.kind).toBe('RUNNING');

    await runner.stop();
  });

  it('updates extremePrice on deeper dips without triggering early', async () => {
    adapter.pushTick(2250);
    adapter.pushPosition(0, 0);
    await runner.start();
    await delay(200);

    // Dip to 2240
    adapter.pushTick(2240);
    await delay(200);
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Small rebound to 2244 (not enough: trigger = 2240 * 1.002 = 2244.48)
    adapter.pushTick(2244);
    await delay(200);
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Enough rebound to 2245 (> 2244.48)
    adapter.pushTick(2245);
    await waitForState(runner, 'RUNNING');

    expect(runner.getState()!.fsm.kind).toBe('RUNNING');

    await runner.stop();
  });

  it('places a grid order after transitioning to RUNNING', async () => {
    adapter.pushTick(2250);
    adapter.pushPosition(0, 0); // no position → trailing entry not skipped (Go bot_manager.go:382)
    await runner.start();
    await delay(200);

    // Start in TRAILING_ENTRY because price < entryPrice
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Trigger transition to RUNNING
    adapter.pushTick(2240);
    await delay(200);
    adapter.pushTick(2250);
    await waitForState(runner, 'RUNNING');

    expect(runner.getState()!.fsm.kind).toBe('RUNNING');

    // Now push a tick inside the box so strategy computes orders
    adapter.pushTick(2500);
    await delay(300);

    const orders = adapter.placedOrders;
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0].symbol).toBe('ETH_USDT');

    await runner.stop();
  });

  it('goes directly to LIQUIDATING if price breaches fullPositionPrice during trailing entry', async () => {
    adapter.pushTick(2250);
    adapter.pushPosition(0, 0);
    await runner.start();
    await delay(200);

    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    adapter.pushTick(2190);
    await delay(500);

    expect(runner.isRunning()).toBe(false);
  });
});

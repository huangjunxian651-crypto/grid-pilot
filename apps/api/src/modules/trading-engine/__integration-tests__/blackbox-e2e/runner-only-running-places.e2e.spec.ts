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
    gtcThreshold: 0.001,
    trailingEntry: true,
    trailingCallbackRate: 0.002,
    entryPrice: 2300,
    pollIntervalMs: 100,
  };
}

describe('GridBotRunner only RUNNING places grid orders (TODO #3, blackbox)', () => {
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

  // Plan A: drive to a confirmed PAUSED state, then push an in-box tick.
  //
  // PAUSED is a guaranteed non-RUNNING, non-terminal state that does NOT
  // auto-transition on TICK (bot-fsm.ts handlePaused only reacts to USER_RESUME).
  // This gives a stable window where the price is inside the box (2500) but the
  // FSM is NOT RUNNING. Go's bot_controller.go:543-545 forbids placing grid
  // orders unless FSM.Is(StateRunning); a naive TS impl that runs the strategy
  // block regardless of state would place a grid order here — that is the bug.
  it('PAUSED does NOT place grid orders even when price is inside the box (TODO #3)', async () => {
    adapter.pushTick(2250); // < entryPrice → start in TRAILING_ENTRY
    adapter.pushPosition(0, 0); // no position → trailing entry not skipped (Go bot_manager.go:382)
    await runner.start();
    await delay(200);
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    // Rebound to RUNNING so we have a valid running state to pause from.
    adapter.pushTick(2240); // deeper dip → new extreme
    await delay(200);
    adapter.pushTick(2250); // trigger = 2240 * 1.002 = 2244.48 → RUNNING
    await waitForState(runner, 'RUNNING');
    expect(runner.getState()!.fsm.kind).toBe('RUNNING');

    // Pause: RUNNING → PAUSED (USER_PAUSE handled only in handleRunning).
    runner.submitEvent({ type: 'USER_PAUSE' });
    await waitForState(runner, 'PAUSED');
    expect(runner.getState()!.fsm.kind).toBe('PAUSED');

    // Clear any orders placed/cancelled while RUNNING so we isolate PAUSED behaviour.
    // (RUNNING legitimately leaves an active order on the book; we don't care about it.)
    adapter.resetTracking();

    // Push a tick INSIDE the box. PAUSED stays PAUSED (no auto-transition).
    adapter.pushTick(2500);
    await delay(300);

    // Go-aligned (bot_controller.go:543-545): outside RUNNING the runner must run
    // NO grid-order strategy at all — neither placing a fresh grid order nor
    // reordering (cancel+re-place to chase price) the existing active order.
    expect(runner.getState()!.fsm.kind).toBe('PAUSED');
    expect(adapter.placedOrders.length).toBe(0);
    expect(adapter.cancelledOrders.length).toBe(0);

    await runner.stop();
  });
});

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
    runCode: 'session-pr',
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

describe('GridBotRunner pause→resume lifecycle (blackbox, domain-guide §2.3)', () => {
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

  /**
   * Drive the runner to PAUSED with the given position cached in the runner.
   *
   * positionQty: the baseAssetQty the runner will see via REST during the RUNNING
   * phase, and therefore have cached in this.position when USER_PAUSE fires.
   * This is critical for USER_RESUME: the FSM uses the runner's cached position
   * (not a fresh REST fetch) to decide TRAILING_ENTRY vs RUNNING.
   */
  async function driveToPaused(positionQty = 0, positionEntryPrice = 0) {
    adapter.pushTick(2250);                          // < entryPrice → TRAILING_ENTRY
    adapter.pushPosition(0, 0);                      // cold start: no position yet
    await runner.start();
    await delay(200);
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');

    adapter.pushTick(2240);                          // deeper dip → new extreme
    await delay(200);
    adapter.pushTick(2250);                          // trigger = 2240 * 1.002 = 2244.48 → RUNNING
    await waitForState(runner, 'RUNNING');

    // While RUNNING, populate the position the runner will cache via REST.
    // cleanStateCycle (pollIntervalMs=100ms) calls getPosition() each cycle;
    // pushPosition sets the mock's _position for subsequent REST calls.
    adapter.pushPosition(positionQty, positionEntryPrice);
    await delay(200);                                // allow ≥1 cleanStateCycle to fetch it

    runner.submitEvent({ type: 'USER_PAUSE' });
    await waitForState(runner, 'PAUSED');
    expect(runner.getState()!.fsm.kind).toBe('PAUSED');
    adapter.resetTracking();
  }

  // W2a / E2：空仓恢复 → 执行引擎 FSM 最终到达 TRAILING_ENTRY
  it('E2/W2a: resume with NO position → FSM settles in TRAILING_ENTRY', async () => {
    // driveToPaused with positionQty=0: runner caches qty=0 before PAUSE
    await driveToPaused(0, 0);
    runner.submitEvent({ type: 'USER_RESUME' });
    // USER_RESUME sees cached position qty=0 → FSM goes to TRAILING_ENTRY directly.
    // waitForState tolerates a brief polling window in case the event is async.
    await waitForState(runner, 'TRAILING_ENTRY');
    expect(runner.getState()!.fsm.kind).toBe('TRAILING_ENTRY');
  });

  // E1：有仓恢复 → FSM 直接回到 RUNNING
  it('E1: resume WITH position → FSM goes straight to RUNNING', async () => {
    // driveToPaused with positionQty=1: runner caches qty=1 before PAUSE.
    // This ensures USER_RESUME passes position.baseAssetQty > 0 to the FSM,
    // which then takes the direct PAUSED → RUNNING branch (bot-fsm.ts handlePaused).
    await driveToPaused(1, 2500);
    runner.submitEvent({ type: 'USER_RESUME' });
    await waitForState(runner, 'RUNNING');
    expect(runner.getState()!.fsm.kind).toBe('RUNNING');
  });

  // E3：PAUSED 期间连续多次 TICK 完全静默——不下单、不撤单、不转移
  it('E3: PAUSED stays silent across multiple ticks (no place/cancel/transition)', async () => {
    await driveToPaused(0, 0);
    for (const p of [2500, 2200, 2801, 2450]) {
      adapter.pushTick(p);
      await delay(120);
    }
    expect(runner.getState()!.fsm.kind).toBe('PAUSED');
    expect(adapter.placedOrders.length).toBe(0);
    expect(adapter.cancelledOrders.length).toBe(0);
  });
});

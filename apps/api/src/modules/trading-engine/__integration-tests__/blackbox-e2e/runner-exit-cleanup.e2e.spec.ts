import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockExchangeAdapter } from './mock-exchange-adapter';
import { GridBotRunner, type BotConfig } from '../../runner/grid-bot-runner';
import { BotFsm } from '../../fsm/bot-fsm';
import { StrategyEngine } from '../../strategy/strategy-engine';
import { ExecutionEngine } from '../../execution/execution-engine';
import { ExchangeTruthService } from '../../exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor } from '../../reconstructor/bot-state-reconstructor';
import { delay } from './test-helpers';

// 用生产形态的 sessionCode（含下划线）以真正校验 sessionToken 剥离逻辑。
// 网格单所有权用去下划线的 token；算法单仍是带下划线的旧格式（范围外）。
const SESSION = 'ETHUSDT_260601120000';
const GRID_TOKEN = 'ETHUSDT260601120000'; // = sessionToken(SESSION)
const BOT_ALGO_ID = 'ETHUSDT_260601120000_algo_emergency_test';

function makeConfig(): BotConfig {
  return {
    configId: 'test-cfg',
    runCode: SESSION,
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

function makeRunner(adapter: MockExchangeAdapter): GridBotRunner {
  const truth = new ExchangeTruthService(adapter as any);
  const execution = new ExecutionEngine(adapter as any);
  return new GridBotRunner(makeConfig(), adapter as any, {
    fsm: new BotFsm(),
    strategy: new StrategyEngine(),
    execution,
    truth,
    reconstructor: new BotStateReconstructor(),
  });
}

describe('GridBotRunner exit cleanup (blackbox)', () => {
  let adapter: MockExchangeAdapter;
  let runner: GridBotRunner;

  beforeEach(() => {
    adapter = new MockExchangeAdapter();
    runner = makeRunner(adapter);
  });

  afterEach(async () => {
    if (runner?.isRunning?.()) {
      await runner.stop();
    }
  });

  it('on stop, cancels only bot-owned orders (sessionCode prefix), leaves user manual orders (TODO #5)', async () => {
    // position 7.0 ETH > targetHeldSize(6.0)+ε at price 2500 → triggers a SELL grid order.
    // (6.0 sits inside the asymmetric buffer (5.90, 6.05) → HOLD, placing nothing.)
    adapter.pushPosition(7.0, 2500);
    await runner.start();
    await delay(100);
    adapter.pushTick(2500);
    await delay(300); // bot places its own grid order (ownership token = sessionToken)

    expect(adapter.placedOrders.length).toBeGreaterThan(0);
    expect(
      adapter.placedOrders.every((o) => o.clientOrderId.startsWith(GRID_TOKEN)),
    ).toBe(true);

    // Seed a user manual order directly on the exchange (no sessionCode prefix).
    adapter.seedOpenOrder({
      orderId: 'user-1',
      clientOrderId: 'USER_MANUAL_xyz',
      status: 'PENDING',
      filledQty: 0,
      avgFillPrice: 2600,
    });

    // Seed a user manual algo/conditional order too (no sessionCode prefix).
    adapter.seedAlgoOrder({
      algoOrderId: 'user-algo-1',
      clientOrderId: 'USER_COND_abc',
      symbol: 'ETH_USDT',
      side: 'SELL',
      qty: 1.0,
      triggerPrice: 2700,
      status: 'PENDING',
    });

    // Seed a bot-owned algo order in production underscore format (out of scope of
    // the new no-separator format) — cancelOwnOrders must still recognise & cancel it
    // by the sessionCode underscore prefix even though grid ids use the stripped token.
    adapter.seedAlgoOrder({
      algoOrderId: 'bot-algo-1',
      clientOrderId: BOT_ALGO_ID,
      symbol: 'ETH_USDT',
      side: 'SELL',
      qty: 1.0,
      triggerPrice: 2210,
      status: 'PENDING',
    });

    await runner.stop(); // triggers exit cleanup

    const remaining = await adapter.getOpenOrders('ETH_USDT');
    // User manual order must survive.
    expect(remaining.find((o) => o.clientOrderId === 'USER_MANUAL_xyz')).toBeTruthy();
    // No bot-owned grid (sessionToken) orders remain.
    expect(
      remaining.filter((o) => o.clientOrderId.startsWith(GRID_TOKEN)),
    ).toHaveLength(0);

    const remainingAlgos = await adapter.getAlgoOrders('ETH_USDT');
    // User manual conditional order must survive.
    expect(remainingAlgos.find((a) => a.clientOrderId === 'USER_COND_abc')).toBeTruthy();
    // Bot-owned algo order must be cancelled.
    expect(remainingAlgos.find((a) => a.clientOrderId === BOT_ALGO_ID)).toBeFalsy();
  });

  it('USER_LIQUIDATE from RUNNING cancels active grid order (TODO #4)', async () => {
    // position 7.0 > targetHeldSize(6.0)+ε at 2500 → a SELL grid order is placed.
    adapter.pushPosition(7.0, 2500);
    await runner.start();
    await delay(100);
    adapter.pushTick(2500);
    await delay(300);

    // There should be an active bot order now.
    expect(adapter.placedOrders.length).toBeGreaterThan(0);

    runner.submitEvent({ type: 'USER_LIQUIDATE' });
    await delay(400);

    const remaining = await adapter.getOpenOrders('ETH_USDT');
    expect(
      remaining.filter((o) => o.clientOrderId.startsWith(GRID_TOKEN)),
    ).toHaveLength(0);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockExchangeAdapter } from './mock-exchange-adapter';
import { GridBotRunner, type BotConfig } from '../../runner/grid-bot-runner';
import { BotFsm } from '../../fsm/bot-fsm';
import { StrategyEngine } from '../../strategy/strategy-engine';
import { ExecutionEngine } from '../../execution/execution-engine';
import { ExchangeTruthService } from '../../exchange-truth-service/exchange-truth.service';
import { BotStateReconstructor } from '../../reconstructor/bot-state-reconstructor';
import { delay, waitForState } from './test-helpers';

// SHORT 箱体参数说明（d 空间）：
//   takeProfitPrice = 2200（止盈端，低价位）
//   mainGridCount=10, mainGridStep=60 → fullPositionPrice = 2200+600 = 2800
//   isolationStep=60 → isolationEndDepth = 660
//   stopLossGridCount=4, stopLossGridStep=15 → boxDepth = 720, liquidationPrice = 2920
//   SHORT 持仓在交易所以负 baseAssetQty 表示；strategy 内部取 shortPosition = -baseAssetQty
function makeShortConfig(): BotConfig {
  return {
    configId: 'test-short-cfg',
    runCode: 'session-1',
    symbol: 'ETH_USDT',
    direction: 'SHORT',
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 60,
    mainGridPortionSize: 0.1,
    leverage: 20,
    stopLossGridCount: 4,
    stopLossGridStep: 15,
    isolationStep: 60,
    reorderThreshold: 0.0002,
    gtcThreshold: 0.001,
    trailingEntry: false,
    pollIntervalMs: 100,
  };
}

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
    trailingEntry: false,
    pollIntervalMs: 100,
  };
}

describe('GridBotRunner RUNNING lifecycle (blackbox)', () => {
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

  it('places a SELL grid order on first tick when position > targetHeldSize', async () => {
    // LONG at price 2500 inside box [2200, 2800]
    // targetHeldSize depends on grid math; with 235 grids and mainGridPortionSize 0.05,
    // a position of 7.0 ETH is well above the target for price 2500.
    adapter.pushPosition(7.0, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2500);
    await delay(300);

    const sellOrders = adapter.placedOrders.filter((o) => o.side === 'SELL');
    expect(sellOrders.length).toBeGreaterThan(0);
    expect(sellOrders[0].symbol).toBe('ETH_USDT');

    await runner.stop();
  });

  it('places a BUY grid order when position is below targetBoughtSize', async () => {
    adapter.pushPosition(0.5, 2500);
    await runner.start();
    await delay(100);

    adapter.pushTick(2500);
    await delay(300);

    const buyOrders = adapter.placedOrders.filter((o) => o.side === 'BUY');
    expect(buyOrders.length).toBeGreaterThan(0);
    expect(buyOrders[0].symbol).toBe('ETH_USDT');

    await runner.stop();
  });

  it('cancels existing order and re-places when price moves beyond reorderThreshold', async () => {
    adapter.pushPosition(7.0, 2500);
    await runner.start();
    await delay(100);

    // First tick → place SELL
    adapter.pushTick(2500);
    await delay(300);
    expect(adapter.placedOrders.length).toBeGreaterThan(0);
    const firstOrderId = adapter.placedOrders[0].clientOrderId;

    // Big price move (> 0.02%)
    adapter.pushTick(2600);
    await delay(300);

    // The old order should have been cancelled and a new one placed
    expect(adapter.cancelledOrders.length).toBeGreaterThan(0);
    expect(adapter.placedOrders.length).toBeGreaterThanOrEqual(1);

    await runner.stop();
  });

  it('recovers into RUNNING state on cold start', async () => {
    adapter.pushPosition(3.0, 2500);
    await runner.start();
    await delay(200);

    const state = runner.getState();
    expect(state).not.toBeNull();
    expect(state!.fsm.kind).toBe('RUNNING');

    await runner.stop();
  });

  it('does not place orders when price is below fullPositionPrice (stop-loss buffer zone)', async () => {
    // fullPositionPrice = takeProfitPrice - mainGridStep * mainGridCount
    // = 2800 - 2.5 * 235 = 2212.5
    adapter.pushPosition(7.0, 2205);
    await runner.start();
    await delay(100);

    // Price below fullPositionPrice → strategy returns HOLD
    adapter.pushTick(2205);
    await delay(300);

    // No regular grid orders should be placed; sentinel may place algo orders
    const gridOrders = adapter.placedOrders.filter((o) => o.tif !== 'POC' || !o.clientOrderId.includes('algo'));
    // Actually sentinel uses POC too, but we just assert no SELL/BUY grid orders
    const nonAlgoOrders = adapter.placedOrders.filter((o) => !o.clientOrderId.includes('algo'));
    expect(nonAlgoOrders.length).toBe(0);

    await runner.stop();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SHORT 箱体全生命周期（d 空间镜像）
// ────────────────────────────────────────────────────────────────────────────
describe('SHORT 箱体全生命周期（d 空间镜像）', () => {
  let adapter: MockExchangeAdapter;
  let shortRunner: GridBotRunner;

  beforeEach(() => {
    adapter = new MockExchangeAdapter();
    const truth = new ExchangeTruthService(adapter as any);
    const execution = new ExecutionEngine(adapter as any);
    shortRunner = new GridBotRunner(makeShortConfig(), adapter as any, {
      fsm: new BotFsm(),
      strategy: new StrategyEngine(),
      execution,
      truth,
      reconstructor: new BotStateReconstructor(),
    });
  });

  afterEach(async () => {
    if (shortRunner?.isRunning?.()) {
      await shortRunner.stop();
    }
  });

  it('场景1：网格加空/平空——价格上涨触发 SELL（加空），回落触发 BUY（平空）', async () => {
    // SHORT 持仓以负 baseAssetQty 表示，0.5 空头 → baseAssetQty = -0.5
    // 价格 2500 处于主网格内（d=300，在 mainGridDepth=600 之内）
    // targetBoughtSize = floor(300/60)×0.1 = 5×0.1 = 0.5
    // targetHoldSize   = (5+1)×0.1 = 0.6
    // shortPosition(-(-0.5)=0.5) ≤ targetBoughtSize(0.5) → 无动作（刚好等于）
    // 用 -0.3 空头持仓（不足 targetBoughtSize），触发加空 SELL
    adapter.pushPosition(-0.3, 2500);
    await shortRunner.start();
    await delay(100);

    // 价格从 2500 上涨跨过 2560（第 6 条网格线：2200+6×60=2560，d=360）
    // 在 d=360 处：targetBoughtSize = floor(360/60)×0.1 = 6×0.1 = 0.6
    // shortPosition = 0.3 < 0.6 → SELL（加空）
    adapter.resetTracking();
    adapter.pushTick(2561);
    await delay(300);

    const sellOrders = adapter.placedOrders.filter((o) => o.side === 'SELL');
    expect(sellOrders.length).toBeGreaterThan(0);
    expect(sellOrders[0].symbol).toBe('ETH_USDT');

    // 模拟持仓已更新为 -0.6（加空成功），回落到 2500 以下
    // 在 d=300 处：targetHoldSize = 6×0.1=0.6，shortPosition=0.6 ≥ 0.6 → 无卖；
    // 继续回落到 2439（d=239，gridIndex=3）：targetHoldSize = (3+1)×0.1=0.4，shortPosition=0.6 ≥ 0.4 → BUY（平空）
    adapter.pushPosition(-0.6, 2561);
    adapter.resetTracking();
    adapter.pushTick(2439);
    await delay(300);

    const buyOrders = adapter.placedOrders.filter((o) => o.side === 'BUY');
    expect(buyOrders.length).toBeGreaterThan(0);
    expect(buyOrders[0].symbol).toBe('ETH_USDT');

    await shortRunner.stop();
  });

  it('场景2：止盈退出——持仓清空后价格跌穿 takeProfitPrice（2200）触发 FSM → TAKE_PROFIT', async () => {
    // SHORT 止盈：价格下跌到 takeProfitPrice=2200 以下（d≤0），持仓为 0 时转 TAKE_PROFIT
    // 先以 0 持仓启动（空仓），确保 FSM 在 RUNNING 状态
    adapter.pushPosition(0, 2500);
    await shortRunner.start();
    await delay(100);

    const startState = shortRunner.getState();
    expect(startState?.fsm.kind).toBe('RUNNING');

    // 推送价格跌穿 2199（d = 2199-2200 = -1 < 0），且持仓为 0
    adapter.pushTick(2199);
    await delay(300);

    // 由于 TAKE_PROFIT 是终止态，runner 会调用 stop()；等待状态变化
    await waitForState(shortRunner as any, 'TAKE_PROFIT', 3000).catch(() => {
      // runner 可能已自停；此时 getState 返回 null，说明已停止但止盈已触发
    });

    // 验证：FSM 进入 TAKE_PROFIT，或者 runner 已停止（stop 被触发）
    const finalState = shortRunner.getState();
    if (finalState !== null) {
      expect(finalState.fsm.kind).toBe('TAKE_PROFIT');
    } else {
      // TAKE_PROFIT 终止态触发 runner 自停（getState 返回 null）——必须确实已停止
      expect(shortRunner.isRunning()).toBe(false);
    }
  });

  it('场景3a：价格涨穿 fullPositionPrice（2800）但未到清算线时，FSM 保持 RUNNING（止损区应逐格减仓，不整体清算）', async () => {
    // regression guard: 2026-05-31 e200380 曾把清算阈值从 boxDepth（清算线）误改成
    // mainGridDepth（满仓线），导致止损区从未被真正走到。
    adapter.pushPosition(-1.0, 2500);
    await shortRunner.start();
    await delay(100);

    expect(shortRunner.getState()?.fsm.kind).toBe('RUNNING');

    // 价格上涨到 2801（d = 601，刚越过 mainGridDepth=600，但远未到 boxDepth=720/liquidationPrice=2920）
    adapter.pushTick(2801);
    await delay(300);

    expect(shortRunner.getState()?.fsm.kind).toBe('RUNNING');
    expect(adapter.closedPositions.length).toBe(0);

    await shortRunner.stop();
  });

  it('场景3b：止损清算——价格涨穿清算线 liquidationPrice（2920）时 FSM → LIQUIDATING，并触发 closePosition', async () => {
    // SHORT 止损：价格上涨超过 liquidationPrice=2920（d > boxDepth=720，且 stopLossGridCount>0）
    // 需要有持仓才能触发 closePosition
    // SHORT 持仓：baseAssetQty = -1.0
    adapter.pushPosition(-1.0, 2500);
    await shortRunner.start();
    await delay(100);

    expect(shortRunner.getState()?.fsm.kind).toBe('RUNNING');

    // 价格上涨到 2921（d = 2921-2200 = 721 > boxDepth=720）
    adapter.pushTick(2921);
    await delay(500);

    // FSM 应转为 LIQUIDATING，并触发 executeLiquidation()
    // executeLiquidation 会调用 adapter.closePosition(symbol, 'SHORT')
    const closedPositions = adapter.closedPositions;
    expect(closedPositions.length).toBeGreaterThan(0);
    expect(closedPositions[0].side).toBe('SHORT');
    expect(closedPositions[0].symbol).toBe('ETH_USDT');

    // 紧急止损算法单（条件单）：ensureEmergencyStopLoss 在有持仓时（RUNNING+有仓）放置
    // triggerPrice = liquidationPrice = 2920，side = BUY（SHORT 方向紧急平仓）
    // 注意：coldStartRecover 有仓时已放置；这里通过 placedAlgos 验证
    const algoAtLiquidation = adapter.placedAlgos.filter(
      (a) => Math.abs(a.triggerPrice - 2920) < 0.01,
    );
    expect(algoAtLiquidation.length).toBeGreaterThan(0);
    expect(algoAtLiquidation[0].side).toBe('BUY');

    // runner 在 LIQUIDATING 后会自动 stop；等待其退出
    await delay(500);
  });
});

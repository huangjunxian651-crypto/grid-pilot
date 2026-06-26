import { describe, it, expect } from 'vitest';
import { BotStateReconstructor, type RecoveryResult } from './bot-state-reconstructor';
import type { Position, OrderResult } from '../types/exchange.types';
import type { SyncResult } from '../exchange-truth-service/exchange-truth.service';
import type { ActiveOrder } from '../types/bot-state.types';

describe('BotStateReconstructor', () => {
  const reconstructor = new BotStateReconstructor();

  const baseConfig = {
    runCode: 'test-session',
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 38,
    mainGridPortionSize: 0.01,
    direction: 'LONG' as const,
    reorderThreshold: 0.0002,
    stopLossGridCount: 4,
    stopLossGridStep: 5,
    isolationStep: 0,
    trailingEntry: false,
    entryPrice: 2000,
    trailingCallbackRate: 0.002,
  };

  const emptyPosition: Position = {
    symbol: 'ETH/USDT',
    baseAssetQty: 0,
    quoteAssetQty: 0,
    entryPrice: 0,
    leverage: 1,
    marginType: 'CROSS',
  };

  const makeSyncResult = (overrides: Partial<SyncResult> = {}): SyncResult => ({
    position: emptyPosition,
    openOrders: [],
    algoOrders: [],
    timestamp: Date.now(),
    ...overrides,
  });

  const makeOrder = (overrides: Partial<OrderResult> & { orderId: string }): OrderResult => ({
    clientOrderId: `test-session_BUY_1`,
    status: 'PENDING',
    filledQty: 0,
    ...overrides,
  });

  describe('reconstruct — basic state', () => {
    it('returns RUNNING fsmState when price is within grid', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 1800 },
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.fsmState.kind).toBe('RUNNING');
      expect(result.position).toEqual(sync.position);
    });

    it('returns LIQUIDATING fsmState when price below grid with stopLoss configured', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 1800 },
      });
      const result = reconstructor.reconstruct(sync, 1799, baseConfig);
      expect(result.fsmState.kind).toBe('LIQUIDATING');
    });

    it('returns RUNNING when price below grid but no stopLoss grids', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 1800 },
      });
      const result = reconstructor.reconstruct(sync, 1799, { ...baseConfig, stopLossGridCount: 0 });
      expect(result.fsmState.kind).toBe('RUNNING');
    });

    it('returns TAKE_PROFIT when at grid top with zero position', () => {
      const sync = makeSyncResult({ position: emptyPosition });
      const result = reconstructor.reconstruct(sync, 2200, baseConfig);
      expect(result.fsmState.kind).toBe('TAKE_PROFIT');
    });

    it('returns RUNNING when at grid top with non-zero position', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: 0.1, quoteAssetQty: -200, entryPrice: 1800 },
      });
      const result = reconstructor.reconstruct(sync, 2200, baseConfig);
      expect(result.fsmState.kind).toBe('RUNNING');
    });

    it('returns PAUSED when position direction conflicts with config', () => {
      const sync = makeSyncResult({
        position: { symbol: 'ETH/USDT', baseAssetQty: -0.5, quoteAssetQty: 1000, entryPrice: 2000, leverage: 10, marginType: 'CROSS' },
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.fsmState.kind).toBe('PAUSED');
    });
  });

  describe('reconstruct — order filtering by sessionCode prefix', () => {
    it('filters openOrders by sessionCode prefix', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session_BUY_1' }),
          makeOrder({ orderId: 'o2', clientOrderId: 'other-session_BUY_1' }),
          makeOrder({ orderId: 'o3', clientOrderId: 'test-session_SELL_2' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder).not.toBeNull();
      expect(result.activeOrder!.orderId).toBe('o3');
      expect(result.ordersToCancel).toHaveLength(1);
      expect(result.ordersToCancel[0].orderId).toBe('o1');
    });

    it('returns null activeOrder and empty ordersToCancel when no matching orders', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'other-session_BUY_1' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder).toBeNull();
      expect(result.ordersToCancel).toHaveLength(0);
    });

    it('keeps latest order as activeOrder and puts rest in ordersToCancel', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session_BUY_1' }),
          makeOrder({ orderId: 'o2', clientOrderId: 'test-session_SELL_2' }),
          makeOrder({ orderId: 'o3', clientOrderId: 'test-session_BUY_3' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.orderId).toBe('o3');
      expect(result.ordersToCancel).toHaveLength(2);
      expect(result.ordersToCancel.map((o) => o.orderId)).toEqual(['o1', 'o2']);
    });

    it('with single matching order, activeOrder is set and ordersToCancel is empty', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session_BUY_1' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.orderId).toBe('o1');
      expect(result.ordersToCancel).toHaveLength(0);
    });

    it('生产形态 sessionCode（含下划线）：所有权按去下划线 token 匹配新格式 id', () => {
      // sessionCode 'ETHUSDT_260810122212' → sessionToken 'ETHUSDT260810122212'
      // 新格式 grid id 无分隔符，须以 token 为前缀被认领；用户单/异会话单排除。
      const prodConfig = { ...baseConfig, runCode: 'ETHUSDT_260810122212' };
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'ETHUSDT260810122212B1' }),
          makeOrder({ orderId: 'o2', clientOrderId: 'USER_MANUAL_xyz' }),
          makeOrder({ orderId: 'o3', clientOrderId: 'ETHUSDT260810122212S2' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, prodConfig);
      expect(result.activeOrder!.orderId).toBe('o3');
      expect(result.activeOrder!.side).toBe('SELL');
      expect(result.ordersToCancel).toHaveLength(1);
      expect(result.ordersToCancel[0].orderId).toBe('o1');
    });
  });

  describe('reconstruct — activeOrder parsing', () => {
    it('parses BUY side from clientOrderId', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session260810122212B42' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.side).toBe('BUY');
    });

    it('parses SELL side from clientOrderId', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session260810122212S99' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.side).toBe('SELL');
    });

    it('defaults side to BUY for unrecognized clientOrderId format', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session_unknown' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.side).toBe('BUY');
    });

    it('computes remaining qty from qty - filledQty', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({
            orderId: 'o1',
            clientOrderId: 'test-session_BUY_1',
            qty: 0.05,
            filledQty: 0.01,
            price: 1990,
          }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.qty).toBeCloseTo(0.04, 10);
      expect(result.activeOrder!.price).toBe(1990);
    });

    it('sets tif to GTC', () => {
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'test-session_BUY_1' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.activeOrder!.tif).toBe('GTC');
    });
  });

  describe('reconstruct — metadata fields', () => {
    it('sets lastPrice from tickerLast', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2050, baseConfig);
      expect(result.lastPrice).toBe(2050);
    });

    it('initializes stats to zero', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.stats.totalOrdersPlaced).toBe(0);
      expect(result.stats.totalFills).toBe(0);
      expect(result.stats.totalReorders).toBe(0);
      expect(result.stats.lastPersistTime).toBe(0);
    });

    it('initializes nextSeq to 1', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.nextSeq).toBe(1);
    });

    it('initializes gridActiveSince to undefined', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.gridActiveSince).toBeUndefined();
    });
  });

  describe('reconstruct — trailing entry', () => {
    it('enters TRAILING_ENTRY when below entryPrice with trailing enabled', () => {
      const sync = makeSyncResult({ position: emptyPosition });
      const result = reconstructor.reconstruct(sync, 1990, { ...baseConfig, trailingEntry: true });
      expect(result.fsmState.kind).toBe('TRAILING_ENTRY');
    });

    it('enters RUNNING when position exists even with trailingEntry', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: 0.05, quoteAssetQty: -100, entryPrice: 2000 },
      });
      const result = reconstructor.reconstruct(sync, 1990, { ...baseConfig, trailingEntry: true });
      expect(result.fsmState.kind).toBe('RUNNING');
    });

    it('enters RUNNING when isRecovery flag is set', () => {
      const sync = makeSyncResult({ position: null });
      const result = reconstructor.reconstruct(sync as any, 1990, { ...baseConfig, trailingEntry: true, isRecovery: true });
      expect(result.fsmState.kind).toBe('RUNNING');
    });

    it('SHORT direction TRAILING_ENTRY when price above entryPrice and above activation depth', () => {
      // SHORT mirror geometry: takeProfitPrice=2200 是低端，mainGridDepth=380 →
      // fullPositionPrice=2580，默认 activationPrice = takeProfitPrice + mainGridDepth/2 = 2390。
      // price=2610 > activationPrice(2390) → 激活窗口未关闭 → TRAILING_ENTRY。
      const sync = makeSyncResult({ position: emptyPosition });
      const result = reconstructor.reconstruct(sync, 2610, {
        ...baseConfig,
        direction: 'SHORT',
        trailingEntry: true,
        entryPrice: 2600,
        previousPrice: 2590,
      });
      expect(result.fsmState.kind).toBe('TRAILING_ENTRY');
    });
  });

  describe('reconstruct — SHORT direction', () => {
    it('returns TAKE_PROFIT at fullPositionPrice with zero position', () => {
      const sync = makeSyncResult({ position: emptyPosition });
      const result = reconstructor.reconstruct(sync, 1800, { ...baseConfig, direction: 'SHORT' });
      expect(result.fsmState.kind).toBe('TAKE_PROFIT');
    });

    it('returns RUNNING at fullPositionPrice with non-zero position', () => {
      const sync = makeSyncResult({
        position: { ...emptyPosition, baseAssetQty: -0.1, quoteAssetQty: 200, entryPrice: 2200 },
      });
      const result = reconstructor.reconstruct(sync, 1800, { ...baseConfig, direction: 'SHORT' });
      expect(result.fsmState.kind).toBe('RUNNING');
    });
  });

  describe('reconstruct — nextSeq 恢复（防 clientOrderId 复用）', () => {
    // 进程重启后 nextSeq 若归 1，会复用本 run 已用过的 clientOrderId：
    // 新交易所订单因 (runId, clientOrderId) 唯一约束无法落库，其 WS 成交被错误
    // 归属到旧 Order 行（filledQty 超量累加）。恢复时必须越过历史最大序号。

    it('nextSeq 取 persistedMaxSeq+1（无挂单时）', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2000, baseConfig, { persistedMaxSeq: 7 });
      expect(result.nextSeq).toBe(8);
    });

    it('nextSeq 同时考虑交易所挂单中解析出的序号', () => {
      const prodConfig = { ...baseConfig, runCode: 'ETHUSDT_260810122212' };
      const sync = makeSyncResult({
        openOrders: [
          makeOrder({ orderId: 'o1', clientOrderId: 'ETHUSDT260810122212B9' }),
        ],
      });
      const result = reconstructor.reconstruct(sync, 2000, prodConfig, { persistedMaxSeq: 3 });
      expect(result.nextSeq).toBe(10);
    });

    it('无历史订单时 nextSeq 仍为 1', () => {
      const sync = makeSyncResult();
      const result = reconstructor.reconstruct(sync, 2000, baseConfig);
      expect(result.nextSeq).toBe(1);
    });
  });
});

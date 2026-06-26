import { describe, it, expect } from 'vitest';
import { ExchangeAccountManager } from '../exchange-account-manager/exchange-account-manager';
import { ExchangeTruthService } from '../exchange-truth-service/exchange-truth.service';
import { TradingMetricsService } from '../metrics/trading-metrics.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type {
  OrderRequest,
  AlgoOrderRequest,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
} from '../types/exchange.types';

describe('TradingEngine Integration', () => {
  it('should flow from account manager -> truth service -> metrics', async () => {
    const mockAdapter: ExchangeAdapter = {
      exchange: 'BINANCE',
      connect: async () => {},
      disconnect: async () => {},
      subscribeTicker: async function* (symbol: string): AsyncGenerator<Ticker> {
        yield { symbol, bid: 1999, ask: 2001, last: 2000, timestamp: Date.now() };
      },
      subscribeOrderUpdates: async function* (): AsyncGenerator<OrderUpdate> {
        yield { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 };
      },
      subscribePosition: async function* (symbol: string): AsyncGenerator<Position> {
        yield { symbol, baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' };
      },
      getTicker: async (symbol: string): Promise<Ticker> => ({
        symbol,
        bid: 1999,
        ask: 2001,
        last: 2000,
        timestamp: Date.now(),
      }),
      createOrder: async (req: OrderRequest) => ({
        orderId: '1',
        clientOrderId: req.clientOrderId,
        status: 'PENDING',
        filledQty: 0,
      }),
      cancelOrder: async () => {},
      getOpenOrders: async () => [],
      createAlgoOrder: async (req: AlgoOrderRequest) => ({
        orderId: '1',
        clientOrderId: req.clientOrderId,
        status: 'PENDING',
        filledQty: 0,
        algoOrderId: 'a1',
      }),
      cancelAlgoOrder: async () => {},
      getAlgoOrders: async () => [],
      getPosition: async (symbol: string): Promise<Position> => ({
        symbol,
        baseAssetQty: 1.2,
        quoteAssetQty: -2400,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      }),
      getBalance: async (): Promise<Balance> => ({
        asset: 'USDT',
        free: 500,
        locked: 0,
      }),
    };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });

    await manager.acquire();
    expect(manager.getRefCount()).toBe(1);

    const truth = new ExchangeTruthService(mockAdapter);
    const metrics = new TradingMetricsService();

    // Initial state: stale
    expect(truth.isStale()).toBe(true);

    // Refresh from exchange
    const syncResult = await truth.invalidateAndRefresh('ETH/USDT');
    expect(truth.isStale()).toBe(false);
    expect(syncResult.position.baseAssetQty).toBe(1.2);

    // Metrics reflect the state
    const deviation = Math.abs(syncResult.position.baseAssetQty - 1.0);
    metrics.recordPositionDeviation('bot1', deviation);
    metrics.recordFsmState('bot1', 'RUNNING');
    metrics.incrementOrderPlaced('bot1');

    const report = metrics.getMetricsReport();
    expect(report.positionDeviation).toBeCloseTo(0.2, 10);
    expect(report.fsmState).toBe('RUNNING');
    expect(report.totalOrdersPlaced).toBe(1);

    // Cleanup
    await manager.release();
    expect(manager.getRefCount()).toBe(0);
  });

  it('should handle rate limiting through account manager', async () => {
    let requestCount = 0;
    const mockAdapter: ExchangeAdapter = {
      exchange: 'GATE',
      connect: async () => {},
      disconnect: async () => {},
      subscribeTicker: async function* () {},
      subscribeOrderUpdates: async function* () {},
      subscribePosition: async function* () {},
      getTicker: async () => ({ symbol: 'ETH/USDT', bid: 1, ask: 2, last: 1.5, timestamp: 0 }),
      createOrder: async () => { requestCount++; return { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 }; },
      cancelOrder: async () => {},
      getOpenOrders: async () => [],
      createAlgoOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0, algoOrderId: 'a1' }),
      cancelAlgoOrder: async () => {},
      getAlgoOrders: async () => [],
      getPosition: async () => ({ symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' }),
      getBalance: async () => ({ asset: 'USDT', free: 1000, locked: 0 }),
    };

    const manager = new ExchangeAccountManager('acc2', mockAdapter, {
      readLimit: { capacity: 2, refillRate: 100 },
      writeLimit: { capacity: 2, refillRate: 100 },
    });

    await manager.acquire();

    // Acquire read tokens for 2 requests
    await manager.acquireRead();
    await manager.acquireRead();

    // Third read should wait
    const start = Date.now();
    await manager.acquireRead();
    expect(Date.now() - start).toBeGreaterThanOrEqual(8); // ~10ms to refill at 100/s

    await manager.release();
  });
});

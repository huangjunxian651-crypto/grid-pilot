import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeTruthService } from './exchange-truth.service';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type {
  OrderRequest,
  AlgoOrderRequest,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
  OrderResult,
  AlgoOrder,
} from '../types/exchange.types';

describe('ExchangeTruthService', () => {
  let mockAdapter: ExchangeAdapter;
  let service: ExchangeTruthService;

  beforeEach(() => {
    mockAdapter = {
      exchange: 'BINANCE',
      connect: async () => {},
      disconnect: async () => {},
      subscribeTicker: async function* () {},
      subscribeOrderUpdates: async function* () {},
      subscribePosition: async function* () {},
      getTicker: async () => ({ symbol: 'ETH/USDT', bid: 1, ask: 2, last: 1.5, timestamp: 0 }),
      createOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 }),
      cancelOrder: async () => {},
      getOpenOrders: async () => [],
      createAlgoOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0, algoOrderId: 'a1' }),
      cancelAlgoOrder: async () => {},
      getAlgoOrders: async () => [],
      getPosition: async () => ({ symbol: 'ETH/USDT', baseAssetQty: 1.5, quoteAssetQty: -3000, entryPrice: 1800, leverage: 10, marginType: 'CROSS' }),
      getBalance: async () => ({ asset: 'USDT', free: 1000, locked: 0 }),
    };
    service = new ExchangeTruthService(mockAdapter);
  });

  it('should return null position before refresh', () => {
    expect(service.getPosition('ETH/USDT')).toBeNull();
  });

  it('should return empty open orders before refresh', () => {
    expect(service.getOpenOrders('ETH/USDT')).toEqual([]);
  });

  it('should return empty algo orders before refresh', () => {
    expect(service.getAlgoOrders('ETH/USDT')).toEqual([]);
  });

  it('should be stale before refresh', () => {
    expect(service.isStale()).toBe(true);
  });

  it('should refresh and cache position', async () => {
    await service.invalidateAndRefresh('ETH/USDT');
    const pos = service.getPosition('ETH/USDT');
    expect(pos).not.toBeNull();
    expect(pos!.baseAssetQty).toBe(1.5);
    expect(pos!.symbol).toBe('ETH/USDT');
  });

  it('should refresh and cache open orders', async () => {
    mockAdapter.getOpenOrders = async () => [
      { orderId: 'o1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 },
      { orderId: 'o2', clientOrderId: 'c2', status: 'FILLED', filledQty: 0.01 },
    ];
    await service.invalidateAndRefresh('ETH/USDT');
    const orders = service.getOpenOrders('ETH/USDT');
    expect(orders).toHaveLength(2);
    expect(orders[0].orderId).toBe('o1');
    expect(orders[1].status).toBe('FILLED');
  });

  it('should refresh and cache algo orders', async () => {
    mockAdapter.getAlgoOrders = async () => [
      { algoOrderId: 'a1', symbol: 'ETH/USDT', side: 'SELL', qty: 0.01, triggerPrice: 1800, status: 'PENDING' },
    ];
    await service.invalidateAndRefresh('ETH/USDT');
    const algos = service.getAlgoOrders('ETH/USDT');
    expect(algos).toHaveLength(1);
    expect(algos[0].algoOrderId).toBe('a1');
  });

  it('should mark stale on explicit call', () => {
    service.markStale('WS_DISCONNECT');
    expect(service.isStale()).toBe(true);
  });

  it('should clear stale flag after refresh', async () => {
    service.markStale('WS_DISCONNECT');
    expect(service.isStale()).toBe(true);
    await service.invalidateAndRefresh('ETH/USDT');
    expect(service.isStale()).toBe(false);
  });

  it('should return SyncResult with timestamp after refresh', async () => {
    const before = Date.now();
    const result = await service.invalidateAndRefresh('ETH/USDT');
    const after = Date.now();

    expect(result.position).toBeDefined();
    expect(result.openOrders).toBeDefined();
    expect(result.algoOrders).toBeDefined();
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it('should update cached data on subsequent refresh', async () => {
    await service.invalidateAndRefresh('ETH/USDT');
    expect(service.getPosition('ETH/USDT')!.baseAssetQty).toBe(1.5);

    mockAdapter.getPosition = async () => ({
      symbol: 'ETH/USDT',
      baseAssetQty: 2.0,
      quoteAssetQty: -4000,
      entryPrice: 1800,
      leverage: 10,
      marginType: 'CROSS',
    });

    await service.invalidateAndRefresh('ETH/USDT');
    expect(service.getPosition('ETH/USDT')!.baseAssetQty).toBe(2.0);
  });

  it('should handle partial failures gracefully', async () => {
    mockAdapter.getPosition = async () => {
      throw new Error('Position API error');
    };
    mockAdapter.getOpenOrders = async () => [
      { orderId: 'o1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 },
    ];
    mockAdapter.getAlgoOrders = async () => [
      { algoOrderId: 'a1', symbol: 'ETH/USDT', side: 'SELL', qty: 0.01, triggerPrice: 1800, status: 'PENDING' },
    ];

    await expect(service.invalidateAndRefresh('ETH/USDT')).rejects.toThrow('Position API error');
    // Cache should not be updated on failure
    expect(service.isStale()).toBe(true);
    expect(service.getPosition('ETH/USDT')).toBeNull();
    expect(service.getOpenOrders('ETH/USDT')).toEqual([]);
  });

  it('should handle all API failures', async () => {
    mockAdapter.getPosition = async () => { throw new Error('Position failed'); };
    mockAdapter.getOpenOrders = async () => { throw new Error('Orders failed'); };
    mockAdapter.getAlgoOrders = async () => { throw new Error('Algo failed'); };

    await expect(service.invalidateAndRefresh('ETH/USDT')).rejects.toThrow();
    expect(service.isStale()).toBe(true);
  });
});

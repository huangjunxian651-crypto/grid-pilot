import { describe, it, expect, beforeEach } from 'vitest';
import { ExchangeAccountManager } from './exchange-account-manager';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import type {
  OrderRequest,
  AlgoOrderRequest,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
} from '../types/exchange.types';

describe('ExchangeAccountManager', () => {
  let mockAdapter: ExchangeAdapter;

  beforeEach(() => {
    mockAdapter = {
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
        baseAssetQty: 1.5,
        quoteAssetQty: -3000,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      }),
      getBalance: async (): Promise<Balance> => ({
        asset: 'USDT',
        free: 1000,
        locked: 0,
      }),
    };
  });

  it('should start with ref count 0', () => {
    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    expect(manager.getRefCount()).toBe(0);
  });

  it('should increment ref count on acquire', async () => {
    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.acquire();
    expect(manager.getRefCount()).toBe(1);
  });

  it('should connect on first acquire', async () => {
    let connected = false;
    mockAdapter.connect = async () => { connected = true; };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.acquire();
    expect(connected).toBe(true);
  });

  it('should not reconnect on second acquire', async () => {
    let connectCount = 0;
    mockAdapter.connect = async () => { connectCount++; };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.acquire();
    await manager.acquire();
    expect(connectCount).toBe(1);
    expect(manager.getRefCount()).toBe(2);
  });

  it('should disconnect when ref count reaches 0', async () => {
    let disconnected = false;
    mockAdapter.disconnect = async () => { disconnected = true; };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.acquire();
    await manager.release();
    expect(disconnected).toBe(true);
    expect(manager.getRefCount()).toBe(0);
  });

  it('should not disconnect if ref count > 0', async () => {
    let disconnected = false;
    mockAdapter.disconnect = async () => { disconnected = true; };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.acquire();
    await manager.acquire();
    await manager.release();
    expect(disconnected).toBe(false);
    expect(manager.getRefCount()).toBe(1);
  });

  it('should expose the adapter', () => {
    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    expect(manager.getAdapter()).toBe(mockAdapter);
  });

  it('should expose accountId', () => {
    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    expect(manager.accountId).toBe('acc1');
  });

  it('should handle release when ref count is already 0', async () => {
    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });
    await manager.release();
    expect(manager.getRefCount()).toBe(0);
  });

  it('should rollback refCount if connect fails', async () => {
    mockAdapter.connect = async () => { throw new Error('Connection refused'); };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });

    await expect(manager.acquire()).rejects.toThrow('Connection refused');
    expect(manager.getRefCount()).toBe(0);
  });

  it('should remain disconnected after connect failure', async () => {
    mockAdapter.connect = async () => { throw new Error('Network error'); };

    const manager = new ExchangeAccountManager('acc1', mockAdapter, {
      readLimit: { capacity: 10, refillRate: 10 },
      writeLimit: { capacity: 5, refillRate: 5 },
    });

    try {
      await manager.acquire();
    } catch {
      // expected
    }

    // Second acquire should retry connection
    let secondAttempt = false;
    mockAdapter.connect = async () => { secondAttempt = true; };

    await manager.acquire();
    expect(secondAttempt).toBe(true);
    expect(manager.getRefCount()).toBe(1);
  });
});

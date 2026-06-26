import { describe, it, expect } from 'vitest';
import type { ExchangeAdapter } from './exchange-adapter.interface';
import type {
  OrderRequest,
  AlgoOrderRequest,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
} from '../types/exchange.types';

describe('ExchangeAdapter interface contract', () => {
  it('should be implementable by a mock adapter', async () => {
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
      createOrder: async (req: OrderRequest): Promise<{ orderId: string; clientOrderId: string; status: 'PENDING'; filledQty: number }> => ({
        orderId: '1',
        clientOrderId: req.clientOrderId,
        status: 'PENDING',
        filledQty: 0,
      }),
      cancelOrder: async (): Promise<void> => {},
      getOpenOrders: async (): Promise<[]> => [],
      createAlgoOrder: async (req: AlgoOrderRequest): Promise<{ orderId: string; clientOrderId: string; status: 'PENDING'; filledQty: number; algoOrderId: string }> => ({
        orderId: '1',
        clientOrderId: req.clientOrderId,
        status: 'PENDING',
        filledQty: 0,
        algoOrderId: 'a1',
      }),
      cancelAlgoOrder: async (): Promise<void> => {},
      getAlgoOrders: async (): Promise<[]> => [],
      getPosition: async (symbol: string): Promise<Position> => ({
        symbol,
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 0,
        leverage: 1,
        marginType: 'CROSS',
      }),
      getBalance: async (): Promise<Balance> => ({
        asset: 'USDT',
        free: 1000,
        locked: 0,
      }),
    };

    expect(mockAdapter.exchange).toBe('BINANCE');
    await expect(mockAdapter.connect()).resolves.toBeUndefined();
    await expect(mockAdapter.disconnect()).resolves.toBeUndefined();
  });

  it('should support AbortSignal for cancellation', async () => {
    let signalReceived: AbortSignal | undefined;

    const mockAdapter: ExchangeAdapter = {
      exchange: 'GATE',
      connect: async () => {},
      disconnect: async () => {},
      subscribeTicker: async function* () {},
      subscribeOrderUpdates: async function* () {},
      subscribePosition: async function* () {},
      getTicker: async () => ({ symbol: 'ETH/USDT', bid: 1, ask: 2, last: 1.5, timestamp: 0 }),
      createOrder: async (_req, signal) => {
        signalReceived = signal;
        return { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 };
      },
      cancelOrder: async () => {},
      getOpenOrders: async () => [],
      createAlgoOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0, algoOrderId: 'a1' }),
      cancelAlgoOrder: async () => {},
      getAlgoOrders: async () => [],
      getPosition: async () => ({ symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' }),
      getBalance: async () => ({ asset: 'USDT', free: 1000, locked: 0 }),
    };

    const controller = new AbortController();
    await mockAdapter.createOrder(
      {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test',
      },
      controller.signal,
    );

    expect(signalReceived).toBe(controller.signal);
  });

  it('should work with all exchange enums', () => {
    const exchanges: Array<{ exchange: 'BINANCE' | 'GATE' | 'OKX' }> = [
      { exchange: 'BINANCE' },
      { exchange: 'GATE' },
      { exchange: 'OKX' },
    ];
    expect(exchanges.map(e => e.exchange)).toContain('BINANCE');
    expect(exchanges.map(e => e.exchange)).toContain('GATE');
    expect(exchanges.map(e => e.exchange)).toContain('OKX');
  });
});

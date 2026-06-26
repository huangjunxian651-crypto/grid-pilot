import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionEngine } from './execution-engine';
import type { ExchangeAdapter } from '../adapters/exchange-adapter.interface';
import { ExchangeError, ErrorCategory } from '../../exchange/interfaces/exchange-adapter.interface';
import type { OrderRequest, OrderResult, Ticker, Position, Balance, OrderUpdate } from '../types/exchange.types';

describe('ExecutionEngine', () => {
  let mockAdapter: ExchangeAdapter;
  let engine: ExecutionEngine;

  beforeEach(() => {
    mockAdapter = {
      exchange: 'BINANCE',
      connect: async () => {},
      disconnect: async () => {},
      subscribeTicker: async function* () {},
      subscribeOrderUpdates: async function* () {},
      subscribePosition: async function* () {},
      getTicker: async () => ({ symbol: 'ETH/USDT', bid: 1999, ask: 2001, last: 2000, timestamp: Date.now() }),
      createOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 }),
      cancelOrder: async () => {},
      getOpenOrders: async () => [],
      createAlgoOrder: async () => ({ orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0, algoOrderId: 'a1' }),
      cancelAlgoOrder: async () => {},
      getAlgoOrders: async () => [],
      getPosition: async () => ({ symbol: 'ETH/USDT', baseAssetQty: 0, quoteAssetQty: 0, entryPrice: 0, leverage: 1, marginType: 'CROSS' }),
      getBalance: async () => ({ asset: 'USDT', free: 1000, locked: 0 }),
    };
    engine = new ExecutionEngine(mockAdapter);
  });

  describe('POC execution', () => {
    it('should place POC order successfully', async () => {
      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(result.orderId).toBe('1');
    });

    it('should downgrade to GTC when POC is rejected', async () => {
      let callCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC') {
          throw new Error('POST_ONLY_REJECT');
        }
        return { orderId: '2', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(callCount).toBe(2); // POC failed, then GTC succeeded
    });

    it('should use request.price directly for GTC (N1: pricing layer already clamped)', async () => {
      let gtcPrice = 0;
      mockAdapter.createOrder = async (req) => {
        if (req.tif === 'GTC') {
          gtcPrice = req.price;
        }
        if (req.tif === 'POC') {
          throw new Error('POST_ONLY_REJECT');
        }
        return { orderId: '2', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2500, // pricing layer already clamped this
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(gtcPrice).toBe(2500); // N1: no double-clamp, use pricing layer's price
    });

    it('should use request.price for direct GTC orders (N1)', async () => {
      let capturedPrice = 0;
      mockAdapter.createOrder = async (req) => {
        capturedPrice = req.price;
        return { orderId: '1', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2500, // pricing layer already clamped
        tif: 'GTC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(capturedPrice).toBe(2500); // N1: direct pass-through
    });

    it('should use Math.max for SELL GTC price floor', async () => {
      let capturedPrice = 0;
      mockAdapter.createOrder = async (req) => {
        capturedPrice = req.price;
        return { orderId: '1', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'SELL',
        qty: 0.01,
        price: 2100, // Higher than currentPrice * 0.98 = 1960
        tif: 'GTC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(capturedPrice).toBe(2100); // max(2100, 2000 * 0.98) = 2100
    });
  });

  describe('retry logic', () => {
    it('should retry network errors up to 3 times', async () => {
      let attempts = 0;
      mockAdapter.createOrder = async () => {
        attempts++;
        if (attempts < 3) {
          const error = new Error('ECONNRESET');
          (error as any).code = 'ECONNRESET';
          throw error;
        }
        return { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(attempts).toBe(3);
    });

    it('should fail after 3 network retries', async () => {
      let attempts = 0;
      mockAdapter.createOrder = async () => {
        attempts++;
        const error = new Error('ECONNRESET');
        (error as any).code = 'ECONNRESET';
        throw error;
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('REJECTED');
      // 1 initial attempt + 3 attempts in retryWithBackoff (network errors retry on attempt 0 and 1)
      expect(attempts).toBe(4);
    });

    it('should not retry business errors', async () => {
      let attempts = 0;
      mockAdapter.createOrder = async () => {
        attempts++;
        throw new Error('insufficient balance');
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('REJECTED');
      // 1 initial attempt + 1 attempt in retryWithBackoff before business error throws
      expect(attempts).toBe(2);
    });

    it('should use exponential backoff for rate limit errors', async () => {
      let attempts = 0;
      const startTime = Date.now();
      mockAdapter.createOrder = async () => {
        attempts++;
        if (attempts < 4) {
          const error = new Error('Too Many Requests');
          (error as any).code = 'RATE_LIMIT';
          throw error;
        }
        return { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      const result = await engine.execute(request, { currentPrice: 2000 });
      expect(result.outcome).toBe('PLACED');
      expect(attempts).toBe(4);
      // First attempt fails immediately, then retryWithBackoff: 1s + 2s delays
      expect(Date.now() - startTime).toBeGreaterThanOrEqual(2500);
    }, 10000);
  });

  describe('AbortSignal', () => {
    it('should support abort signal', async () => {
      const controller = new AbortController();
      let signalReceived: AbortSignal | undefined;

      mockAdapter.createOrder = async (req, signal) => {
        signalReceived = signal;
        return { orderId: '1', clientOrderId: 'c1', status: 'PENDING', filledQty: 0 };
      };

      const request: OrderRequest = {
        symbol: 'ETH/USDT',
        side: 'BUY',
        qty: 0.01,
        price: 2000,
        tif: 'POC',
        clientOrderId: 'test_1',
      };

      await engine.execute(request, { currentPrice: 2000, signal: controller.signal });
      expect(signalReceived).toBe(controller.signal);
    });
  });

  describe('POC retry loop', () => {
    const defaultRetryOptions = {
      currentPrice: 2000,
      getTicker: async () => ({ bid: 1998, ask: 2002 }),
      gridPrice: 2010,
      gtcThreshold: 0.002,
      pocRetryIntervalMs: 10,
    };

    it('should retry POC with fresh ticker after POST_ONLY_REJECT and succeed', async () => {
      let callCount = 0;
      let tickerCallCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC' && callCount === 1) {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const getTicker = async () => {
        tickerCallCount++;
        return { bid: 1998, ask: 2002 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker },
      );

      expect(result.outcome).toBe('PLACED');
      expect(callCount).toBe(2);
      expect(tickerCallCount).toBe(1);
    });

    it('should retry POC multiple times until success', async () => {
      let callCount = 0;
      let tickerCall = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC' && callCount <= 3) {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // margin = (2010 - ask) / 2010. With ask=2009.99, margin≈0.00005 < gtcThreshold=0.01
      // so the loop continues retrying POC instead of degrading to GTC
      const getTicker = async () => {
        tickerCall++;
        return { bid: 2009, ask: 2009.99 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, gtcThreshold: 0.01 },
      );

      expect(result.outcome).toBe('PLACED');
      expect(callCount).toBe(4);
    });

    it('should degrade to GTC when price is within POC zone and margin > gtcThreshold', async () => {
      let callCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // gridPrice = 2010, ask = 2009
      // margin = (2010 - 2009) / 2010 = 0.000498
      // gtcThreshold = 0.0004 → margin > threshold → degrade to GTC
      const getTicker = async () => ({ bid: 2008, ask: 2009 });

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, gtcThreshold: 0.0004 },
      );

      expect(result.outcome).toBe('PLACED');
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should return REJECTED when price crossed gridPrice', async () => {
      mockAdapter.createOrder = async (req) => {
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: '1', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // BUY: bid1 = 2012 >= gridPrice = 2010 → price crossed gridPrice
      const getTicker = async () => ({ bid: 2012, ask: 2013 });

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker },
      );

      expect(result.outcome).toBe('REJECTED');
    });

    it('should return REJECTED when price eventually crosses gridPrice after repeated POC rejection', async () => {
      let tickerCall = 0;
      mockAdapter.createOrder = async (req) => {
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: '1', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // First ticker: ask=2009.99, margin≈0.000005 < gtcThreshold=0.01, loop continues
      // Second ticker: bid=2012 >= gridPrice=2010, exits with REJECTED
      const getTicker = async () => {
        tickerCall++;
        if (tickerCall === 1) return { bid: 2009, ask: 2009.99 };
        return { bid: 2012, ask: 2013 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, gtcThreshold: 0.01 },
      );

      expect(result.outcome).toBe('REJECTED');
    });

    it('should exit retry loop on AbortSignal', async () => {
      const controller = new AbortController();
      mockAdapter.createOrder = async (req) => {
        throw new ExchangeError(
          'Binance API error [-5022]: Post Only rejected',
          '-5022',
          'BINANCE',
          false,
          ErrorCategory.POST_ONLY_REJECT,
        );
      };

      const getTicker = async () => {
        controller.abort();
        return { bid: 1998, ask: 2002 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, signal: controller.signal },
      );

      expect(result.outcome).toBe('REJECTED');
    });

    it('should fall back to GTC when getTicker is not provided', async () => {
      let callCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { currentPrice: 2000 },
      );

      expect(result.outcome).toBe('PLACED');
      expect(callCount).toBe(2);
    });

    it('should handle SELL side with GTC degradation', async () => {
      let capturedGtcPrice = 0;
      let callCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        capturedGtcPrice = req.price;
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // SELL: gridPrice = 1990, bid = 1991
      // margin = (1991 - 1990) / 1990 ≈ 0.0005
      // gtcThreshold = 0.0004 → degrade to GTC at bid price 1991
      const getTicker = async () => ({ bid: 1991, ask: 1993 });

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'SELL', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, gridPrice: 1990, gtcThreshold: 0.0004 },
      );

      expect(result.outcome).toBe('PLACED');
      expect(capturedGtcPrice).toBe(1991);
    });

    it('non-POST_ONLY_REJECT errors should follow existing retryWithBackoff', async () => {
      let callCount = 0;
      mockAdapter.createOrder = async () => {
        callCount++;
        throw new Error('insufficient balance');
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        defaultRetryOptions,
      );

      expect(result.outcome).toBe('REJECTED');
    });

    it('should return REJECTED when margin <= 0', async () => {
      mockAdapter.createOrder = async (req) => {
        if (req.tif === 'POC') {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: '1', clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      // BUY: ask = 2010.01, gridPrice = 2010
      // margin = (2010 - 2010.01) / 2010 < 0 → REJECTED
      const getTicker = async () => ({ bid: 2009, ask: 2010.01 });

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, getTicker, gridPrice: 2010 },
      );

      expect(result.outcome).toBe('REJECTED');
      expect(result.error).toContain('Margin');
    });

    it('should log retry attempts when log callback is provided', async () => {
      const logs: string[] = [];
      let callCount = 0;
      mockAdapter.createOrder = async (req) => {
        callCount++;
        if (req.tif === 'POC' && callCount <= 1) {
          throw new ExchangeError(
            'Binance API error [-5022]: Post Only rejected',
            '-5022',
            'BINANCE',
            false,
            ErrorCategory.POST_ONLY_REJECT,
          );
        }
        return { orderId: String(callCount), clientOrderId: req.clientOrderId, status: 'PENDING', filledQty: 0 };
      };

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1' },
        { ...defaultRetryOptions, log: (msg) => logs.push(msg) },
      );

      expect(result.outcome).toBe('PLACED');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0]).toContain('POC retry');
    });
  });

  describe('errorCode passthrough', () => {
    it('GTC 拒单时透传 ExchangeError.code 到 errorCode', async () => {
      const adapter = {
        createOrder: vi.fn().mockRejectedValue(
          new ExchangeError('account restricted', 'ACCOUNT_MODE_RESTRICTED', 'okx', false),
        ),
      } as any;
      const engine = new ExecutionEngine(adapter);

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC' } as any,
        { currentPrice: 2000 },
      );

      expect(result.outcome).toBe('REJECTED');
      expect(result.errorCode).toBe('ACCOUNT_MODE_RESTRICTED');
    });

    it('非 ExchangeError 拒单时 errorCode 为 undefined', async () => {
      const adapter = {
        createOrder: vi.fn().mockRejectedValue(new Error('boom')),
      } as any;
      const engine = new ExecutionEngine(adapter);

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC' } as any,
        { currentPrice: 2000 },
      );

      expect(result.outcome).toBe('REJECTED');
      expect(result.errorCode).toBeUndefined();
    });

    it('Issue 1: GTC 路径 adapter 抛出字符串时不应 TypeError，error 字段应为该字符串', async () => {
      const adapter = {
        createOrder: vi.fn().mockRejectedValue('plain string failure'),
      } as any;
      const engine = new ExecutionEngine(adapter);

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC' } as any,
        { currentPrice: 2000 },
      );

      expect(result.outcome).toBe('REJECTED');
      expect(result.error).toBe('plain string failure');
      expect(result.errorCode).toBeUndefined();
    });

    it('Issue 2: POC 遇到非 POST_ONLY 的 ExchangeError 时透传 errorCode', async () => {
      // POC 请求，adapter 始终 reject 一个非 retryable 的 ExchangeError
      const restrictedError = new ExchangeError(
        'account restricted',
        'ACCOUNT_MODE_RESTRICTED',
        'okx',
        false,
      );
      const adapter = {
        createOrder: vi.fn().mockRejectedValue(restrictedError),
      } as any;
      const engine = new ExecutionEngine(adapter);

      const result = await engine.execute(
        { symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC' } as any,
        { currentPrice: 2000 },
      );

      expect(result.outcome).toBe('REJECTED');
      expect(result.errorCode).toBe('ACCOUNT_MODE_RESTRICTED');
    });
  });
});

import { describe, it, expect } from 'vitest';
import type {
  OrderSide,
  OrderType,
  OrderStatus,
  OrderTIF,
  ExchangeEnum,
  OrderRequest,
  AlgoOrderRequest,
  OrderResult,
  AlgoOrderResult,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
  FillEvent,
  AlgoOrder,
} from './exchange.types';

describe('exchange types', () => {
  it('OrderSide should allow BUY and SELL', () => {
    const buy: OrderSide = 'BUY';
    const sell: OrderSide = 'SELL';
    expect(buy).toBe('BUY');
    expect(sell).toBe('SELL');
  });

  it('OrderType should allow LIMIT, MARKET, ALGO', () => {
    const limit: OrderType = 'LIMIT';
    const market: OrderType = 'MARKET';
    const algo: OrderType = 'ALGO';
    expect(limit).toBe('LIMIT');
    expect(market).toBe('MARKET');
    expect(algo).toBe('ALGO');
  });

  it('OrderStatus should cover all states', () => {
    const states: OrderStatus[] = ['PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'REJECTED', 'TRIGGERED'];
    expect(states).toHaveLength(6);
  });

  it('OrderTIF should allow POC, GTC, IOC', () => {
    const tifs: OrderTIF[] = ['POC', 'GTC', 'IOC'];
    expect(tifs).toHaveLength(3);
  });

  it('ExchangeEnum should include BINANCE, GATE, OKX', () => {
    const exchanges: ExchangeEnum[] = ['BINANCE', 'GATE', 'OKX'];
    expect(exchanges).toHaveLength(3);
  });

  it('OrderRequest should require all mandatory fields', () => {
    const req: OrderRequest = {
      symbol: 'ETH/USDT',
      side: 'BUY',
      qty: 0.01,
      price: 2000,
      tif: 'POC',
      clientOrderId: 'bot_123_BUY_1',
    };
    expect(req.symbol).toBe('ETH/USDT');
    expect(req.side).toBe('BUY');
    expect(req.qty).toBe(0.01);
    expect(req.price).toBe(2000);
    expect(req.tif).toBe('POC');
    expect(req.clientOrderId).toBe('bot_123_BUY_1');
  });

  it('OrderRequest should support optional closePosition', () => {
    const req: OrderRequest = {
      symbol: 'ETH/USDT',
      side: 'SELL',
      qty: 0.01,
      price: 2000,
      tif: 'GTC',
      clientOrderId: 'bot_123_SELL_1',
      closePosition: true,
    };
    expect(req.closePosition).toBe(true);
  });

  it('AlgoOrderRequest should extend OrderRequest with triggerPrice', () => {
    const req: AlgoOrderRequest = {
      symbol: 'ETH/USDT',
      side: 'SELL',
      qty: 0.01,
      price: 2000,
      tif: 'GTC',
      clientOrderId: 'bot_123_ALGO_1',
      triggerPrice: 1800,
    };
    expect(req.triggerPrice).toBe(1800);
  });

  it('OrderResult should capture order response', () => {
    const result: OrderResult = {
      orderId: 'o1',
      clientOrderId: 'c1',
      status: 'PENDING',
      filledQty: 0,
      avgFillPrice: undefined,
    };
    expect(result.orderId).toBe('o1');
    expect(result.filledQty).toBe(0);
  });

  it('AlgoOrderResult should include algoOrderId', () => {
    const result: AlgoOrderResult = {
      orderId: 'o1',
      clientOrderId: 'c1',
      status: 'PENDING',
      filledQty: 0,
      algoOrderId: 'a1',
    };
    expect(result.algoOrderId).toBe('a1');
  });

  it('Ticker should have bid less than ask', () => {
    const ticker: Ticker = {
      symbol: 'ETH/USDT',
      bid: 1999,
      ask: 2001,
      last: 2000,
      timestamp: Date.now(),
    };
    expect(ticker.bid).toBeLessThan(ticker.ask);
    expect(ticker.last).toBe(2000);
  });

  it('Position should track base and quote quantities', () => {
    const pos: Position = {
      symbol: 'ETH/USDT',
      baseAssetQty: 1.5,
      quoteAssetQty: -3000,
      entryPrice: 1800,
      leverage: 10,
      marginType: 'CROSS',
    };
    expect(pos.baseAssetQty).toBe(1.5);
    expect(pos.quoteAssetQty).toBe(-3000);
    expect(pos.leverage).toBe(10);
    expect(pos.marginType).toBe('CROSS');
  });

  it('Position should support ISOLATED margin', () => {
    const pos: Position = {
      symbol: 'ETH/USDT',
      baseAssetQty: -0.5,
      quoteAssetQty: 1000,
      entryPrice: 2000,
      leverage: 5,
      marginType: 'ISOLATED',
    };
    expect(pos.marginType).toBe('ISOLATED');
  });

  it('Balance should track free and locked amounts', () => {
    const balance: Balance = {
      asset: 'USDT',
      free: 1000,
      locked: 200,
    };
    expect(balance.free + balance.locked).toBe(1200);
  });

  it('OrderUpdate should capture status change', () => {
    const update: OrderUpdate = {
      orderId: 'o1',
      clientOrderId: 'c1',
      status: 'PARTIALLY_FILLED',
      filledQty: 0.005,
      avgFillPrice: 1999.5,
    };
    expect(update.filledQty).toBe(0.005);
    expect(update.avgFillPrice).toBe(1999.5);
  });

  it('FillEvent should capture individual fill details', () => {
    const fill: FillEvent = {
      orderId: 'o1',
      fillId: 'f1',
      qty: 0.01,
      price: 2000,
      commission: 0.02,
      commissionAsset: 'USDT',
      timestamp: Date.now(),
    };
    expect(fill.qty).toBe(0.01);
    expect(fill.commission).toBe(0.02);
  });

  it('AlgoOrder should have triggerPrice', () => {
    const algo: AlgoOrder = {
      algoOrderId: 'a1',
      symbol: 'ETH/USDT',
      side: 'SELL',
      qty: 0.01,
      triggerPrice: 1800,
      status: 'PENDING',
    };
    expect(algo.triggerPrice).toBe(1800);
  });
});

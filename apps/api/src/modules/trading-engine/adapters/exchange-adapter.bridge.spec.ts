import { describe, it, expect, vi } from 'vitest';
import { ExchangeAdapterBridge } from './exchange-adapter.bridge';
import type { IExchangeAdapter } from '../../exchange/interfaces/exchange-adapter.interface';
import type { OrderUpdate } from '../types/exchange.types';

describe('ExchangeAdapterBridge', () => {
  const createMockAdapter = (): IExchangeAdapter => ({
    exchangeId: 'binance',
    accountId: 'test',
    watchTicker: async function* () {
      yield { symbol: 'ETH/USDT', bestBid: 1999, bestAsk: 2001, lastPrice: 2000, ts: Date.now() };
    },
    watchOrderFills: async function* () {
      yield { orderId: 'o1', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.01, avgPrice: 2000, status: 'filled', ts: Date.now() };
    },
    watchAlgoTriggers: async function* () {},
    watchPositions: async function* () {
      yield { symbol: 'ETH/USDT', side: 'long', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, ts: Date.now() };
    },
    createOrder: vi.fn().mockResolvedValue({
      orderId: 'o1', symbol: 'ETH/USDT', side: 'buy', type: 'limit', qty: 0.01,
      status: 'open', filledQty: 0, ts: Date.now(),
    }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    cancelAllOrders: vi.fn().mockResolvedValue(undefined),
    closePosition: vi.fn().mockResolvedValue({
      orderId: 'o2', symbol: 'ETH/USDT', side: 'sell', type: 'market', qty: 0.5,
      status: 'filled', filledQty: 0.5, avgPrice: 2000, ts: Date.now(),
    }),
    createAlgoOrder: vi.fn().mockResolvedValue({
      algoOrderId: 'a1', clientAlgoId: 'ca1', symbol: 'ETH/USDT', side: 'buy',
      triggerPrice: 1800, triggerCondition: 'price_below', qty: 0.01,
      closePosition: false, status: 'open', ts: Date.now(),
    }),
    cancelAlgoOrder: vi.fn().mockResolvedValue(undefined),
    cancelAllAlgoOrders: vi.fn().mockResolvedValue(undefined),
    fetchAlgoOrders: vi.fn().mockResolvedValue([]),
    isImmediateTriggerError: vi.fn().mockReturnValue(false),
    setPositionMode: vi.fn().mockResolvedValue(undefined),
    getPositionMode: vi.fn().mockResolvedValue(true),
    setLeverage: vi.fn().mockResolvedValue(undefined),
    setMarginMode: vi.fn().mockResolvedValue(undefined),
    getMarginMode: vi.fn().mockResolvedValue(true),
    fetchPosition: vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT', side: 'long', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, ts: Date.now(),
    }),
    fetchBalance: vi.fn().mockResolvedValue({ usdt: 1000, totalEquity: 1000, ts: Date.now() }),
    fetchOpenOrders: vi.fn().mockResolvedValue([]),
    getMarketInfo: vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT', rawSymbol: 'ETHUSDT', minQty: 0.001, minNotional: 10,
      stepSize: 0.001, tickSize: 0.01, contractSize: 1, makerFeeRate: 0.0002, takerFeeRate: 0.0005,
    }),
    syncStateAfterReconnect: vi.fn().mockResolvedValue({
      openOrders: [], openAlgoOrders: [], position: { symbol: 'ETH/USDT', side: 'long', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, ts: Date.now() },
    }),
    destroy: vi.fn(),
  });

  it('reflects the wrapped adapter exchange (not hardcoded BINANCE)', () => {
    // 回归：过去硬编码 'BINANCE'，导致 Gate/OKX 机器人日志全打 [BINANCE]、无法区分。
    expect(new ExchangeAdapterBridge({ ...createMockAdapter(), exchangeId: 'gateio' }).exchange).toBe('GATE');
    expect(new ExchangeAdapterBridge({ ...createMockAdapter(), exchangeId: 'okx' }).exchange).toBe('OKX');
    expect(new ExchangeAdapterBridge({ ...createMockAdapter(), exchangeId: 'binance' }).exchange).toBe('BINANCE');
  });

  it('should map ticker correctly', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    const tickers: { bid: number; ask: number; last: number }[] = [];
    for await (const t of bridge.subscribeTicker('ETH/USDT')) {
      tickers.push(t);
      break;
    }

    expect(tickers).toHaveLength(1);
    expect(tickers[0].last).toBe(2000);
    expect(tickers[0].bid).toBe(1999);
    expect(tickers[0].ask).toBe(2001);
  });

  it('should map position correctly', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    const position = await bridge.getPosition('ETH/USDT');
    expect(position.baseAssetQty).toBe(0.5);
    expect(position.entryPrice).toBe(2000);
    expect(position.leverage).toBe(10);
    expect(position.marginType).toBe('CROSS');
  });

  it('should map isolated marginType from exchange position', async () => {
    const legacy = createMockAdapter();
    (legacy.fetchPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: 'ETH/USDT', side: 'long', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, marginType: 'isolated' as const, ts: Date.now(),
    });
    const bridge = new ExchangeAdapterBridge(legacy);
    const position = await bridge.getPosition('ETH/USDT');
    expect(position.marginType).toBe('ISOLATED');
  });

  it('should default marginType to CROSS when exchange returns undefined', async () => {
    const legacy = createMockAdapter();
    (legacy.fetchPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: 'ETH/USDT', side: 'long', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, ts: Date.now(),
    });
    const bridge = new ExchangeAdapterBridge(legacy);
    const position = await bridge.getPosition('ETH/USDT');
    expect(position.marginType).toBe('CROSS');
  });

  it('should map short position to negative baseAssetQty', async () => {
    const legacy = createMockAdapter();
    (legacy.fetchPosition as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: 'ETH/USDT', side: 'short', qty: 0.5, avgCost: 2000, unrealizedPnl: 0, leverage: 10, ts: Date.now(),
    });
    const bridge = new ExchangeAdapterBridge(legacy);

    const position = await bridge.getPosition('ETH/USDT');
    expect(position.baseAssetQty).toBe(-0.5);
  });

  it('should map createOrder params', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.createOrder({
      symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC', clientOrderId: 'c1',
    });

    expect(legacy.createOrder).toHaveBeenCalledWith({
      symbol: 'ETH/USDT',
      side: 'buy',
      type: 'post_only',
      qty: 0.01,
      price: 2000,
      clientOrderId: 'c1',
      reduceOnly: undefined,
    });
  });

  it('should map balance correctly', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    const balance = await bridge.getBalance();
    expect(balance.asset).toBe('USDT');
    expect(balance.free).toBe(1000);
  });

  it('should delegate disconnect to destroy', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.disconnect();
    expect(legacy.destroy).toHaveBeenCalledOnce();
  });

  it('should delegate cancelAllOrders to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.cancelAllOrders('ETH/USDT');
    expect(legacy.cancelAllOrders).toHaveBeenCalledWith('ETH/USDT');
  });

  it('should delegate closePosition to legacy adapter with lowercased side', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    const result = await bridge.closePosition('ETH/USDT', 'LONG');
    expect(legacy.closePosition).toHaveBeenCalledWith('ETH/USDT', 'long');
    expect(result.orderId).toBe('o2');
    expect(result.status).toBe('FILLED');
  });

  it('getTicker prefers REST adapter.getTicker over WS first frame', async () => {
    const legacy = createMockAdapter();
    // REST getTicker returns a distinct snapshot; WS would return last=2000.
    legacy.getTicker = vi.fn().mockResolvedValue({
      symbol: 'ETH/USDT', bestBid: 2456.5, bestAsk: 2456.9, lastPrice: 2456.7, ts: 1597026383085,
    });
    // Make WS throw so we prove the REST path was used (cold-start, WS 502).
    const wsSpy = vi.fn(async function* () {
      throw new Error('WS unavailable (502)');
    });
    legacy.watchTicker = wsSpy as unknown as IExchangeAdapter['watchTicker'];

    const bridge = new ExchangeAdapterBridge(legacy);
    const ticker = await bridge.getTicker('ETH/USDT');

    expect(legacy.getTicker).toHaveBeenCalledWith('ETH/USDT');
    expect(wsSpy).not.toHaveBeenCalled();
    expect(ticker.last).toBe(2456.7);
    expect(ticker.bid).toBe(2456.5);
    expect(ticker.ask).toBe(2456.9);
  });

  it('getTicker falls back to WS first frame when REST getTicker fails', async () => {
    const legacy = createMockAdapter();
    legacy.getTicker = vi.fn().mockRejectedValue(new Error('REST ticker 500'));
    // watchTicker (from createMockAdapter) yields last=2000.

    const bridge = new ExchangeAdapterBridge(legacy);
    const ticker = await bridge.getTicker('ETH/USDT');

    expect(legacy.getTicker).toHaveBeenCalledWith('ETH/USDT');
    expect(ticker.last).toBe(2000);
  });

  it('getTicker uses WS first frame when adapter has no getTicker', async () => {
    const legacy = createMockAdapter();
    expect(legacy.getTicker).toBeUndefined();

    const bridge = new ExchangeAdapterBridge(legacy);
    const ticker = await bridge.getTicker('ETH/USDT');
    expect(ticker.last).toBe(2000);
  });

  it('should abort getTicker when signal is triggered', async () => {
    const legacy = createMockAdapter();
    legacy.watchTicker = async function* () {
      await new Promise((r) => setTimeout(r, 100));
      yield { symbol: 'ETH/USDT', bestBid: 1999, bestAsk: 2001, lastPrice: 2000, ts: Date.now() };
    };
    const bridge = new ExchangeAdapterBridge(legacy);
    const controller = new AbortController();

    const promise = bridge.getTicker('ETH/USDT', controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow('aborted');
  });

  // #17 regression: getAlgoOrders must expose clientAlgoId as clientOrderId so the
  // runner's prefix-filtered exit cleanup can identify bot-owned algo orders.
  // Without this, cancelOwnOrders never matches and stop-loss algos leak on the exchange.
  it('maps clientAlgoId to clientOrderId in getAlgoOrders', async () => {
    const legacy = createMockAdapter();
    legacy.fetchAlgoOrders = vi.fn().mockResolvedValue([
      { algoOrderId: 'a1', clientAlgoId: 'session-1_SELL_0', symbol: 'ETH/USDT', side: 'sell',
        triggerPrice: 2210, triggerCondition: 'price_below', qty: 0.05, closePosition: true, status: 'open', ts: Date.now() },
    ]);
    const bridge = new ExchangeAdapterBridge(legacy);

    const algos = await bridge.getAlgoOrders('ETH/USDT');
    expect(algos).toHaveLength(1);
    expect(algos[0].clientOrderId).toBe('session-1_SELL_0');
  });

  // Regression: getAlgoOrders must pass closePosition through so getStatus/UI can
  // render close-position (全平) algos correctly instead of a misleading "×0.0000".
  // Dropping this field silently defeats the close-order side/qty fix downstream.
  it('maps closePosition through in getAlgoOrders', async () => {
    const legacy = createMockAdapter();
    legacy.fetchAlgoOrders = vi.fn().mockResolvedValue([
      { algoOrderId: 'a1', clientAlgoId: 'ca1', symbol: 'ETH/USDT', side: 'sell',
        triggerPrice: 1430, triggerCondition: 'price_below', qty: 0, closePosition: true, status: 'open', ts: Date.now() },
      { algoOrderId: 'a2', clientAlgoId: 'ca2', symbol: 'ETH/USDT', side: 'buy',
        triggerPrice: 1900, triggerCondition: 'price_above', qty: 0.05, closePosition: false, status: 'open', ts: Date.now() },
    ]);
    const bridge = new ExchangeAdapterBridge(legacy);

    const algos = await bridge.getAlgoOrders('ETH/USDT');
    expect(algos[0].closePosition).toBe(true);
    expect(algos[1].closePosition).toBe(false);
  });

  // ── TODO-1.4 (T2/T3): status mapping ──

  it('mapStatus returns TRIGGERED for triggered status', async () => {
    const legacy = createMockAdapter();
    legacy.fetchAlgoOrders = vi.fn().mockResolvedValue([
      { algoOrderId: 'a1', clientAlgoId: 'ca1', symbol: 'ETH/USDT', side: 'sell',
        triggerPrice: 2210, triggerCondition: 'price_below', qty: 0.05, closePosition: true, status: 'triggered', ts: Date.now() },
    ]);
    const bridge = new ExchangeAdapterBridge(legacy);
    const algos = await bridge.getAlgoOrders('ETH/USDT');
    expect(algos[0].status).toBe('TRIGGERED');
  });

  it('subscribeOrderUpdates uses mapStatus (triggered → TRIGGERED)', async () => {
    const legacy = createMockAdapter();
    legacy.watchOrderFills = async function* () {
      yield { orderId: 'o1', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.01, avgPrice: 2000, status: 'triggered', ts: Date.now() };
    };
    const bridge = new ExchangeAdapterBridge(legacy);

    const updates: OrderUpdate[] = [];
    for await (const u of bridge.subscribeOrderUpdates()) {
      updates.push(u);
      break;
    }
    expect(updates[0].status).toBe('TRIGGERED');
  });

  // ── TODO-1.3 (T1): triggerCondition ──

  it('should delegate setLeverage to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);
    await bridge.setLeverage('ETH/USDT', 20);
    expect(legacy.setLeverage).toHaveBeenCalledWith('ETH/USDT', 20);
  });

  it('should delegate setMarginMode to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);
    await bridge.setMarginMode('ETH/USDT', true);
    expect(legacy.setMarginMode).toHaveBeenCalledWith('ETH/USDT', true);
  });

  // 每次 runner 启动都会经桥接调用这两个方法，缺一个就是启动即 TypeError
  it('should delegate getPositionMode to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);
    await expect(bridge.getPositionMode()).resolves.toBe(true);
    expect(legacy.getPositionMode).toHaveBeenCalled();
  });

  it('should delegate setPositionMode to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);
    await bridge.setPositionMode(true);
    expect(legacy.setPositionMode).toHaveBeenCalledWith(true);
  });

  it('createAlgoOrder uses explicit triggerCondition when provided', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.createAlgoOrder({
      symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC',
      clientOrderId: 'c1', triggerPrice: 1800, triggerCondition: 'price_above',
    });

    expect(legacy.createAlgoOrder).toHaveBeenCalledWith(
      expect.objectContaining({ triggerCondition: 'price_above' }),
    );
  });

  it('createAlgoOrder fallback: BUY→price_above, SELL→price_below', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.createAlgoOrder({
      symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC',
      clientOrderId: 'c1', triggerPrice: 1800,
    });
    expect(legacy.createAlgoOrder).toHaveBeenCalledWith(
      expect.objectContaining({ triggerCondition: 'price_above' }),
    );

    await bridge.createAlgoOrder({
      symbol: 'ETH/USDT', side: 'SELL', qty: 0.01, price: 2000, tif: 'POC',
      clientOrderId: 'c2', triggerPrice: 2200,
    });
    expect(legacy.createAlgoOrder).toHaveBeenCalledWith(
      expect.objectContaining({ triggerCondition: 'price_below' }),
    );
  });

  // ── TODO-2.11 (T7): this.symbol race condition ──

  it('cancelOrder uses symbol parameter, not this.symbol', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    // Create order for ETH/USDT to set this.symbol
    await bridge.createOrder({
      symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'GTC', clientOrderId: 'c1',
    });

    // cancelOrder should pass the explicit symbol, not depend on this.symbol
    await bridge.cancelOrder('order-1', 'BTC/USDT' as any);
    expect(legacy.cancelOrder).toHaveBeenCalledWith('order-1', 'BTC/USDT');
  });

  it('cancelAlgoOrder uses symbol parameter, not this.symbol', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.createAlgoOrder({
      symbol: 'ETH/USDT', side: 'BUY', qty: 0.01, price: 2000, tif: 'POC',
      clientOrderId: 'c1', triggerPrice: 1800, triggerCondition: 'price_above',
    });

    await bridge.cancelAlgoOrder('algo-1', 'BTC/USDT' as any);
    expect(legacy.cancelAlgoOrder).toHaveBeenCalledWith('algo-1', 'BTC/USDT');
  });

  // ── TODO-2.12 (T11): reduceOnly ──

  it('createAlgoOrder passes reduceOnly to legacy adapter', async () => {
    const legacy = createMockAdapter();
    const bridge = new ExchangeAdapterBridge(legacy);

    await bridge.createAlgoOrder({
      symbol: 'ETH/USDT', side: 'SELL', qty: 0.01, price: 2000, tif: 'POC',
      clientOrderId: 'c1', triggerPrice: 1800, triggerCondition: 'price_below',
      reduceOnly: true,
    });

    expect(legacy.createAlgoOrder).toHaveBeenCalledWith(
      expect.objectContaining({ reduceOnly: true }),
    );
  });
});

describe('ExchangeAdapterBridge.getMyTrades', () => {
  it('映射底层 fetchMyTrades(OrderFill[]) 为 FillEvent[]，带 commission/clientOrderId/side', async () => {
    const { ExchangeAdapterBridge } = await import('./exchange-adapter.bridge');
    const bridge = new ExchangeAdapterBridge({
      async fetchMyTrades() {
        return [{ orderId: 'o1', clientOrderId: 'c1', tradeId: 't1', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.5, avgPrice: 2000, fee: 0.4, feeAsset: 'USDT', status: 'filled', ts: 5 }];
      },
      destroy() {},
    } as any);
    const out = await bridge.getMyTrades('ETH/USDT', 0);
    expect(out[0]).toMatchObject({ orderId: 'o1', fillId: 't1', qty: 0.5, price: 2000, commission: 0.4, commissionAsset: 'USDT', clientOrderId: 'c1', side: 'BUY', timestamp: 5 });
  });

  it('底层无 fetchMyTrades 时返回空数组', async () => {
    const { ExchangeAdapterBridge } = await import('./exchange-adapter.bridge');
    const bridge = new ExchangeAdapterBridge({ destroy() {} } as any);
    expect(await bridge.getMyTrades('ETH/USDT', 0)).toEqual([]);
  });
});

describe('ExchangeAdapterBridge.subscribeFills', () => {
  function fakeLegacy(fills: any[]) {
    return {
      async *watchOrderFills() { for (const f of fills) yield f; },
      destroy() {},
    } as any;
  }

  it('把 OrderFill 映射成 FillEvent 并带 clientOrderId/tradeId/side', async () => {
    const bridge = new ExchangeAdapterBridge(fakeLegacy([
      { orderId: 'o1', clientOrderId: 'c1', tradeId: 't1', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.5, avgPrice: 100, status: 'partial', ts: 123 },
    ]));
    const out: any[] = [];
    for await (const e of bridge.subscribeFills()) out.push(e);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ orderId: 'o1', fillId: 't1', qty: 0.5, price: 100, timestamp: 123, clientOrderId: 'c1', side: 'BUY' });
  });

  it('tradeId 缺失时 fillId 为空串（由摄入层合成键兜底）', async () => {
    const bridge = new ExchangeAdapterBridge(fakeLegacy([
      { orderId: 'o2', clientOrderId: 'c2', symbol: 'ETH/USDT', side: 'sell', filledQty: 1, avgPrice: 200, status: 'filled', ts: 9 },
    ]));
    const out: any[] = [];
    for await (const e of bridge.subscribeFills()) out.push(e);
    expect(out[0]).toMatchObject({ fillId: '', side: 'SELL' });
  });

  it('携带 fee/feeAsset 进 FillEvent 的 commission/commissionAsset', async () => {
    const bridge = new ExchangeAdapterBridge(fakeLegacy([
      { orderId: 'o1', clientOrderId: 'c1', tradeId: 't1', symbol: 'ETH/USDT', side: 'buy', filledQty: 0.5, avgPrice: 100, fee: 0.02, feeAsset: 'USDT', status: 'partial', ts: 1 },
    ]));
    const out: any[] = [];
    for await (const e of bridge.subscribeFills()) out.push(e);
    expect(out[0]).toMatchObject({ commission: 0.02, commissionAsset: 'USDT' });
  });
});

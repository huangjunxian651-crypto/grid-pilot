import type { IExchangeAdapter, MarketInfo } from '../../exchange/interfaces/exchange-adapter.interface';
import type { ExchangeAdapter } from './exchange-adapter.interface';
import type {
  OrderRequest,
  OrderResult,
  AlgoOrderRequest,
  AlgoOrderResult,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
  FillEvent,
  AlgoOrder,
  ExchangeEnum,
} from '../types/exchange.types';

/** 被包装适配器的 exchangeId（小写） → 引擎层展示用 ExchangeEnum（大写）。
 * 注意 gateio→GATE 的非对称命名。未知值回退 BINANCE 仅为类型兜底，正常不会命中。 */
const EXCHANGE_ID_TO_ENUM: Record<string, ExchangeEnum> = {
  binance: 'BINANCE',
  gateio: 'GATE',
  okx: 'OKX',
};

/**
 * Bridges the legacy IExchangeAdapter to the greenfield ExchangeAdapter interface.
 * This is a temporary compatibility layer until all adapters are migrated.
 */
export class ExchangeAdapterBridge implements ExchangeAdapter {
  readonly exchange: ExchangeEnum;

  constructor(private readonly adapter: IExchangeAdapter) {
    // 真实交易所标签来自被包装适配器，过去硬编码 'BINANCE' 导致三所机器人日志全打
    // [BINANCE]，无法区分，误导诊断（Gate/OKX 看似"不交易"）。
    this.exchange = EXCHANGE_ID_TO_ENUM[this.adapter.exchangeId] ?? 'BINANCE';
  }

  async connect(): Promise<void> {
    // Legacy adapters auto-connect; no-op
  }

  async disconnect(): Promise<void> {
    this.adapter.destroy();
  }

  async *subscribeTicker(symbol: string): AsyncIterable<Ticker> {
    for await (const t of this.adapter.watchTicker(symbol)) {
      yield {
        symbol: t.symbol,
        bid: t.bestBid,
        ask: t.bestAsk,
        last: t.lastPrice,
        timestamp: t.ts,
      };
    }
  }

  async *subscribeOrderUpdates(): AsyncIterable<OrderUpdate> {
    // Legacy adapter uses watchOrderFills which yields fills, not order updates
    // We yield minimal updates for compatibility
    for await (const fill of this.adapter.watchOrderFills('')) {
      yield {
        orderId: fill.orderId,
        clientOrderId: fill.clientOrderId ?? '',
        status: this.mapStatus(fill.status ?? 'open'),
        filledQty: fill.filledQty,
        avgFillPrice: fill.avgPrice,
      };
    }
  }

  async *subscribeFills(): AsyncIterable<FillEvent & { clientOrderId?: string; side?: 'BUY' | 'SELL' }> {
    for await (const fill of this.adapter.watchOrderFills('')) {
      yield {
        orderId: fill.orderId,
        fillId: fill.tradeId ?? '',
        qty: fill.filledQty,
        price: fill.avgPrice,
        timestamp: fill.ts,
        clientOrderId: fill.clientOrderId,
        side: fill.side.toUpperCase() as 'BUY' | 'SELL',
        commission: fill.fee,
        commissionAsset: fill.feeAsset,
      };
    }
  }

  async *subscribePosition(symbol: string): AsyncIterable<Position> {
    for await (const pos of this.adapter.watchPositions(symbol)) {
      yield this.mapPosition(pos);
    }
  }

  async getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker> {
    // Prefer the adapter's REST ticker snapshot (cold-start safe: works even
    // when the WebSocket feed is down, e.g. Gate testnet WS 502). Fall through
    // to the WS first-frame path below if REST is unavailable or fails.
    if (this.adapter.getTicker) {
      try {
        const t = await this.adapter.getTicker(symbol);
        return {
          symbol: t.symbol,
          bid: t.bestBid,
          ask: t.bestAsk,
          last: t.lastPrice,
          timestamp: t.ts,
        };
      } catch {
        // REST unavailable/failed — fall back to the WS first-frame path.
      }
    }

    // Fallback: pull one tick from the WebSocket stream and close it.
    const gen = this.adapter.watchTicker(symbol);
    try {
      const abortPromise = signal
        ? new Promise<never>((_, reject) => {
            const onAbort = () => reject(new Error('Ticker fetch aborted'));
            signal.addEventListener('abort', onAbort, { once: true });
          })
        : new Promise<never>(() => {});

      const result = await Promise.race([gen.next(), abortPromise]);
      if (result.done || !result.value) {
        throw new Error('No ticker data available from legacy adapter');
      }
      const t = result.value;
      return {
        symbol: t.symbol,
        bid: t.bestBid,
        ask: t.bestAsk,
        last: t.lastPrice,
        timestamp: t.ts,
      };
    } finally {
      // Close the async generator so the underlying WS connection is released
      await gen.return?.(undefined);
    }
  }

  async getMarketInfo(symbol: string): Promise<MarketInfo> {
    return this.adapter.getMarketInfo(symbol);
  }

  async createOrder(req: OrderRequest, signal?: AbortSignal): Promise<OrderResult> {
    const order = await this.adapter.createOrder({
      symbol: req.symbol,
      side: req.side.toLowerCase() as 'buy' | 'sell',
      type: req.tif === 'POC' ? 'post_only' : 'limit',
      qty: req.qty,
      price: req.price,
      clientOrderId: req.clientOrderId,
      reduceOnly: req.closePosition,
    });
    return this.mapOrder(order);
  }

  async cancelOrder(orderId: string, symbol?: string, signal?: AbortSignal): Promise<void> {
    await this.adapter.cancelOrder(orderId, symbol ?? '');
  }

  async cancelAllOrders(symbol?: string): Promise<void> {
    await this.adapter.cancelAllOrders(symbol ?? '');
  }

  async closePosition(symbol: string, side: 'LONG' | 'SHORT', _qty?: number): Promise<OrderResult> {
    const order = await this.adapter.closePosition(symbol, side.toLowerCase() as 'long' | 'short');
    return this.mapOrder(order);
  }

  async getOpenOrders(symbol?: string): Promise<OrderResult[]> {
    const orders = await this.adapter.fetchOpenOrders(symbol ?? '');
    return orders.map((o) => this.mapOrder(o));
  }

  async createAlgoOrder(req: AlgoOrderRequest, signal?: AbortSignal): Promise<AlgoOrderResult> {
    // T1: triggerCondition must be passed explicitly by caller (sentinel/runner).
    // Fallback side-based inference: BUY→price_above, SELL→price_below (stop-loss buffer geometry).
    const triggerCondition = req.triggerCondition ?? (req.side === 'BUY' ? 'price_above' : 'price_below');
    const algo = await this.adapter.createAlgoOrder({
      symbol: req.symbol,
      side: req.side.toLowerCase() as 'buy' | 'sell',
      triggerPrice: req.triggerPrice,
      triggerCondition,
      qty: req.qty,
      closePosition: req.closePosition,
      reduceOnly: req.reduceOnly,
      clientAlgoId: req.clientOrderId,
    });
    return {
      orderId: algo.algoOrderId,
      clientOrderId: algo.clientAlgoId ?? '',
      status: this.mapStatus(algo.status),
      filledQty: 0,
      algoOrderId: algo.algoOrderId,
    };
  }

  async cancelAlgoOrder(algoOrderId: string, symbol?: string, signal?: AbortSignal): Promise<void> {
    await this.adapter.cancelAlgoOrder(algoOrderId, symbol ?? '');
  }

  async cancelAllAlgoOrders(symbol: string): Promise<void> {
    await this.adapter.cancelAllAlgoOrders(symbol);
  }

  async getAlgoOrders(symbol?: string): Promise<AlgoOrder[]> {
    const algos = await this.adapter.fetchAlgoOrders(symbol ?? '');
    return algos.map((a) => ({
      algoOrderId: a.algoOrderId,
      // Map clientAlgoId → clientOrderId so the runner can identify bot-owned algo
      // orders by sessionCode prefix during exit cleanup (#17). Without this the
      // prefix filter never matches and bot stop-loss algos leak on the exchange.
      clientOrderId: a.clientAlgoId ?? '',
      symbol: a.symbol,
      side: a.side.toUpperCase() as 'BUY' | 'SELL',
      qty: a.qty,
      triggerPrice: a.triggerPrice,
      // Carry closePosition through so getStatus/UI can render close-position (全平)
      // algos correctly instead of a misleading "BUY ×0.0000" (Gate close orders have size=0).
      closePosition: a.closePosition,
      status: this.mapStatus(a.status),
      derivedOrderId: a.derivedOrderId, // F6-link
    }));
  }

  async getPosition(symbol: string): Promise<Position> {
    const pos = await this.adapter.fetchPosition(symbol);
    return this.mapPosition(pos);
  }

  async getBalance(): Promise<Balance> {
    const bal = await this.adapter.fetchBalance();
    return {
      asset: 'USDT',
      free: bal.usdt,
      locked: 0,
      totalWalletBalance: bal.totalEquity,
      totalUnrealizedProfit: 0,
    };
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.adapter.setLeverage(symbol, leverage);
  }

  async setMarginMode(symbol: string, crossMargin: boolean): Promise<void> {
    await this.adapter.setMarginMode(symbol, crossMargin);
  }

  async getMyTrades(symbol: string, sinceMs: number): Promise<Array<FillEvent & { clientOrderId?: string; side?: 'BUY' | 'SELL' }>> {
    if (!this.adapter.fetchMyTrades) return [];
    const trades = await this.adapter.fetchMyTrades(symbol, sinceMs);
    return trades.map((f) => ({
      orderId: f.orderId,
      fillId: f.tradeId ?? '',
      qty: f.filledQty,
      price: f.avgPrice,
      commission: f.fee,
      commissionAsset: f.feeAsset,
      timestamp: f.ts,
      clientOrderId: f.clientOrderId,
      side: f.side.toUpperCase() as 'BUY' | 'SELL',
    }));
  }

  private mapOrder(order: {
    orderId: string;
    clientOrderId?: string;
    status: string;
    filledQty: number;
    avgPrice?: number;
    qty?: number;
    price?: number;
  }): OrderResult {
    return {
      orderId: order.orderId,
      clientOrderId: order.clientOrderId ?? '',
      status: this.mapStatus(order.status),
      filledQty: order.filledQty,
      avgFillPrice: order.avgPrice,
      // F7: pass through original qty / resting limit price so recovery is accurate.
      qty: order.qty,
      price: order.price,
    };
  }

  private mapPosition(pos: {
    symbol: string;
    side: string;
    qty: number;
    avgCost: number;
    unrealizedPnl: number;
    leverage: number;
    marginType?: "cross" | "isolated";
  }): Position {
    return {
      symbol: pos.symbol,
      baseAssetQty: pos.side === 'short' ? -pos.qty : pos.qty,
      quoteAssetQty: -(pos.avgCost * pos.qty),
      entryPrice: pos.avgCost,
      leverage: pos.leverage,
      marginType: pos.marginType === 'isolated' ? 'ISOLATED' : 'CROSS',
      unrealizedPnl: Number.isFinite(pos.unrealizedPnl) ? pos.unrealizedPnl : 0,
    };
  }

  private mapStatus(status: string): OrderResult['status'] {
    switch (status) {
      case 'open':
        return 'PENDING';
      case 'filled':
        return 'FILLED';
      case 'partial':
        return 'PARTIALLY_FILLED';
      case 'cancelled':
        return 'CANCELLED';
      case 'triggered':
        return 'TRIGGERED';
      default:
        return 'PENDING';
    }
  }
}

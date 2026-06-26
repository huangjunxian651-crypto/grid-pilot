import type { ExchangeAdapter } from '../../adapters/exchange-adapter.interface';
import type {
  OrderRequest,
  OrderResult,
  AlgoOrderRequest,
  AlgoOrderResult,
  Ticker,
  Position,
  Balance,
  OrderUpdate,
  AlgoOrder,
  AlgoTriggerEvent,
  ExchangeEnum,
} from '../../types/exchange.types';

interface ResolverPair<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

export class MockExchangeAdapter implements ExchangeAdapter {
  readonly exchange: ExchangeEnum = 'BINANCE';

  // Tracking arrays
  placedOrders: OrderRequest[] = [];
  cancelledOrders: string[] = [];
  placedAlgos: AlgoOrderRequest[] = [];
  cancelledAlgos: string[] = [];
  closedPositions: Array<{ symbol: string; side: 'LONG' | 'SHORT'; qty?: number }> = [];

  // Internal state
  private _position: Position = {
    symbol: 'ETH_USDT',
    baseAssetQty: 0,
    quoteAssetQty: 0,
    entryPrice: 0,
    leverage: 20,
    marginType: 'ISOLATED',
  };
  private _openOrders: OrderResult[] = [];
  private _algoOrders: AlgoOrder[] = [];
  private _tickerQueue: Ticker[] = [];
  private _positionQueue: Position[] = [];
  private _orderUpdateQueue: OrderUpdate[] = [];
  private _algoTriggerQueue: AlgoTriggerEvent[] = [];
  private _tickerResolvers: Array<ResolverPair<Ticker>> = [];
  private _positionResolvers: Array<ResolverPair<Position>> = [];
  private _orderUpdateResolvers: Array<ResolverPair<OrderUpdate>> = [];
  private _algoTriggerResolvers: Array<ResolverPair<AlgoTriggerEvent>> = [];
  private _connected = false;
  private _disconnected = false;
  private _seq = 0;
  /** 模拟市价平仓未全成交：每次 closePosition 后保留这么多（绝对值）残留持仓。 */
  private _closeResidualQty = 0;
  /** 残留持续多少次 closePosition 后清零（默认永不清零，用于覆盖"重试成功"路径）。 */
  private _closeResidualClearAfter = Number.POSITIVE_INFINITY;
  private _closeCallCount = 0;
  /** 模拟持仓查询接口抖动：getPosition 抛错（用于覆盖清算中刷新失败路径）。 */
  private _positionFetchError = false;

  // ── Helpers ──────────────────────────────────────────────────────

  pushTick(price: number): void {
    const ticker: Ticker = {
      symbol: 'ETH_USDT',
      bid: price,
      ask: price,
      last: price,
      timestamp: Date.now(),
    };
    this._tickerQueue.push(ticker);
    this._drainTickerQueue();
  }

  pushFill(orderId: string, qty: number, price?: number): void {
    const update: OrderUpdate = {
      orderId,
      clientOrderId: '',
      status: 'FILLED',
      filledQty: qty,
      avgFillPrice: price ?? this._tickerQueue[this._tickerQueue.length - 1]?.last ?? 2500,
    };
    this._orderUpdateQueue.push(update);
    this._drainOrderUpdateQueue();
  }

  /**
   * Simulate an algo order being triggered and filled on the exchange.
   * Locates the placed algo for the given sub-grid (by clientOrderId suffix),
   * removes it from the open algo set, and emits an AlgoTriggerEvent through the
   * subscribeAlgoTriggers channel so the runner can ping-pong flip.
   */
  pushAlgoTrigger(subGridIndex: number): void {
    // Match clientOrderId ending with _${subGridIndex}_ followed by random suffix
    const req = this.placedAlgos.find(
      (a) => a.clientOrderId.match(new RegExp(`_${subGridIndex}_[a-z0-9]{4}$`)),
    );
    if (!req) {
      throw new Error(`pushAlgoTrigger: no placed algo for subGridIndex=${subGridIndex}`);
    }
    // The triggered algo is consumed (exchange executed it as a market fill).
    this._algoOrders = this._algoOrders.filter((a) => a.triggerPrice !== req.triggerPrice);

    const event: AlgoTriggerEvent = {
      algoOrderId: `mock-algo-trigger-${++this._seq}`,
      subGridIndex,
      side: req.side,
      triggerPrice: req.triggerPrice,
      qty: req.qty,
    };
    this._algoTriggerQueue.push(event);
    this._drainAlgoTriggerQueue();
  }

  pushPosition(baseQty: number, entryPrice: number): void {
    const pos: Position = {
      ...this._position,
      baseAssetQty: baseQty,
      entryPrice,
    };
    this._position = pos;
    this._positionQueue.push(pos);
    this._drainPositionQueue();
  }

  setOpenOrders(orders: OrderResult[]): void {
    this._openOrders = orders;
  }

  /** Seed a single open order on the exchange (e.g. a user's manual order). */
  seedOpenOrder(order: OrderResult): void {
    this._openOrders.push(order);
  }

  setAlgoOrders(algos: AlgoOrder[]): void {
    this._algoOrders = algos;
  }

  /** Seed a single algo/conditional order on the exchange (e.g. a user's manual one). */
  seedAlgoOrder(algo: AlgoOrder): void {
    this._algoOrders.push(algo);
  }

  resetTracking(): void {
    this.placedOrders = [];
    this.cancelledOrders = [];
    this.placedAlgos = [];
    this.cancelledAlgos = [];
    this.closedPositions = [];
  }

  // ── ExchangeAdapter implementation ───────────────────────────────

  async connect(): Promise<void> {
    this._connected = true;
    this._disconnected = false;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._disconnected = true;
    // Reject all pending generator promises so they exit cleanly
    const tickerPairs = this._tickerResolvers;
    this._tickerResolvers = [];
    tickerPairs.forEach(p => p.reject(new Error('Adapter disconnected')));

    const posPairs = this._positionResolvers;
    this._positionResolvers = [];
    posPairs.forEach(p => p.reject(new Error('Adapter disconnected')));

    const orderPairs = this._orderUpdateResolvers;
    this._orderUpdateResolvers = [];
    orderPairs.forEach(p => p.reject(new Error('Adapter disconnected')));

    const algoPairs = this._algoTriggerResolvers;
    this._algoTriggerResolvers = [];
    algoPairs.forEach(p => p.reject(new Error('Adapter disconnected')));
  }

  private _drainTickerQueue(): void {
    while (this._tickerQueue.length > 0 && this._tickerResolvers.length > 0) {
      const pair = this._tickerResolvers.shift()!;
      pair.resolve(this._tickerQueue.shift()!);
    }
  }

  private _drainPositionQueue(): void {
    while (this._positionQueue.length > 0 && this._positionResolvers.length > 0) {
      const pair = this._positionResolvers.shift()!;
      pair.resolve(this._positionQueue.shift()!);
    }
  }

  private _drainOrderUpdateQueue(): void {
    while (this._orderUpdateQueue.length > 0 && this._orderUpdateResolvers.length > 0) {
      const pair = this._orderUpdateResolvers.shift()!;
      pair.resolve(this._orderUpdateQueue.shift()!);
    }
  }

  private _drainAlgoTriggerQueue(): void {
    while (this._algoTriggerQueue.length > 0 && this._algoTriggerResolvers.length > 0) {
      const pair = this._algoTriggerResolvers.shift()!;
      pair.resolve(this._algoTriggerQueue.shift()!);
    }
  }

  private async _nextTicker(): Promise<Ticker> {
    if (this._tickerQueue.length > 0) return this._tickerQueue.shift()!;
    if (this._disconnected) throw new Error('Adapter disconnected');
    return new Promise<Ticker>((resolve, reject) => {
      const pair: ResolverPair<Ticker> = { resolve, reject };
      this._tickerResolvers.push(pair);
      const interval = setInterval(() => {
        if (this._disconnected) {
          clearInterval(interval);
          const idx = this._tickerResolvers.indexOf(pair);
          if (idx >= 0) this._tickerResolvers.splice(idx, 1);
          reject(new Error('Adapter disconnected'));
          return;
        }
        if (this._tickerQueue.length > 0) {
          clearInterval(interval);
          const idx = this._tickerResolvers.indexOf(pair);
          if (idx >= 0) this._tickerResolvers.splice(idx, 1);
          resolve(this._tickerQueue.shift()!);
        }
      }, 10);
    });
  }

  private async _nextPosition(): Promise<Position> {
    if (this._positionQueue.length > 0) return this._positionQueue.shift()!;
    if (this._disconnected) throw new Error('Adapter disconnected');
    return new Promise<Position>((resolve, reject) => {
      const pair: ResolverPair<Position> = { resolve, reject };
      this._positionResolvers.push(pair);
      const interval = setInterval(() => {
        if (this._disconnected) {
          clearInterval(interval);
          const idx = this._positionResolvers.indexOf(pair);
          if (idx >= 0) this._positionResolvers.splice(idx, 1);
          reject(new Error('Adapter disconnected'));
          return;
        }
        if (this._positionQueue.length > 0) {
          clearInterval(interval);
          const idx = this._positionResolvers.indexOf(pair);
          if (idx >= 0) this._positionResolvers.splice(idx, 1);
          resolve(this._positionQueue.shift()!);
        }
      }, 10);
    });
  }

  private async _nextOrderUpdate(): Promise<OrderUpdate> {
    if (this._orderUpdateQueue.length > 0) return this._orderUpdateQueue.shift()!;
    if (this._disconnected) throw new Error('Adapter disconnected');
    return new Promise<OrderUpdate>((resolve, reject) => {
      const pair: ResolverPair<OrderUpdate> = { resolve, reject };
      this._orderUpdateResolvers.push(pair);
      const interval = setInterval(() => {
        if (this._disconnected) {
          clearInterval(interval);
          const idx = this._orderUpdateResolvers.indexOf(pair);
          if (idx >= 0) this._orderUpdateResolvers.splice(idx, 1);
          reject(new Error('Adapter disconnected'));
          return;
        }
        if (this._orderUpdateQueue.length > 0) {
          clearInterval(interval);
          const idx = this._orderUpdateResolvers.indexOf(pair);
          if (idx >= 0) this._orderUpdateResolvers.splice(idx, 1);
          resolve(this._orderUpdateQueue.shift()!);
        }
      }, 10);
    });
  }

  private async _nextAlgoTrigger(): Promise<AlgoTriggerEvent> {
    if (this._algoTriggerQueue.length > 0) return this._algoTriggerQueue.shift()!;
    if (this._disconnected) throw new Error('Adapter disconnected');
    return new Promise<AlgoTriggerEvent>((resolve, reject) => {
      const pair: ResolverPair<AlgoTriggerEvent> = { resolve, reject };
      this._algoTriggerResolvers.push(pair);
      const interval = setInterval(() => {
        if (this._disconnected) {
          clearInterval(interval);
          const idx = this._algoTriggerResolvers.indexOf(pair);
          if (idx >= 0) this._algoTriggerResolvers.splice(idx, 1);
          reject(new Error('Adapter disconnected'));
          return;
        }
        if (this._algoTriggerQueue.length > 0) {
          clearInterval(interval);
          const idx = this._algoTriggerResolvers.indexOf(pair);
          if (idx >= 0) this._algoTriggerResolvers.splice(idx, 1);
          resolve(this._algoTriggerQueue.shift()!);
        }
      }, 10);
    });
  }

  async *subscribeAlgoTriggers(_symbol: string): AsyncIterable<AlgoTriggerEvent> {
    while (this._connected) {
      try {
        const trigger = await this._nextAlgoTrigger();
        yield trigger;
      } catch {
        break;
      }
    }
  }

  async *subscribeTicker(symbol: string): AsyncIterable<Ticker> {
    while (this._connected) {
      try {
        const tick = await this._nextTicker();
        yield tick;
      } catch {
        break;
      }
    }
  }

  async *subscribeOrderUpdates(): AsyncIterable<OrderUpdate> {
    while (this._connected) {
      try {
        const update = await this._nextOrderUpdate();
        yield update;
      } catch {
        break;
      }
    }
  }

  async *subscribeFills() { /* no fills in this mock */ }

  async *subscribePosition(symbol: string): AsyncIterable<Position> {
    while (this._connected) {
      try {
        const pos = await this._nextPosition();
        yield pos;
      } catch {
        break;
      }
    }
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const last = this._tickerQueue.length > 0
      ? this._tickerQueue[this._tickerQueue.length - 1].last
      : 2500;
    return {
      symbol,
      bid: last * 0.999,
      ask: last * 1.001,
      last,
      timestamp: Date.now(),
    };
  }

  async createOrder(req: OrderRequest, _signal?: AbortSignal): Promise<OrderResult> {
    this.placedOrders.push(req);
    this._seq++;
    const result: OrderResult = {
      orderId: `mock-order-${this._seq}`,
      clientOrderId: req.clientOrderId,
      status: 'PENDING',
      filledQty: 0,
      avgFillPrice: req.price,
    };
    this._openOrders.push(result);
    return result;
  }

  async cancelOrder(orderId: string, _symbol?: string, _signal?: AbortSignal): Promise<void> {
    this.cancelledOrders.push(orderId);
    this._openOrders = this._openOrders.filter((o) => o.orderId !== orderId);
  }

  async cancelAllOrders(_symbol?: string): Promise<void> {
    for (const o of this._openOrders) {
      this.cancelledOrders.push(o.orderId);
    }
    this._openOrders = [];
  }

  /**
   * 模拟市价平仓未能全部成交：之后每次 closePosition 仅平到剩余 residualQty
   * （按原持仓方向保留），用于覆盖"清算后仍有残留"的异常路径。
   * clearAfterCalls 指定第几次 closePosition 起残留清零（默认永不清零），
   * 用于覆盖"重试若干次后终于清干净"的正路。
   */
  setCloseResidual(residualQty: number, clearAfterCalls = Number.POSITIVE_INFINITY): void {
    this._closeResidualQty = residualQty;
    this._closeResidualClearAfter = clearAfterCalls;
  }

  /** 让后续 getPosition 抛错，模拟持仓查询接口抖动。 */
  setPositionFetchError(enabled: boolean): void {
    this._positionFetchError = enabled;
  }

  async closePosition(symbol: string, side: 'LONG' | 'SHORT', qty?: number): Promise<OrderResult> {
    this._closeCallCount += 1;
    const before = Math.abs(this._position.baseAssetQty);
    const residualTarget = this._closeCallCount >= this._closeResidualClearAfter ? 0 : this._closeResidualQty;
    const residual = Math.min(residualTarget, before);
    const closedQty = qty ?? Math.max(0, before - residual);
    this.closedPositions.push({ symbol, side, qty: closedQty });
    this._seq++;
    const sign = this._position.baseAssetQty >= 0 ? 1 : -1;
    this._position = { ...this._position, baseAssetQty: sign * residual };
    return {
      orderId: `mock-close-${this._seq}`,
      clientOrderId: `close_${side}_${this._seq}`,
      status: 'FILLED',
      filledQty: closedQty,
    };
  }

  async getOpenOrders(_symbol?: string): Promise<OrderResult[]> {
    return [...this._openOrders];
  }

  async createAlgoOrder(req: AlgoOrderRequest, _signal?: AbortSignal): Promise<AlgoOrderResult> {
    this.placedAlgos.push(req);
    this._seq++;
    const algoId = `mock-algo-${this._seq}`;
    const result: AlgoOrderResult = {
      orderId: algoId,
      clientOrderId: req.clientOrderId,
      status: 'PENDING',
      filledQty: 0,
      algoOrderId: algoId,
    };
    this._algoOrders.push({
      algoOrderId: algoId,
      clientOrderId: req.clientOrderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      triggerPrice: req.triggerPrice,
      status: 'PENDING',
    });
    return result;
  }

  async cancelAlgoOrder(algoOrderId: string, _symbol?: string, _signal?: AbortSignal): Promise<void> {
    this.cancelledAlgos.push(algoOrderId);
    this._algoOrders = this._algoOrders.filter((a) => a.algoOrderId !== algoOrderId);
  }

  async cancelAllAlgoOrders(_symbol: string): Promise<void> {
    for (const a of this._algoOrders) {
      this.cancelledAlgos.push(a.algoOrderId);
    }
    this._algoOrders = [];
  }

  async getAlgoOrders(_symbol?: string): Promise<AlgoOrder[]> {
    return [...this._algoOrders];
  }

  async getPosition(symbol: string): Promise<Position> {
    if (this._positionFetchError) {
      throw new Error('Mock position fetch error');
    }
    return { ...this._position, symbol };
  }

  async getBalance(): Promise<Balance> {
    return { asset: 'USDT', free: 100000, locked: 0 };
  }

  async setLeverage(_symbol: string, _leverage: number): Promise<void> {}

  async setMarginMode(_symbol: string, _crossMargin: boolean): Promise<void> {}

  async getMyTrades(_symbol: string, _sinceMs: number) { return []; }
}

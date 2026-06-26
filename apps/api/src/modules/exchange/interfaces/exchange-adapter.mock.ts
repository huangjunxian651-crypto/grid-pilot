// MockExchangeAdapter — Phase 0 使用，接口完整实现
// 价格随机游走，createOrder 300ms 后触发成交，支持完整 FSM 测试

import { EventEmitter } from "events";
import {
  IExchangeAdapter,
  Ticker,
  OrderFill,
  AlgoTrigger,
  Position,
  Order,
  AlgoOrder,
  Balance,
  MarketInfo,
  SyncResult,
  CreateOrderParams,
  CreateAlgoOrderParams,
} from "./exchange-adapter.interface";

export class MockExchangeAdapter implements IExchangeAdapter {
  readonly exchangeId: "binance" | "gateio" | "okx";
  readonly accountId: string;

  private running = false;
  private currentPrice = 2400;
  private priceOverridden = false;

  constructor(options?: { exchangeId?: "binance" | "gateio" | "okx"; accountId?: string }) {
    this.exchangeId = options?.exchangeId ?? "gateio";
    this.accountId = options?.accountId ?? "mock-account";
    this.running = true;
  }
  private position: Position = { symbol: "ETH/USDT", side: "none", qty: 0, avgCost: 0, unrealizedPnl: 0, leverage: 20, ts: Date.now() };
  private openOrders = new Map<string, Order>();
  private openAlgoOrders = new Map<string, AlgoOrder>();
  private emitter = new EventEmitter();
  private tickInterval: NodeJS.Timeout | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────
  start(initialPrice = 2400): void {
    this.running = true;
    this.currentPrice = initialPrice;
    this.priceOverridden = false;
  }

  setPrice(price: number): void {
    this.currentPrice = price;
    this.priceOverridden = true;
  }

  stop(): void {
    this.running = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    // Emit dummy events to wake up once() listeners in watch* methods
    this.emitter.emit("fill", { symbol: "", orderId: "", clientOrderId: "", side: "buy", filledQty: 0, avgPrice: 0, status: "filled", ts: 0 } as OrderFill);
    this.emitter.emit("algoTrigger", { algoOrderId: "", clientAlgoId: "", symbol: "", side: "buy", triggerPrice: 0, filledQty: 0, ts: 0 } as AlgoTrigger);
    this.emitter.emit("position", { symbol: "", side: "none", qty: 0, avgCost: 0, unrealizedPnl: 0, leverage: 0, ts: 0 } as Position);
  }

  destroy(): void {
    this.stop();
    this.openOrders.clear();
    this.openAlgoOrders.clear();
    this.emitter.removeAllListeners();
  }

  // ── Ticker ────────────────────────────────────────────────────
  async *watchTicker(symbol: string): AsyncIterableIterator<Ticker> {
    this.running = true;
    while (this.running) {
      if (!this.priceOverridden) {
        this.currentPrice += (Math.random() - 0.5) * 2;
      }
      this.priceOverridden = false;
      const ticker: Ticker = {
        symbol,
        bestBid: this.currentPrice - 0.1,
        bestAsk: this.currentPrice + 0.1,
        lastPrice: this.currentPrice,
        ts: Date.now(),
      };
      this.emitter.emit("ticker", ticker);

      // 检查算法单触发
      for (const [id, algo] of this.openAlgoOrders) {
        const triggered =
          (algo.triggerCondition === "price_below" && this.currentPrice <= algo.triggerPrice) ||
          (algo.triggerCondition === "price_above" && this.currentPrice >= algo.triggerPrice);
        if (triggered) {
          this.openAlgoOrders.delete(id);
          const trigger: AlgoTrigger = {
            algoOrderId: id,
            clientAlgoId: algo.clientAlgoId ?? id,
            symbol: algo.symbol,
            side: algo.side,
            triggerPrice: algo.triggerPrice,
            filledQty: algo.qty,
            ts: Date.now(),
          };
          this.emitter.emit("algoTrigger", trigger);
          this.updatePosition(algo.symbol, algo.side, algo.qty, this.currentPrice);
        }
      }

      yield ticker;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async *watchOrderFills(symbol: string): AsyncIterableIterator<OrderFill> {
    while (this.running) {
      const fill = await new Promise<OrderFill>((r) => this.emitter.once("fill", r));
      if (!this.running) break;
      if (fill.symbol === symbol) yield fill;
    }
  }

  async *watchAlgoTriggers(symbol: string): AsyncIterableIterator<AlgoTrigger> {
    while (this.running) {
      const trigger = await new Promise<AlgoTrigger>((r) => this.emitter.once("algoTrigger", r));
      if (!this.running) break;
      if (trigger.symbol === symbol) yield trigger;
    }
  }

  async *watchPositions(symbol: string): AsyncIterableIterator<Position> {
    while (this.running) {
      const pos = await new Promise<Position>((r) => this.emitter.once("position", r));
      if (!this.running) break;
      if (pos.symbol === symbol) yield pos;
    }
  }

  // ── Orders ────────────────────────────────────────────────────
  async createOrder(params: CreateOrderParams): Promise<Order> {
    const order: Order = {
      orderId: `mock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientOrderId: params.clientOrderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      price: params.price,
      status: "open",
      filledQty: 0,
      ts: Date.now(),
    };
    this.openOrders.set(order.orderId, order);

    // 300ms 后触发成交
    setTimeout(() => {
      if (!this.openOrders.has(order.orderId)) return;
      const filled = { ...order, status: "filled" as const, filledQty: order.qty, avgPrice: this.currentPrice };
      this.openOrders.delete(order.orderId);

      const fill: OrderFill = {
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        side: order.side,
        filledQty: order.qty,
        avgPrice: this.currentPrice,
        status: "filled",
        ts: Date.now(),
      };
      this.emitter.emit("fill", fill);
      this.updatePosition(order.symbol, order.side, order.qty, this.currentPrice);
    }, 300);

    return order;
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<void> {
    this.openOrders.delete(orderId);
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    for (const [id, order] of this.openOrders) {
      if (order.symbol === symbol) this.openOrders.delete(id);
    }
  }

  async closePosition(symbol: string, _side?: "long" | "short"): Promise<Order> {
    return this.createOrder({
      symbol,
      side: this.position.side === "long" ? "sell" : "buy",
      type: "market",
      qty: this.position.qty,
      reduceOnly: true,
    });
  }

  // ── Algo orders ───────────────────────────────────────────────
  async createAlgoOrder(params: CreateAlgoOrderParams): Promise<AlgoOrder> {
    const algo: AlgoOrder = {
      algoOrderId: `algo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientAlgoId: params.clientAlgoId,
      symbol: params.symbol,
      side: params.side,
      triggerPrice: params.triggerPrice,
      triggerCondition: params.triggerCondition,
      qty: params.qty,
      closePosition: params.closePosition ?? false,
      status: "open",
      ts: Date.now(),
    };
    this.openAlgoOrders.set(algo.algoOrderId, algo);
    return algo;
  }

  async cancelAlgoOrder(algoOrderId: string, _symbol: string): Promise<void> {
    this.openAlgoOrders.delete(algoOrderId);
  }

  async cancelAllAlgoOrders(symbol: string): Promise<void> {
    for (const [id, algo] of this.openAlgoOrders) {
      if (algo.symbol === symbol) this.openAlgoOrders.delete(id);
    }
  }

  async fetchAlgoOrders(symbol: string): Promise<AlgoOrder[]> {
    return [...this.openAlgoOrders.values()].filter((a) => a.symbol === symbol);
  }

  isImmediateTriggerError(): boolean {
    return false;
  }

  // ── Account ───────────────────────────────────────────────────
  async setPositionMode(): Promise<void> {}
  async getPositionMode(): Promise<boolean> { return true; }
  async setLeverage(): Promise<void> {}
  async setMarginMode(): Promise<void> {}
  async getMarginMode(): Promise<boolean> { return true; }

  async fetchPosition(): Promise<Position> {
    return this.position;
  }

  async fetchBalance(): Promise<Balance> {
    return { usdt: 10000, totalEquity: 18450, ts: Date.now() };
  }

  async getAccountUid(): Promise<string> {
    return `mock-uid-${this.exchangeId}`;
  }

  async fetchOpenOrders(symbol: string): Promise<Order[]> {
    return [...this.openOrders.values()].filter((o) => o.symbol === symbol);
  }

  async getMarketInfo(symbol: string): Promise<MarketInfo> {
    return {
      symbol,
      rawSymbol: "ETH_USDT",
      minQty: 0.001,
      minNotional: 5,
      stepSize: 0.001,
      tickSize: 0.1,
      contractSize: 0.001,
      makerFeeRate: 0.0002,
      takerFeeRate: 0.0005,
    };
  }

  async syncStateAfterReconnect(symbol: string): Promise<SyncResult> {
    return {
      openOrders: await this.fetchOpenOrders(symbol),
      openAlgoOrders: await this.fetchAlgoOrders(symbol),
      position: await this.fetchPosition(),
    };
  }

  // ── Private ───────────────────────────────────────────────────
  private updatePosition(symbol: string, side: "buy" | "sell", qty: number, price: number) {
    if (side === "buy") {
      const newQty = this.position.qty + qty;
      this.position = {
        ...this.position,
        symbol,
        side: "long",
        avgCost: (this.position.qty * this.position.avgCost + qty * price) / newQty,
        qty: newQty,
        ts: Date.now(),
      };
    } else {
      this.position = {
        ...this.position,
        qty: Math.max(0, this.position.qty - qty),
        side: this.position.qty - qty <= 0 ? "none" : "long",
        ts: Date.now(),
      };
    }
    this.emitter.emit("position", this.position);
  }
}

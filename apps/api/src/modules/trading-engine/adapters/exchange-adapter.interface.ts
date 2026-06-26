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
  AlgoTriggerEvent,
  ExchangeEnum,
} from '../types/exchange.types';
import type { FundingFeeRecord, MarketInfo } from '../../exchange/interfaces/exchange-adapter.interface';

export interface ExchangeAdapter {
  readonly exchange: ExchangeEnum;

  // WebSocket
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribeTicker(symbol: string): AsyncIterable<Ticker>;
  subscribeOrderUpdates(): AsyncIterable<OrderUpdate>;
  // Per-trade fill stream carrying exchange trade id + (later) fee. Used by FillIngestionService
  // for authoritative, idempotent fill persistence. side/clientOrderId help resolve the owning Order.
  subscribeFills(): AsyncIterable<FillEvent & { clientOrderId?: string; side?: 'BUY' | 'SELL' }>;
  subscribePosition(symbol: string): AsyncIterable<Position>;
  // Optional: stream of algo-order trigger events (stop/rebound algo filled on
  // the exchange). When present, the runner pumps these into ALGO_TRIGGER events
  // to drive the stop-loss buffer ping-pong flip. Adapters that don't surface a
  // dedicated channel may omit this.
  subscribeAlgoTriggers?(symbol: string): AsyncIterable<AlgoTriggerEvent>;

  // REST - Market data
  getTicker(symbol: string): Promise<Ticker>;
  /** 可选：拉取该 symbol 的交易规则（最小名义价值/最小数量/数量步进/最小变动价位等）。
   * 策略层据此做下单前的可下单性预校验（minNotional），避免下出会被交易所拒的小单。
   * 适配器未实现或拉取失败时，runner 降级为不做名义预校验（沿用旧行为）。 */
  getMarketInfo?(symbol: string): Promise<MarketInfo>;

  // REST - Trading
  createOrder(req: OrderRequest, signal?: AbortSignal): Promise<OrderResult>;
  cancelOrder(orderId: string, symbol?: string, signal?: AbortSignal): Promise<void>;
  cancelAllOrders(symbol?: string): Promise<void>;
  closePosition(symbol: string, side: 'LONG' | 'SHORT', qty?: number): Promise<OrderResult>;
  getOpenOrders(symbol?: string): Promise<OrderResult[]>;

  // REST - Algo orders
  createAlgoOrder(req: AlgoOrderRequest, signal?: AbortSignal): Promise<AlgoOrderResult>;
  cancelAlgoOrder(algoOrderId: string, symbol?: string, signal?: AbortSignal): Promise<void>;
  cancelAllAlgoOrders(symbol: string): Promise<void>;
  getAlgoOrders(symbol?: string): Promise<AlgoOrder[]>;

  // REST - Account
  getPosition(symbol: string): Promise<Position>;
  getBalance(): Promise<Balance>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginMode(symbol: string, crossMargin: boolean): Promise<void>;

  // REST - Reconciliation
  getMyTrades(symbol: string, sinceMs: number): Promise<Array<FillEvent & { clientOrderId?: string; side?: 'BUY' | 'SELL' }>>;

  /** 可选：拉取该 symbol 在 [sinceMs, untilMs] 内的资金费流水（具体适配器实现）。 */
  fetchFundingHistory?(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]>;
}

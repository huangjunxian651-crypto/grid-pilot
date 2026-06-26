// IExchangeAdapter — 三所验证接口定稿
// 参见架构文档第二节获取完整约定说明
//
// 重要约定：
// 1. clientOrderId/clientAlgoId 由策略层用 ClientOrderIdCodec 生成，适配器做格式转换
// 2. closePosition=true 时 qty 仍须传入实际仓位数量（OKX reduceOnly 需要）
// 3. 启动顺序：setPositionMode → setLeverage → setMarginMode
// 4. Gate.io algoId→clientAlgoId 映射：适配器内存 Map，重启后 REST 懒恢复

import { ExchangeId } from "@gridpilot/shared-types";

export enum ErrorCategory {
  POST_ONLY_REJECT = 'POST_ONLY_REJECT',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  RATE_LIMIT = 'RATE_LIMIT',
  NETWORK = 'NETWORK',
  BUSINESS = 'BUSINESS',
  UNKNOWN = 'UNKNOWN',
}

/** Structured error for exchange adapter operations */
export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exchangeId: ExchangeId,
    public readonly isRetryable: boolean = false,
    public readonly category?: ErrorCategory,
  ) {
    super(message);
    this.name = "ExchangeError";
  }
}

export interface IExchangeAdapter {
  readonly exchangeId: ExchangeId;
  readonly accountId: string;

  // ── 行情（WebSocket 异步流）────────────────────────────────────
  watchTicker(symbol: string): AsyncIterableIterator<Ticker>;

  // ── 行情（REST 快照，冷启动兜底；WS 不可用时仍可取价）──────────
  // 可选方法：未实现的适配器由 bridge 回退到 watchTicker 首帧。
  // 公开行情端点，无需签名。
  getTicker?(symbol: string): Promise<Ticker>;
  watchOrderFills(symbol: string): AsyncIterableIterator<OrderFill>;
  watchAlgoTriggers(symbol: string): AsyncIterableIterator<AlgoTrigger>;
  watchPositions(symbol: string): AsyncIterableIterator<Position>;

  // ── 普通订单 ──────────────────────────────────────────────────
  createOrder(params: CreateOrderParams): Promise<Order>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  cancelAllOrders(symbol: string): Promise<void>;

  // ── 平仓 ──────────────────────────────────────────────────────
  closePosition(symbol: string, side: "long" | "short"): Promise<Order>;

  // ── 算法单 ────────────────────────────────────────────────────
  createAlgoOrder(params: CreateAlgoOrderParams): Promise<AlgoOrder>;
  /**
   * 撤销算法单。幂等契约：目标单已不在（已成交/已撤/不存在，如 OKX 51400、
   * Binance -2011、Gate AUTO_ORDER_NOT_FOUND）时静默成功——调用方不能依赖
   * 异常感知"单已不在"；新适配器必须遵守同一契约。
   */
  cancelAlgoOrder(algoOrderId: string, symbol: string): Promise<void>;
  cancelAllAlgoOrders(symbol: string): Promise<void>;
  fetchAlgoOrders(symbol: string): Promise<AlgoOrder[]>;

  // ── 错误分类 ──────────────────────────────────────────────────
  isImmediateTriggerError(err: Error): boolean;

  // ── 账户初始化（顺序：1→2→3）─────────────────────────────────
  setPositionMode(oneWay: boolean): Promise<void>;
  getPositionMode(): Promise<boolean>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
  setMarginMode(symbol: string, crossMargin: boolean): Promise<void>;
  getMarginMode(symbol: string): Promise<boolean>;

  // ── REST 查询 ─────────────────────────────────────────────────
  fetchPosition(symbol: string): Promise<Position>;
  fetchBalance(): Promise<Balance>;
  fetchOpenOrders(symbol: string): Promise<Order[]>;
  /** 拉取自 sinceMs 起的逐笔成交（REST 对账用）。未实现的所可省略，bridge 返回空数组。 */
  fetchMyTrades?(symbol: string, sinceMs: number): Promise<OrderFill[]>;
  /** 拉取 [sinceMs, untilMs] 内该 symbol 的资金费流水（可选；未实现的所返回 []）。 */
  fetchFundingHistory?(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]>;
  getMarketInfo(symbol: string): Promise<MarketInfo>;

  // ── 账户标识 ──────────────────────────────────────────────────
  /** 返回交易所真实账户 UID（用于 GridRobot 唯一性）。不支持的交易所抛 ExchangeError。 */
  getAccountUid(): Promise<string>;

  // ── 重连同步 ──────────────────────────────────────────────────
  syncStateAfterReconnect(symbol: string): Promise<SyncResult>;

  // ── 生命周期 ────────────────────────────────────────────────────
  /** Release resources (connections, timers, caches). Safe to call multiple times. */
  destroy(): void;
}

// ── Unified data types ────────────────────────────────────────

export interface Ticker {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  lastPrice: number;
  ts: number;
}

export interface OrderFill {
  orderId: string;
  clientOrderId?: string;
  // 交易所逐笔成交 id（Binance ORDER_TRADE_UPDATE 的 t）
  tradeId?: string;
  fee?: number;        // 本笔手续费，已归一为"已付为正"（rebate 为负）
  feeAsset?: string;   // 手续费计价资产，如 'USDT' / 'ETH' / 'BNB'
  symbol: string;
  side: "buy" | "sell";
  filledQty: number;
  avgPrice: number;
  status: "filled" | "partial" | "cancelled";
  ts: number;
}

export interface FundingFeeRecord {
  symbol: string;       // 规范格式 'ETH/USDT'
  fundingTime: number;  // 毫秒
  amount: number;       // 计价币(USDT)，付出为负、收取为正
}

export interface AlgoTrigger {
  algoOrderId: string;
  clientAlgoId: string;
  symbol: string;
  side: "buy" | "sell";
  triggerPrice: number;
  filledQty: number;
  ts: number;
}

export interface SyncResult {
  openOrders: Order[];
  openAlgoOrders: AlgoOrder[];
  position: Position;
}

export interface CreateOrderParams {
  symbol: string;
  side: "buy" | "sell";
  type: "limit" | "market" | "post_only";
  qty: number;
  price?: number;
  reduceOnly?: boolean;
  clientOrderId?: string;
}

export interface CreateAlgoOrderParams {
  symbol: string;
  side: "buy" | "sell";
  triggerPrice: number;
  triggerCondition: "price_below" | "price_above";
  qty: number;
  closePosition?: boolean;
  reduceOnly?: boolean;
  clientAlgoId: string;
}

export interface Order {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  qty: number;
  price?: number;
  status: "open" | "filled" | "partial" | "cancelled";
  filledQty: number;
  avgPrice?: number;
  ts: number;
}

export interface AlgoOrder {
  algoOrderId: string;
  clientAlgoId?: string;
  symbol: string;
  side: "buy" | "sell";
  triggerPrice: number;
  triggerCondition: "price_below" | "price_above";
  qty: number;
  closePosition: boolean;
  status: "open" | "triggered" | "cancelled";
  ts: number;
  // F6-link: the real order id produced when this algo triggers, when the exchange reports
  // it (Binance actualOrderId, Gate me_order_id, OKX derived order's id). Lets the bot own
  // the derived order even when its primary client id carries no session prefix.
  derivedOrderId?: string;
}

export interface Position {
  symbol: string;
  side: "long" | "short" | "none";
  qty: number;
  avgCost: number;
  unrealizedPnl: number;
  leverage: number;
  marginType?: "cross" | "isolated";
  ts: number;
}

export interface Balance {
  usdt: number;
  totalEquity: number;
  marginRatio?: number;
  ts: number;
}

export interface MarketInfo {
  symbol: string;
  rawSymbol: string;
  minQty: number;
  minNotional: number;
  stepSize: number;
  tickSize: number;
  contractSize: number;
  makerFeeRate: number;
  takerFeeRate: number;
}

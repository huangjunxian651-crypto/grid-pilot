export type ExchangeEnum = 'BINANCE' | 'GATE' | 'OKX';

export type OrderSide = 'BUY' | 'SELL';

export type OrderType = 'LIMIT' | 'MARKET' | 'ALGO';

export type OrderStatus = 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'TRIGGERED';

export type OrderTIF = 'POC' | 'GTC' | 'IOC';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  tif: OrderTIF;
  clientOrderId: string;
  closePosition?: boolean;
}

export interface AlgoOrderRequest extends OrderRequest {
  triggerPrice: number;
  triggerCondition?: 'price_below' | 'price_above';
  reduceOnly?: boolean;
}

export interface OrderResult {
  orderId: string;
  clientOrderId: string;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice?: number;
  // Original order quantity and resting limit price, when the exchange reports them.
  // Needed so crash recovery can rebuild an accurate ActiveOrder (F7) instead of a
  // qty=0/price=0 placeholder that the first tick would immediately reorder away.
  qty?: number;
  price?: number;
}

export interface AlgoOrderResult extends OrderResult {
  algoOrderId: string;
}

export interface Ticker {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: number;
}

export interface Position {
  symbol: string;
  baseAssetQty: number;
  quoteAssetQty: number;
  entryPrice: number;
  leverage: number;
  unrealizedPnl?: number;
  marginType: 'CROSS' | 'ISOLATED';
}

export interface Balance {
  asset: string;
  free: number;
  locked: number;
  totalWalletBalance?: number;
  totalUnrealizedProfit?: number;
}

export interface OrderUpdate {
  orderId: string;
  clientOrderId: string;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice?: number;
}

export interface FillEvent {
  orderId: string;
  fillId: string;
  qty: number;
  price: number;
  commission?: number;
  commissionAsset?: string;
  timestamp: number;
}

export interface AlgoOrder {
  algoOrderId: string;
  // Client-assigned id (maps from the underlying adapter's clientAlgoId). Needed
  // so the runner can identify bot-owned algo orders by sessionCode prefix and
  // avoid cancelling user-placed conditional orders during exit cleanup.
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  triggerPrice: number;
  status: OrderStatus;
  closePosition?: boolean;
  // F6-link: the real order produced when this algo triggers. Exchanges expose a linking
  // field (Binance actualOrderId, OKC derived order's algoClOrdId, Gate me_order_id) whose
  // derived order's primary clientOrderId may NOT carry our prefix. When present, the runner
  // folds it into its ownership ledger so cleanup can cancel it without relying on a FILL.
  derivedOrderId?: string;
}

// Emitted when an algo order is triggered & filled on the exchange. Carries
// enough information to identify the sub-grid so the runner can place the
// reverse (ping-pong flip) algo order at the same sub-grid index.
export interface AlgoTriggerEvent {
  algoOrderId: string;
  subGridIndex: number;
  side: OrderSide;
  triggerPrice: number;
  qty: number;
}

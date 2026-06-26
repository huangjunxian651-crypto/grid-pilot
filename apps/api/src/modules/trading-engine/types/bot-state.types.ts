import type { OrderRequest, OrderResult, Position } from './exchange.types';
import type { SyncResult } from '../exchange-truth-service/exchange-truth.service';

// FSM States
export interface TrailingEntryState {
  kind: 'TRAILING_ENTRY';
  entryPrice: number;
  extremePrice: number; // Long=lowest since entry, Short=highest since entry
  trailingCallbackRate: number;
}

export interface RunningState {
  kind: 'RUNNING';
  since: number;
}

export interface LiquidatingState {
  kind: 'LIQUIDATING';
  startTime: number;
  attemptCount: number;
}

export interface LiquidatedState {
  kind: 'LIQUIDATED';
  finalPnl: number;
  closedAt: number;
}

export interface TakeProfitState {
  kind: 'TAKE_PROFIT';
  startTime: number;
  exitPrice: number;
}

export interface PausedState {
  kind: 'PAUSED';
  reason: string;
  since: number;
}

export interface CancelledState {
  kind: 'CANCELLED';
  reason: string;
  since: number;
}

export interface HoldState {
  kind: 'HOLD';
  reason: string;
}

export type BotFsmState =
  | TrailingEntryState
  | RunningState
  | LiquidatingState
  | LiquidatedState
  | TakeProfitState
  | PausedState
  | CancelledState
  | HoldState;

// Events
export type Event =
  | { type: 'TICK'; price: number; timestamp: number }
  | { type: 'FILL'; orderId: string; clientOrderId?: string; fillQty: number; fillPrice: number; side: 'BUY' | 'SELL'; gridIndex?: number; savings?: number; savingsRate?: number }
  | { type: 'POSITION_UPDATE'; position: Position }
  | { type: 'POSITION_REFRESH'; reason: string }
  | { type: 'ORDER_UPDATE'; orderId: string; clientOrderId?: string; status: string; filledQty: number }
  // Emitted by the effect executor after the exchange confirms a placed order's id.
  // Handled in the reducer so the confirmed orderId enters state through the normal
  // event path (F9) instead of the executor mutating loop state directly.
  | { type: 'ORDER_CONFIRMED'; clientOrderId: string; orderId: string }
  // Emitted by the effect executor when a placed order is rejected by the exchange.
  // The reducer clears the ghost activeOrder so the next tick can place a new order.
  | { type: 'ORDER_REJECTED'; clientOrderId: string }
  | { type: 'CANCEL'; orderId: string; reason: string }
  | { type: 'TIMER_RECONCILE'; full: boolean }
  | { type: 'TIMER_PERSIST' }
  | { type: 'USER_PAUSE' }
  | { type: 'USER_RESUME' }
  | { type: 'USER_LIQUIDATE' }
  | { type: 'CONFIG_UPDATE'; config: Record<string, unknown> }
  | { type: 'WS_RECONNECT'; syncResult: SyncResult }
  | { type: 'POSITION_INHERITED'; symbol: string; qty: number; entryPrice: number; reason: string }
  | { type: 'ERROR_RECOVERABLE'; error: { message: string; code: string } }
  | { type: 'ERROR_FATAL'; error: { message: string; code: string } };

// Decisions
export type Decision =
  | { action: 'PLACE'; side: 'BUY' | 'SELL'; qty: number; price: number; tif: 'POC' | 'GTC'; gridPrice?: number; subGridIndex?: number; reason: string }
  | { action: 'CANCEL'; reason: string }
  | { action: 'HOLD'; reason: string }
  | { action: 'LIQUIDATE'; reason: string };

// Side Effects
export type SideEffect =
  | { type: 'PLACE_ORDER'; request: OrderRequest }
  | { type: 'CANCEL_ORDER'; orderId: string }
  | { type: 'CANCEL_ALL_ORDERS'; symbol: string }
  | { type: 'CLOSE_POSITION'; symbol: string; side: 'LONG' | 'SHORT'; qty: number }
  | { type: 'PERSIST_STATE'; snapshot: object }
  | { type: 'NOTIFY_FRONTEND'; payload: object }
  | { type: 'SCHEDULE_TIMER'; delayMs: number; event: Event };

// Polling runner types
export type BotPhase = 'IDLE' | 'ORDER_ACTIVE' | 'LIQUIDATING';

export type TriggerEvent =
  | { type: 'TIMER'; source: 'poll' }
  | { type: 'ZONE_CROSS'; price: number; previousZone: number; currentZone: number }
  | { type: 'ORDER_SETTLED'; outcome: 'FILLED' | 'CANCELLED' | 'EXPIRED'; orderId: string }
  | { type: 'USER_PAUSE' }
  | { type: 'USER_RESUME' }
  | { type: 'USER_LIQUIDATE' };

// Order Manager State
export interface ActiveOrder {
  orderId: string;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  // The grid floor/ceiling this order targets. Needed so reorder can re-run the
  // three-zone pricing (Go reconstructs it from GridIndex; we store it directly).
  gridPrice?: number;
  tif: 'POC' | 'GTC';
  placedAt: number;
  // 下单前的持仓量（baseAssetQty）。用于成交广播路径按下单前仓位一次性计算超额利润
  // （computeFillSavings 的 preOrderPosition）。可选：冷启动恢复的旧快照可能缺此字段。
  preOrderPosition?: number;
}

export interface OrderManagerState {
  activeOrder: ActiveOrder | null;
  recentlyCancelled: Set<string>;
}

// Complete Bot State
export interface BotState {
  fsm: BotFsmState;
  config: Record<string, unknown>;
  position: Position | null;
  openOrders: OrderResult[];
  lastPrice: number;
  lastPriceTime: number;
  orderManager: OrderManagerState;
  nextSeq: number;
  /** Timestamp when FSM entered RUNNING via START_MAIN_GRID (audit anchor). */
  gridActiveSince?: number;
  stats: {
    totalOrdersPlaced: number;
    totalFills: number;
    totalReorders: number;
    lastPersistTime: number;
    realizedPnl: number;
  };
}

export * from "./box-geometry";
export * from "./symbol-tiers";
import type { BoxDirection } from "./box-geometry";

// ── Shared types for GridPilot monorepo ───────────────────────
// Used by both apps/api (NestJS) and apps/web (Next.js)

export type ExchangeId = "binance" | "gateio" | "okx";
export type ExchangeEnvironment = "demo" | "live";
export type FsmState =
  | "TRAILING_ENTRY"
  | "RUNNING"
  | "LIQUIDATING"
  | "LIQUIDATED"
  | "TAKE_PROFIT"
  | "PAUSED"
  | "CANCELLED"
  | "HOLD"
  | "SLEEPING";
export type OrderSide = "buy" | "sell";
export type Direction = BoxDirection;
export type OrderRoute = "POC" | "GTC";
export type OrderStatus = "open" | "filled" | "partial" | "cancelled";

// ── Bot configuration ─────────────────────────────────────────
export interface BotRangeConfig {
  id: string;
  accountId: string;
  symbol: string;
  direction: Direction;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  activationPrice: number;
  trailingCallbackRate: number;
  excessProfitMultiplier: number;
  reorderThreshold: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Monitoring / real-time state ──────────────────────────────
export interface BotMonitorState {
  configId: string;
  sessionId: string | null;
  fsm: FsmState;
  price: number;
  bestBid: number;
  bestAsk: number;
  positionQty: number;
  positionAvgCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  makerSavings: number;
  gtcExcess: number;
  gridCycles: number;
  gtcHits: number;
  reorders: number;
  activeOrderId: string | null;
  sessionStartedAt: string | null;
}

export interface PositionInfo {
  symbol: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
}

export interface AccountSnapshot {
  credentialId: string;
  totalEquity: number;
  totalWalletBalance: number;
  availableUsdt: number;
  marginUsed: number;
  positions: PositionInfo[];
  updatedAt: number;
}

// ── API types ─────────────────────────────────────────────────
export interface CreateBotDto {
  // Request body uses `credentialId` (server maps it to the account). Entity/response
  // types use the renamed `accountId`.
  credentialId: string;
  symbol: string;
  direction: Direction;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount?: number;
  stopLossGridStep?: number;
  isolationStep?: number;
  activationPrice?: number;
  trailingCallbackRate?: number;
  excessProfitMultiplier?: number;
  reorderThreshold?: number;
}

export interface ExchangeCredentialDto {
  exchangeId: ExchangeId;
  environment: ExchangeEnvironment;
  accountId: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

// ── WebSocket events ──────────────────────────────────────────
export interface TickerEvent {
  type: "ticker";
  configId: string;
  price: number;
  bestBid: number;
  bestAsk: number;
  ts: number;
}

export interface FillEvent {
  type: "fill";
  configId: string;
  orderId: string;
  side: OrderSide;
  price: number;
  qty: number;
  route: OrderRoute;
  ts: number;
}

export interface FsmEvent {
  type: "fsm";
  configId: string;
  from: FsmState;
  to: FsmState;
  reason: string;
  ts: number;
}

export type WsEvent = TickerEvent | FillEvent | FsmEvent;

// ── Credential types ──────────────────────────────────────────

export interface Credential {
  id: string;
  exchangeId: ExchangeId;
  environment: ExchangeEnvironment;
  accountId: string;
  label: string;
  passphrase?: string;
  isActive: boolean;
  createdAt: string;
  apiKeyMasked?: string;
  apiSecretMasked?: string;
}

export interface CreateCredentialInput {
  exchangeId: ExchangeId;
  environment: ExchangeEnvironment;
  accountId: string;
  label: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export interface UpdateCredentialInput {
  exchangeId?: ExchangeId;
  accountId?: string;
  label?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  isActive?: boolean;
}

// ── Profile / Auth types ──────────────────────────────────────

export interface Profile {
  id: string;
  displayName: string;
  email: string;
  language: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  displayName?: string;
  email?: string;
  language?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  language: string;
}

// ── Notification types ────────────────────────────────────────

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  rangeId: string | null;
  /** 通知语义码（如 ROBOT_AUTO_PAUSED）；null/缺省 = 旧数据，前端直接显示 body */
  code?: string | null;
  /** code 文案插值参数（如 {symbol, runCode, reason}） */
  params?: Record<string, string> | null;
  createdAt: string;
}

// ── Bot API types ─────────────────────────────────────────────

export interface BotStatus {
  sessionCode: string;
  state: FsmState;
  symbol: string;
  direction: Direction;
  price?: number;
  positionQty?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  algoOrders?: AlgoOrderDetail[];
  activeOrder?: boolean;
  activeOrderDetail?: {
    id: string;
    side: 'buy' | 'sell';
    gridPrice: number;
    price: number;
    qty: number;
    route: 'POC' | 'GTC';
    placedAt: number;
  } | null;
  totalFills?: number;
  totalOrdersPlaced?: number;
  totalReorders?: number;
  entryPrice?: number;
  leverage?: number;
  marginType?: 'CROSS' | 'ISOLATED';
}

export interface AlgoOrderDetail {
  type: 'emergency' | 'other';
  side: 'buy' | 'sell';
  triggerPrice: number;
  qty: number;
  closePosition: boolean;
  status: 'open' | 'triggered';
  clientOrderId?: string;
}

// ── Stop-loss related types ────────────────────────────────

export interface BotSessionConfig {
  id: string;
  symbol: string;
  direction: Direction;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  mainGridPortionSize: number;
  leverage: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  activationPrice?: number;
  trailingCallbackRate?: number;
  excessProfitMultiplier?: number;
  reorderThreshold?: number;
  account?: {
    exchangeId: ExchangeId;
    accountId: string;
    label: string;
  };
}

export interface BotSession {
  id: string;
  boxId: string;
  runCode: string;
  state: FsmState;
  startedAt?: string;
  stoppedAt?: string;
  createdAt: string;
  updatedAt: string;
  box?: BotSessionConfig;
}

export interface BotOrder {
  id: string;
  sessionId: string;
  side: OrderSide;
  price: number;
  qty: number;
  status: string;
  createdAt: string;
}

export interface StartBotResponse {
  success: boolean;
  sessionCode: string;
  state: FsmState;
  sessionId: string;
}

export interface StopBotResponse {
  success: boolean;
  sessionCode: string;
}

export interface SessionListParams {
  state?: FsmState;
  limit?: number;
  offset?: number;
}

export interface SessionListResponse {
  data: BotSession[];
  total: number;
  limit: number;
  offset: number;
}


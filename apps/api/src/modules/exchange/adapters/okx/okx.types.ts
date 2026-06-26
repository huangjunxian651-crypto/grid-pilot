// OKX adapter internal types
// Maps between IExchangeAdapter types and OKX v5 API types

import {
  Ticker,
  Order,
  OrderFill,
  AlgoOrder,
  AlgoTrigger,
  Position,
  Balance,
  MarketInfo,
  SyncResult,
} from "../../interfaces/exchange-adapter.interface";

// OKX raw symbol format: ETH-USDT-SWAP
export const OKX_INST_TYPE = "SWAP";
export const OKX_SYMBOL = "ETH-USDT-SWAP";
/**
 * 本项目实际下的 algo 单是紧急止损平仓单——走 OKX `conditional` 止损单
 * （slTriggerPx 触发 + slOrdPx=-1 市价 + closeFraction=1 reduce-only 平整仓）。
 * 查询挂起 algo 单时 ordType 为 OKX 必填参数，故拉取/撤销也用 conditional。
 */
export const OKX_ALGO_ORD_TYPE = "conditional";

// Demo / simulated trading endpoints
// OKX simulated trading uses the same REST host but requires 'x-simulated-trading: 1' header
// WebSocket demo endpoints
export const OKX_REST_DEMO = "https://www.okx.com";
export const OKX_WS_PRIVATE = "wss://wspap.okx.com:8443/ws/v5/private";
export const OKX_WS_PUBLIC = "wss://wspap.okx.com:8443/ws/v5/public";
/** @deprecated Use OKX_WS_PRIVATE instead */
export const OKX_WS_DEMO = OKX_WS_PRIVATE;

// Simulated trading header required for all demo API requests
export const OKX_SIMULATED_TRADING_HEADER = "1";

export interface OkxCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

// OKX API response types
export interface OkxTicker {
  instId: string;
  bidPx: string;
  askPx: string;
  last: string;
  ts: string;
}

export interface OkxOrder {
  ordId: string;
  clOrdId?: string;
  instId: string;
  side: string;
  ordType: string;
  sz: string;
  px?: string;
  state: string;
  fillSz: string;
  avgPx?: string;
  uTime: string;
}

export interface OkxAlgoOrder {
  algoId: string;
  algoClOrdId?: string;
  instId: string;
  side: string;
  ordType: string;
  triggerPx: string;
  triggerPxType: string;
  // conditional 止损单的触发价在 slTriggerPx（非 triggerPx）
  slTriggerPx?: string;
  slOrdPx?: string;
  sz: string;
  ordPx: string;
  state: string;
  cTime: string;
}

export interface OkxPosition {
  instId: string;
  posSide: string;
  pos: string;
  avgPx: string;
  upl: string;
  lever: string;
  uplRatio: string;
  mgnMode: string;
  availPos: string;
}

export interface OkxBalance {
  ccy: string;
  availEq: string;
  availBal?: string;
  eq: string;
}

export interface OkxInstrument {
  instId: string;
  minSz: string;
  lotSz: string;
  tickSz: string;
  ctVal: string;
  ctValCcy: string;
  makerFee: string;
  takerFee: string;
  minNotionalSz?: string;
}

// Gate.io adapter internal types
// Maps between IExchangeAdapter types and Gate.io SDK types

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

// Gate.io raw symbol format: ETH_USDT
export const GATEIO_SETTLE = "usdt";
export const GATEIO_SYMBOL = "ETH_USDT";

// Testnet endpoints — using official endpoints from Gate.io documentation
// Docs reference: https://api-testnet.gateapi.io/api/v4
// WebSocket docs: https://www.gate.com/docs/developers/futures/ws/en/
export const GATEIO_REST_TESTNET = "https://api-testnet.gateapi.io/api/v4";
export const GATEIO_WS_TESTNET = "wss://ws-testnet.gate.com/v4/ws/futures/usdt";
// Live (real funds) endpoints
export const GATEIO_REST_LIVE = "https://api.gateio.ws/api/v4";
export const GATEIO_WS_LIVE = "wss://fx-ws.gateio.ws/v4/ws/usdt";

export interface GateioCredentials {
  apiKey: string;
  apiSecret: string;
}

// Binance adapter internal types
// Maps between IExchangeAdapter types and Binance SDK types

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

// Binance raw symbol format: ETHUSDT
export const BINANCE_SYMBOL = "ETHUSDT";

// Demo (simulated trading) endpoints — matches the demo API keys in exchange_accounts.md
// Testnet: https://testnet.binancefuture.com (requires GitHub-linked testnet keys)
// Demo:    https://demo-fapi.binance.com (uses real account keys, simulated funds)
export const BINANCE_REST_DEMO = "https://demo-fapi.binance.com";
export const BINANCE_WS_DEMO = "wss://stream.binancefuture.com";
// Live (real funds) endpoints
export const BINANCE_REST_LIVE = "https://fapi.binance.com";
export const BINANCE_WS_LIVE = "wss://fstream.binance.com";

// Deprecated aliases for backward compatibility
/** @deprecated Use BINANCE_REST_DEMO instead */
export const BINANCE_REST_TESTNET = BINANCE_REST_DEMO;
/** @deprecated Use BINANCE_WS_DEMO instead */
export const BINANCE_WS_TESTNET = BINANCE_WS_DEMO;

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
}

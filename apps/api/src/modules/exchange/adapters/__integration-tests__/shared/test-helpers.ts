/**
 * Shared test helpers for exchange integration tests.
 */

import axios from "axios";
import { IExchangeAdapter } from "../../../interfaces/exchange-adapter.interface";
import { BINANCE_REST_DEMO } from "../../binance/binance.types";
import { GATEIO_REST_TESTNET } from "../../gateio/gateio.types";
import { OKX_REST_DEMO } from "../../okx/okx.types";

/**
 * Sleep for a given duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique client order ID for test isolation.
 * Compact format to stay within exchange limits (Gate.io text max ~30 chars).
 */
export function makeClientId(prefix: string): string {
  // Use base36 timestamp (~8 chars) instead of full timestamp (13 chars)
  // Total: prefix (~4) + separator (1) + ts (~8) + separator (1) + rand (4) = ~18 chars
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Clean up all orders and positions for a symbol.
 * Best-effort: ignores errors to ensure cleanup completes.
 */
export async function cleanup(adapter: IExchangeAdapter, symbol: string): Promise<void> {
  try {
    await adapter.cancelAllOrders(symbol);
  } catch { /* ignore */ }

  try {
    await adapter.cancelAllAlgoOrders(symbol);
  } catch { /* ignore */ }

  try {
    const pos = await adapter.fetchPosition(symbol);
    if (pos.side !== "none" && pos.qty > 0) {
      await adapter.closePosition(symbol, pos.side);
    }
  } catch { /* ignore */ }

  // Wait for cancellation to propagate
  await sleep(1000);
}

/**
 * Verify adapter can fetch market info and return valid values.
 */
export async function verifyMarketInfo(adapter: IExchangeAdapter, symbol: string): Promise<void> {
  const info = await adapter.getMarketInfo(symbol);

  if (!info.symbol) throw new Error("MarketInfo.symbol is missing");
  if (!info.rawSymbol) throw new Error("MarketInfo.rawSymbol is missing");
  if (info.minQty <= 0) throw new Error(`MarketInfo.minQty must be > 0, got ${info.minQty}`);
  if (info.stepSize <= 0) throw new Error(`MarketInfo.stepSize must be > 0, got ${info.stepSize}`);
  if (info.tickSize <= 0) throw new Error(`MarketInfo.tickSize must be > 0, got ${info.tickSize}`);
  if (info.contractSize <= 0) throw new Error(`MarketInfo.contractSize must be > 0, got ${info.contractSize}`);
  // makerFeeRate can be negative (rebate), e.g. Gate.io returns -0.0001
  // takerFeeRate should still be >= 0
  if (info.takerFeeRate < 0) throw new Error(`MarketInfo.takerFeeRate must be >= 0, got ${info.takerFeeRate}`);
}

/**
 * Safe test prices for a symbol.
 */
export interface SafePrices {
  /** Base reference price (formatted to tick size) */
  base: number;
  /** Bid price (below market, for buy limit orders) */
  bid: number;
  /** Ask price (above market, for sell limit orders) */
  ask: number;
  /** Trigger price below market (for stop-loss / price_below) */
  triggerBelow: number;
  /** Trigger price above market (for stop-loss / price_above) */
  triggerAbove: number;
}

/**
 * Fetch current mark price from exchange public API.
 */
async function fetchMarkPrice(exchangeId: string, symbol: string): Promise<number | null> {
  try {
    switch (exchangeId) {
      case "binance": {
        const { data } = await axios.get(`${BINANCE_REST_DEMO}/fapi/v1/premiumIndex`, {
          params: { symbol: "ETHUSDT" },
          timeout: 5000,
        });
        return parseFloat(data.markPrice);
      }
      case "gateio": {
        const { data } = await axios.get(`${GATEIO_REST_TESTNET}/futures/usdt/contracts/ETH_USDT`, {
          timeout: 5000,
        });
        // Gate.io returns snake_case field names
        return parseFloat(data.mark_price) || parseFloat(data.last_price) || null;
      }
      case "okx": {
        const { data } = await axios.get(`${OKX_REST_DEMO}/api/v5/market/ticker`, {
          params: { instId: "ETH-USDT-SWAP" },
          timeout: 5000,
          headers: { "x-simulated-trading": "1" },
        });
        if (data.data && data.data[0]) {
          return parseFloat(data.data[0].last);
        }
        return null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Get safe test prices for a symbol.
 * Returns formatted prices far enough from market to avoid immediate fills.
 */
export async function getSafeTestPrice(adapter: IExchangeAdapter, symbol: string): Promise<SafePrices> {
  const info = await adapter.getMarketInfo(symbol);

  // Fetch real mark price from exchange
  let basePrice = await fetchMarkPrice(adapter.exchangeId, symbol);

  // Fallback to position avg cost
  if (!basePrice || basePrice <= 0) {
    try {
      const pos = await adapter.fetchPosition(symbol);
      if (pos.avgCost > 0) {
        basePrice = pos.avgCost;
      }
    } catch { /* ignore */ }
  }

  // Final fallback
  if (!basePrice || basePrice <= 0) {
    basePrice = 2200;
  }

  return {
    base: formatPrice(basePrice, info.tickSize),
    bid: formatPrice(basePrice * 0.98, info.tickSize),
    ask: formatPrice(basePrice * 1.02, info.tickSize),
    triggerBelow: formatPrice(basePrice * 0.95, info.tickSize),
    triggerAbove: formatPrice(basePrice * 1.05, info.tickSize),
  };
}

/**
 * Format a price to the exchange's tick size precision.
 * Ensures the price is an integer multiple of tickSize.
 */
export function formatPrice(price: number, tickSize: number): number {
  const decimals = countDecimals(tickSize);
  const steps = Math.round(price / tickSize);
  return Number((steps * tickSize).toFixed(decimals));
}

/**
 * Format a quantity to the exchange's step size precision.
 */
export function formatQty(qty: number, stepSize: number): number {
  const decimals = countDecimals(stepSize);
  return Number(qty.toFixed(decimals));
}

/**
 * Count decimal places in a number.
 */
function countDecimals(n: number): number {
  const s = n.toString();
  if (s.includes("e-")) {
    return parseInt(s.split("e-")[1], 10);
  }
  const idx = s.indexOf(".");
  return idx === -1 ? 0 : s.length - idx - 1;
}

/**
 * Get minimum valid quantity for a symbol.
 * Ensures quantity satisfies both minQty and minNotional constraints,
 * and will not round to 0 contracts when converted.
 */
export async function getMinQty(adapter: IExchangeAdapter, symbol: string): Promise<number> {
  const info = await adapter.getMarketInfo(symbol);
  let qty = Math.max(info.minQty, info.stepSize);

  // Ensure qty is at least 1 contract size (prevents rounding to 0 contracts)
  const minContractsQty = info.contractSize;
  qty = Math.max(qty, minContractsQty);

  // If minNotional is specified, ensure qty * referencePrice >= minNotional
  if (info.minNotional > 0) {
    const refPrice = 2000; // Conservative ETH price estimate
    const minQtyForNotional = info.minNotional / refPrice;
    qty = Math.max(qty, minQtyForNotional);
  }

  // Round up to step size
  const steps = Math.ceil(qty / info.stepSize);
  qty = steps * info.stepSize;

  return qty;
}

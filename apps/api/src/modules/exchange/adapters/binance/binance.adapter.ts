// BinanceAdapter — USD-M 永续合约适配器
// 使用 axios 直接对接 Binance REST API
// 按 environment 路由端点：demo(默认，模拟盘 BINANCE_REST_DEMO) / live(实盘 BINANCE_REST_LIVE)

import { createHmac } from "crypto";
import axios, { AxiosError } from "axios";
import {
  IExchangeAdapter,
  ExchangeError,
  ErrorCategory,
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
  FundingFeeRecord,
} from "../../interfaces/exchange-adapter.interface";
import { BINANCE_REST_DEMO, BINANCE_WS_DEMO, BINANCE_REST_LIVE, BINANCE_WS_LIVE } from "./binance.types";
import { BinanceWsClient } from "./binance-ws-client";
import { toBinanceSymbol, toBinanceClientId } from "../utils";
import { withRetry } from "../utils/retry";
import { formatPrice, formatQty, toFixedPrecision } from "../../../trading-engine/pricing/format-precision";
import { ExchangeEnvironment } from "@gridpilot/shared-types";

/**
 * -2011 "Unknown order sent."：订单不存在/已撤/已成交（testnet 实测
 * 2026-06-12）。撤单的目标状态（不再活跃）已达成，按幂等成功处理，
 * 与 OKX 51400 同款（否则 runner cancelWithRetry 空转 3 次重试）。
 */
const BINANCE_CANCEL_TARGET_ALREADY_GONE = "-2011";

// ── Helper Types for Binance API Responses ────────────────────

interface BinanceOrderResponse {
  orderId: number;
  clientOrderId?: string;
  symbol: string;
  side: string;
  type: string;
  origQty: string;
  price: string;
  status: string;
  executedQty: string;
  avgPrice: string;
  updateTime: number;
  timeInForce?: string;
}

interface BinanceAlgoOrderResponse {
  algoId: number;
  clientAlgoId?: string;
  symbol: string;
  side: string;
  algoType: string;
  type: string;
  triggerPrice: string;
  status: string;
  origQty?: string;
  closePosition?: boolean;
  updateTime: number;
}

interface BinancePositionRisk {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  /** 实际 API 返回 unRealizedProfit（大写 R）；保留小写兼容历史 mock/旧网关 */
  unRealizedProfit?: string;
  unrealizedProfit?: string;
  leverage: string;
  marginType: string;
  positionSide: string;
  updateTime: number;
}

interface BinanceAccountInfo {
  totalWalletBalance: string;
  totalMarginBalance: string;
  availableBalance: string;
  updateTime: number;
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbolInfo[];
}

interface BinanceSymbolInfo {
  symbol: string;
  contractType: string;
  filters: Array<
    | { filterType: "LOT_SIZE"; minQty: string; maxQty: string; stepSize: string }
    | { filterType: "MIN_NOTIONAL"; notional: string }
    | { filterType: "PRICE_FILTER"; minPrice: string; maxPrice: string; tickSize: string }
  >;
}

interface BinanceErrorResponse {
  code: number;
  msg: string;
}

// ── Signature Helper ──────────────────────────────────────────

function sign(queryString: string, secret: string): string {
  return createHmac("sha256", secret).update(queryString).digest("hex");
}

// ── Pure helpers ─────────────────────────────────────────────

/**
 * Maps a Binance REST /fapi/v1/userTrades entry to an OrderFill.
 */
export function mapBinanceRestTrade(t: Record<string, unknown>): OrderFill {
  return {
    orderId: String(t.orderId),
    tradeId: t.id != null ? String(t.id) : undefined,
    symbol: (t.symbol as string).replace(/USDT$/, '/USDT'),
    side: (t.side as string).toLowerCase() as 'buy' | 'sell',
    filledQty: parseFloat(t.qty as string),
    avgPrice: parseFloat(t.price as string),
    fee: t.commission != null ? parseFloat(t.commission as string) : undefined,
    feeAsset: (t.commissionAsset as string) ?? undefined,
    status: 'filled',
    ts: Number(t.time ?? 0),
  };
}

/**
 * Maps a Binance ORDER_TRADE_UPDATE `o` payload to an OrderFill.
 * Returns null when the push carries no new fill (lastFilledQty === 0).
 */
export function mapOrderTradeUpdate(order: Record<string, unknown>): OrderFill | null {
  const lastFilledQty = parseFloat(order.l as string);
  if (!lastFilledQty || lastFilledQty === 0) return null;
  return {
    orderId: String(order.i),
    clientOrderId: order.c as string,
    tradeId: order.t != null ? String(order.t) : undefined,
    symbol: (order.s as string).replace(/USDT$/, '/USDT'),
    side: (order.S as string).toLowerCase() as 'buy' | 'sell',
    filledQty: lastFilledQty,
    avgPrice: parseFloat(order.L as string),
    fee: order.n != null ? parseFloat(order.n as string) : undefined,
    feeAsset: (order.N as string) ?? undefined,
    status: (order.X as string) === 'FILLED' ? 'filled' : 'partial',
    ts: Date.now(),
  };
}

// ── Adapter Implementation ────────────────────────────────────

export class BinanceAdapter implements IExchangeAdapter {
  readonly exchangeId = "binance" as const;
  readonly accountId: string;

  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private wsUrl: string;
  private environment: ExchangeEnvironment;
  private http = axios.create({ timeout: 30000 });

  // WebSocket clients (lazy initialized)
  private publicWs: BinanceWsClient | null = null;
  private userDataWs: BinanceWsClient | null = null;

  // Track per-generator WS clients so destroy() can clean them up
  private activeWsClients = new Set<BinanceWsClient>();

  // Cache for MarketInfo to avoid repeated API calls
  private marketInfoCache = new Map<string, MarketInfo>();

  constructor(credentials: { apiKey: string; apiSecret: string; accountId?: string; environment?: ExchangeEnvironment }) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.accountId = credentials.accountId ?? "binance-account";
    this.environment = credentials.environment ?? "demo";
    this.baseUrl = this.environment === "live" ? BINANCE_REST_LIVE : BINANCE_REST_DEMO;
    this.wsUrl = this.environment === "live" ? BINANCE_WS_LIVE : BINANCE_WS_DEMO;
  }

  // ── Private REST Helper ─────────────────────────────────────

  private async signedRequest<T>(
    method: "GET" | "POST" | "DELETE",
    endpoint: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    const timestamp = Date.now();
    const queryParts: string[] = [`timestamp=${timestamp}`];

    // TODO: Handle array params (Binance expects key[]=a&key[]=b format)
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }

    const queryString = queryParts.join("&");
    const signature = sign(queryString, this.apiSecret);
    const fullQuery = `${queryString}&signature=${signature}`;

    const url = `${this.baseUrl}${endpoint}?${fullQuery}`;

    try {
      const response = await this.http.request<T>({
        method,
        url,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError<BinanceErrorResponse>;
        const binanceErr = axiosErr.response?.data;
        const status = axiosErr.response?.status;

        // HTTP-level rate limits and server errors
        if (status === 429 || status === 418) {
          throw new ExchangeError(
            `Binance rate limit (HTTP ${status}): ${binanceErr?.msg ?? axiosErr.message}`,
            "RATE_LIMIT",
            this.exchangeId,
            true,
          );
        }
        if (status && status >= 500) {
          throw new ExchangeError(
            `Binance server error (HTTP ${status}): ${binanceErr?.msg ?? axiosErr.message}`,
            "SERVER_ERROR",
            this.exchangeId,
            true,
          );
        }

        if (binanceErr) {
          if (binanceErr.code === -5022) {
            throw new ExchangeError(
              `Binance API error [${binanceErr.code}]: ${binanceErr.msg}`,
              String(binanceErr.code),
              this.exchangeId,
              false,
              ErrorCategory.POST_ONLY_REJECT,
            );
          }
          const retryableCodes = [-1003, -1008, -1016, -1021, -1022, -2015];
          const isRetryable = retryableCodes.includes(binanceErr.code);
          throw new ExchangeError(
            `Binance API error [${binanceErr.code}]: ${binanceErr.msg}`,
            String(binanceErr.code),
            this.exchangeId,
            isRetryable,
          );
        }
        // Network-level errors (no response) are retryable
        throw new ExchangeError(
          `Binance network error: ${axiosErr.message}`,
          "NETWORK_ERROR",
          this.exchangeId,
          true,
        );
      }
      throw new ExchangeError(
        `Binance unexpected error: ${(err as Error)?.message ?? String(err)}`,
        "UNKNOWN_ERROR",
        this.exchangeId,
        false,
      );
    }
  }

  // ── Public REST Helper (no signature) ───────────────────────

  private async publicRequest<T>(
    endpoint: string,
    params: Record<string, string | number | undefined> = {},
  ): Promise<T> {
    const queryParts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
    const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";
    const url = `${this.baseUrl}${endpoint}${query}`;

    try {
      const response = await this.http.request<T>({ method: "GET", url });
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError<BinanceErrorResponse>;
        const status = axiosErr.response?.status;
        if (status === 429 || status === 418) {
          throw new ExchangeError(
            `Binance rate limit (HTTP ${status})`,
            "RATE_LIMIT",
            this.exchangeId,
            true,
          );
        }
        if (status && status >= 500) {
          throw new ExchangeError(
            `Binance server error (HTTP ${status})`,
            "SERVER_ERROR",
            this.exchangeId,
            true,
          );
        }
        throw new ExchangeError(
          `Binance network error: ${axiosErr.message}`,
          "NETWORK_ERROR",
          this.exchangeId,
          true,
        );
      }
      throw new ExchangeError(
        `Binance unexpected error: ${(err as Error)?.message ?? String(err)}`,
        "UNKNOWN_ERROR",
        this.exchangeId,
        false,
      );
    }
  }

  // ── REST Ticker (cold-start fallback when WS is unavailable) ──

  async getTicker(symbol: string): Promise<Ticker> {
    const binanceSymbol = toBinanceSymbol(symbol);

    const [book, price] = await Promise.all([
      this.publicRequest<{ bidPrice: string; askPrice: string; time?: number }>(
        "/fapi/v1/ticker/bookTicker",
        { symbol: binanceSymbol },
      ),
      this.publicRequest<{ price: string; time?: number }>(
        "/fapi/v1/ticker/price",
        { symbol: binanceSymbol },
      ),
    ]);

    return {
      symbol,
      bestBid: parseFloat(book.bidPrice),
      bestAsk: parseFloat(book.askPrice),
      lastPrice: parseFloat(price.price),
      ts: book.time ?? price.time ?? Date.now(),
    };
  }

  // ── WebSocket Streams ─────────────────────────────────────────

  async *watchTicker(symbol: string): AsyncIterableIterator<Ticker> {
    const client = new BinanceWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, false, this.environment);
    this.activeWsClients.add(client);
    const STREAM_TIMEOUT_MS = 30000; // 30s without any tick is considered stale
    try {
      await client.connect();

      const binanceSymbol = toBinanceSymbol(symbol).toLowerCase();
      client.subscribe([`${binanceSymbol}@bookTicker`]);

      const queue: Ticker[] = [];
      let resolveNext: (() => void) | null = null;
      let lastTickAt = Date.now();

      const onBookTicker = (msg: Record<string, unknown>) => {
        lastTickAt = Date.now();
        const bestAsk = parseFloat(msg.a as string);
        // 缺字段帧映射出 NaN/0 价 ticker 会被 FSM 当真实价误清算，丢弃
        if (!Number.isFinite(bestAsk) || bestAsk <= 0) return;
        queue.push({
          symbol,
          bestBid: parseFloat(msg.b as string),
          bestAsk,
          lastPrice: bestAsk, // bookTicker doesn't have lastPrice
          ts: Date.now(),
        });
        resolveNext?.();
      };

      client.on("bookTicker", onBookTicker);

      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            let timer: NodeJS.Timeout | null = null;
            await new Promise<void>((resolve) => {
              resolveNext = () => {
                if (timer) clearTimeout(timer);
                resolve();
              };
              timer = setTimeout(() => {
                resolve();
              }, STREAM_TIMEOUT_MS);
              if (queue.length > 0) {
                if (timer) clearTimeout(timer);
                resolve();
              }
            });

            // If we timed out with no data, the stream is likely dead
            if (queue.length === 0 && Date.now() - lastTickAt >= STREAM_TIMEOUT_MS) {
              throw new ExchangeError(
                `Binance ticker stream stalled for ${symbol}`,
                "WS_STALLED",
                this.exchangeId,
                true,
              );
            }
          }
        }
      } finally {
        client.off("bookTicker", onBookTicker);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchOrderFills(_symbol: string): AsyncIterableIterator<OrderFill> {
    const client = new BinanceWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, true, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();

      const queue: OrderFill[] = [];
      let resolveNext: (() => void) | null = null;

      const onOrderUpdate = (msg: Record<string, unknown>) => {
        const f = mapOrderTradeUpdate(msg.o as Record<string, unknown>);
        if (f) { queue.push(f); resolveNext?.(); }
      };

      client.on("ORDER_TRADE_UPDATE", onOrderUpdate);

      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
              if (queue.length > 0) resolve();
            });
          }
        }
      } finally {
        client.off("ORDER_TRADE_UPDATE", onOrderUpdate);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchAlgoTriggers(_symbol: string): AsyncIterableIterator<AlgoTrigger> {
    const client = new BinanceWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, true, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();

      const queue: AlgoTrigger[] = [];
      let resolveNext: (() => void) | null = null;

      // Binance algo orders appear in ORDER_TRADE_UPDATE when triggered
      const onOrderUpdate = (msg: Record<string, unknown>) => {
        const order = msg.o as Record<string, unknown>;
        // Check if this is an algo order that was triggered (type=STOP_MARKET, status=NEW but from algo)
        // Binance doesn't clearly distinguish algo triggers in WS; we use order type and context
        if (order.ot !== "STOP_MARKET" && order.ot !== "STOP") return;
        if (parseFloat(order.l as string) === 0) return; // No fill yet

        queue.push({
          algoOrderId: String(order.i),
          clientAlgoId: order.c as string,
          symbol: (order.s as string).replace(/USDT$/, "/USDT"),
          side: (order.S as string).toLowerCase() as "buy" | "sell",
          triggerPrice: parseFloat(order.sp as string) || 0, // stop price
          filledQty: parseFloat(order.l as string),
          ts: Date.now(),
        });
        resolveNext?.();
      };

      client.on("ORDER_TRADE_UPDATE", onOrderUpdate);

      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
              if (queue.length > 0) resolve();
            });
          }
        }
      } finally {
        client.off("ORDER_TRADE_UPDATE", onOrderUpdate);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchPositions(_symbol: string): AsyncIterableIterator<Position> {
    const client = new BinanceWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, true, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();

      const queue: Position[] = [];
      let resolveNext: (() => void) | null = null;

      const onAccountUpdate = (msg: Record<string, unknown>) => {
        const positions = (msg.a as Record<string, unknown>)?.P as Array<Record<string, unknown>>;
        if (!Array.isArray(positions)) return;

        for (const pos of positions) {
          const symbol = (pos.s as string).replace(/USDT$/, "/USDT");
          const amt = parseFloat(pos.pa as string);
          queue.push({
            symbol,
            side: amt > 0 ? "long" : amt < 0 ? "short" : "none",
            qty: Math.abs(amt),
            avgCost: parseFloat(pos.ep as string) || 0,
            unrealizedPnl: parseFloat(pos.up as string) || 0,
            leverage: parseInt(pos.l as string) || 1,
            ts: Date.now(),
          });
        }
        resolveNext?.();
      };

      client.on("ACCOUNT_UPDATE", onAccountUpdate);

      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
              if (queue.length > 0) resolve();
            });
          }
        }
      } finally {
        client.off("ACCOUNT_UPDATE", onAccountUpdate);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  // ── Orders ────────────────────────────────────────────────────

  async createOrder(params: CreateOrderParams): Promise<Order> {
    const binanceSymbol = toBinanceSymbol(params.symbol);
    // 静默 slice(0,36) 会把高序号网格 id 截成低序号撞 id，成交被错误归属。
    if (params.clientOrderId && params.clientOrderId.length > 36) {
      throw new ExchangeError(
        `Binance clientOrderId too long: "${params.clientOrderId}" (${params.clientOrderId.length} > 36)`,
        "CLIENT_ID_TOO_LONG",
        this.exchangeId,
        false,
      );
    }
    const clientOrderId = params.clientOrderId
      ? toBinanceClientId(params.clientOrderId)
      : undefined;

    let type: string;
    let timeInForce: string | undefined;

    switch (params.type) {
      case "market":
        type = "MARKET";
        break;
      case "limit":
        type = "LIMIT";
        timeInForce = "GTC";
        break;
      case "post_only":
        type = "LIMIT";
        timeInForce = "GTX";
        break;
      default:
        type = "LIMIT";
        timeInForce = "GTC";
    }

    const requestParams: Record<string, string | number | boolean | undefined> = {
      symbol: binanceSymbol,
      side: params.side.toUpperCase(),
      type,
      quantity: params.qty,
      reduceOnly: params.reduceOnly,
    };

    if (params.price !== undefined) {
      requestParams.price = params.price;
    }

    if (timeInForce) {
      requestParams.timeInForce = timeInForce;
    }

    if (clientOrderId) {
      requestParams.newClientOrderId = clientOrderId;
    }

    const res = await this.signedRequest<BinanceOrderResponse>("POST", "/fapi/v1/order", requestParams);

    return this.mapBinanceOrder(res, params.symbol);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol);
    await withRetry(
      () => this.signedRequest<BinanceOrderResponse>("DELETE", "/fapi/v1/order", {
        symbol: binanceSymbol,
        orderId,
      }),
      {},
      "cancelOrder",
    );
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol);
    await withRetry(
      () => this.signedRequest<Record<string, unknown>>("DELETE", "/fapi/v1/allOpenOrders", {
        symbol: binanceSymbol,
      }),
      {},
      "cancelAllOrders",
    );
  }

  async closePosition(symbol: string, side: "long" | "short"): Promise<Order> {
    const binanceSymbol = toBinanceSymbol(symbol);
    const closeSide = side === "long" ? "SELL" : "BUY";

    // Fetch current position to get exact qty (aligned with OKX pattern)
    const pos = await this.fetchPosition(symbol);
    if (pos.qty === 0) {
      throw new ExchangeError(
        `No open position to close for ${symbol}`,
        "NO_POSITION",
        this.exchangeId,
        false,
      );
    }

    const requestParams: Record<string, string | number | boolean | undefined> = {
      symbol: binanceSymbol,
      side: closeSide,
      type: "MARKET",
      quantity: pos.qty,
      reduceOnly: true,
    };

    const res = await this.signedRequest<BinanceOrderResponse>("POST", "/fapi/v1/order", requestParams);

    return this.mapBinanceOrder(res, symbol);
  }

  // ── Algo Orders ───────────────────────────────────────────────

  async createAlgoOrder(params: CreateAlgoOrderParams): Promise<AlgoOrder> {
    const binanceSymbol = toBinanceSymbol(params.symbol);
    // 与 createOrder/OKX/Gate 守卫一致：超长 fail-loud 而非静默截断
    if (params.clientAlgoId.length > 36) {
      throw new ExchangeError(
        `Binance clientAlgoId too long: "${params.clientAlgoId}" (${params.clientAlgoId.length} > 36)`,
        "CLIENT_ID_TOO_LONG",
        this.exchangeId,
        false,
      );
    }
    const clientAlgoId = toBinanceClientId(params.clientAlgoId);

    // Get market info for precision formatting (cached)
    let marketInfo = this.marketInfoCache.get(params.symbol);
    if (!marketInfo) {
      marketInfo = await this.getMarketInfo(params.symbol);
      this.marketInfoCache.set(params.symbol, marketInfo);
    }

    // Format triggerPrice to tickSize precision (aligned with Go PlaceAlgoOrder:725)
    const formattedTriggerPrice = formatPrice(params.triggerPrice, marketInfo.tickSize);

    // triggerCondition mapping:
    // price_below → STOP (trigger when price <= triggerPrice for SELL, or >= for BUY)
    // For Binance STOP_MARKET: if side=SELL, triggerPrice is stop price (triggers when markPrice <= triggerPrice)
    // if side=BUY, triggers when markPrice >= triggerPrice
    // This maps naturally to our semantics:
    //   sell + price_below = STOP (stop loss for long position)
    //   buy + price_above = STOP (stop loss for short position)

    const requestParams: Record<string, string | number | boolean | undefined> = {
      symbol: binanceSymbol,
      side: params.side.toUpperCase(),
      algoType: "CONDITIONAL",
      type: "STOP_MARKET",
      triggerPrice: formattedTriggerPrice,
      clientAlgoId,
    };

    if (params.closePosition) {
      requestParams.closePosition = true;
      // closePosition=true cannot be used with quantity
    } else {
      // Format qty to stepSize precision (aligned with Go PlaceAlgoOrder:756)
      const formattedQty = formatQty(params.qty, marketInfo.stepSize);
      requestParams.quantity = formattedQty;
      if (params.reduceOnly) {
        requestParams.reduceOnly = true;
      }
    }

    const res = await this.signedRequest<BinanceAlgoOrderResponse>(
      "POST",
      "/fapi/v1/algoOrder",
      requestParams
    );

    return this.mapBinanceAlgoOrder(res, params.symbol, params.triggerCondition);
  }

  async cancelAlgoOrder(algoOrderId: string, symbol: string): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol);
    try {
      await withRetry(
        () => this.signedRequest<Record<string, unknown>>("DELETE", "/fapi/v1/algoOrder", {
          symbol: binanceSymbol,
          algoId: algoOrderId,
        }),
        {},
        "cancelAlgoOrder",
      );
    } catch (err) {
      if (!(err instanceof ExchangeError) || err.code !== BINANCE_CANCEL_TARGET_ALREADY_GONE) {
        throw err;
      }
    }
  }

  async cancelAllAlgoOrders(symbol: string): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol);
    await withRetry(
      () => this.signedRequest<Record<string, unknown>>("DELETE", "/fapi/v1/algoOpenOrders", {
        symbol: binanceSymbol,
      }),
      {},
      "cancelAllAlgoOrders",
    );
  }

  async fetchAlgoOrders(symbol: string): Promise<AlgoOrder[]> {
    const binanceSymbol = toBinanceSymbol(symbol);
    // Query OPEN conditional orders: GET /fapi/v1/openAlgoOrders (weight 1 with symbol).
    // NOT /fapi/v1/algoOpenOrders — that path only exists as DELETE (cancel-all) and a
    // GET against it returns -5000 "Method GET is invalid". Confirmed against Binance
    // Derivatives docs (conditional orders migrated to the Algo service 2025-12-09).
    const res = await withRetry(
      () => this.signedRequest<BinanceAlgoOrderResponse[]>("GET", "/fapi/v1/openAlgoOrders", {
        symbol: binanceSymbol,
      }),
      {},
      "fetchAlgoOrders",
    );

    // Binance does not return triggerCondition directly; we infer from side + triggerPrice context
    // Default to price_below for SELL, price_above for BUY (standard stop-loss semantics)
    return res.map((o) =>
      this.mapBinanceAlgoOrder(
        o,
        symbol,
        o.side === "SELL" ? "price_below" : "price_above"
      )
    );
  }

  isImmediateTriggerError(err: Error): boolean {
    return "code" in err && (err as { code: unknown }).code === -2021;
  }

  // ── Account Initialization ────────────────────────────────────

  async setPositionMode(oneWay: boolean): Promise<void> {
    try {
      await this.signedRequest<Record<string, unknown>>("POST", "/fapi/v1/positionSide/dual", {
        dualSidePosition: !oneWay,
      });
    } catch (err) {
      // Already in the requested mode — no-op
      if (err instanceof ExchangeError && err.code === "-4059") {
        return;
      }
      throw err;
    }
  }

  async getPositionMode(): Promise<boolean> {
    const res = await this.signedRequest<{ dualSidePosition: boolean }>(
      "GET",
      "/fapi/v1/positionSide/dual"
    );
    return !res.dualSidePosition;
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const binanceSymbol = toBinanceSymbol(symbol);
    await this.signedRequest<Record<string, unknown>>("POST", "/fapi/v1/leverage", {
      symbol: binanceSymbol,
      leverage,
    });
  }

  async setMarginMode(symbol: string, crossMargin: boolean): Promise<void> {
    try {
      const binanceSymbol = toBinanceSymbol(symbol);
      await this.signedRequest<Record<string, unknown>>("POST", "/fapi/v1/marginType", {
        symbol: binanceSymbol,
        marginType: crossMargin ? "CROSSED" : "ISOLATED",
      });
    } catch (err) {
      if (err instanceof ExchangeError && (err.code === "-4046" || err.code === "-4067")) {
        return;
      }
      throw err;
    }
  }

  async getMarginMode(symbol: string): Promise<boolean> {
    const binanceSymbol = toBinanceSymbol(symbol);
    const res = await this.signedRequest<BinancePositionRisk[]>("GET", "/fapi/v2/positionRisk", {
      symbol: binanceSymbol,
    });

    if (res.length === 0) {
      return true; // Default to cross margin if no position
    }

    return res[0].marginType === "cross";
  }

  // ── REST Queries ──────────────────────────────────────────────

  async fetchPosition(symbol: string): Promise<Position> {
    const binanceSymbol = toBinanceSymbol(symbol);
    const res = await withRetry(
      () => this.signedRequest<BinancePositionRisk[]>("GET", "/fapi/v2/positionRisk", {
        symbol: binanceSymbol,
      }),
      {},
      "fetchPosition",
    );

    if (res.length === 0) {
      return {
        symbol,
        side: "none",
        qty: 0,
        avgCost: 0,
        unrealizedPnl: 0,
        leverage: 1,
        marginType: "cross",
        ts: Date.now(),
      };
    }

    const pos = res[0];
    const positionAmt = parseFloat(pos.positionAmt);

    return {
      symbol,
      side: positionAmt > 0 ? "long" : positionAmt < 0 ? "short" : "none",
      qty: Math.abs(positionAmt),
      avgCost: parseFloat(pos.entryPrice),
      unrealizedPnl: parseFloat(pos.unRealizedProfit ?? pos.unrealizedProfit ?? "0") || 0,
      leverage: parseInt(pos.leverage, 10),
      marginType: pos.marginType === "isolated" ? "isolated" : "cross",
      ts: pos.updateTime ?? Date.now(),
    };
  }

  async fetchBalance(): Promise<Balance> {
    const res = await withRetry(
      () => this.signedRequest<BinanceAccountInfo>("GET", "/fapi/v2/account"),
      {},
      "fetchBalance",
    );

    // totalWalletBalance is more reliable in Demo mode where totalMarginBalance may be 0
    const totalEquity = parseFloat(res.totalMarginBalance) || parseFloat(res.totalWalletBalance);

    return {
      usdt: parseFloat(res.availableBalance),
      totalEquity,
      ts: Date.now(),
    };
  }

  async getAccountUid(): Promise<string> {
    // Binance 期货账户接口（/fapi/v2/account）不返回 UID；官方推荐用
    // /fapi/v2/balance 的 accountAlias（"unique account code"）作为账户唯一标识。
    const balances = await this.signedRequest<Array<{ accountAlias?: string }>>(
      'GET',
      '/fapi/v2/balance',
    );
    const alias = balances?.[0]?.accountAlias;
    if (!alias) {
      throw new ExchangeError(
        'Binance /fapi/v2/balance returned no accountAlias',
        'ACCOUNT_UID_MISSING',
        'binance',
        false,
      );
    }
    return alias;
  }

  async fetchOpenOrders(symbol: string): Promise<Order[]> {
    const binanceSymbol = toBinanceSymbol(symbol);
    const res = await withRetry(
      () => this.signedRequest<BinanceOrderResponse[]>("GET", "/fapi/v1/openOrders", {
        symbol: binanceSymbol,
      }),
      {},
      "fetchOpenOrders",
    );

    return res.map((o) => this.mapBinanceOrder(o, symbol));
  }

  async fetchMyTrades(symbol: string, sinceMs: number): Promise<OrderFill[]> {
    const binanceSymbol = symbol.replace('/', '');
    const trades = await this.signedRequest<Record<string, unknown>[]>(
      'GET',
      '/fapi/v1/userTrades',
      { symbol: binanceSymbol, startTime: sinceMs, limit: 1000 },
    );
    const fills = (trades ?? []).map(mapBinanceRestTrade);

    // userTrades 不带 clientOrderId（模拟盘实测）：条件单触发生成的订单
    // clientOrderId=clientAlgoId 但 algo 单不落库，WS 错过时止损成交既无
    // byClient 也无 byExchangeOrderId 可归属。从 allOrders 按 orderId 拼回。
    // 富化失败不阻断对账。
    if (fills.length > 0) {
      try {
        const orders = await this.signedRequest<Array<{ orderId?: number | string; clientOrderId?: string }>>(
          'GET',
          '/fapi/v1/allOrders',
          { symbol: binanceSymbol, startTime: sinceMs, limit: 1000 },
        );
        const clientIdByOrderId = new Map(
          (orders ?? [])
            .filter((o) => o.orderId != null && o.clientOrderId)
            .map((o) => [String(o.orderId), o.clientOrderId as string]),
        );
        if (clientIdByOrderId.size > 0) {
          for (const f of fills) {
            if (!f.clientOrderId) {
              const clientOrderId = clientIdByOrderId.get(f.orderId);
              if (clientOrderId) f.clientOrderId = clientOrderId;
            }
          }
        }
      } catch {
        // best-effort：allOrders 失败时返回原始成交
      }
    }
    return fills;
  }

  async fetchFundingHistory(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]> {
    const rows = await this.signedRequest<Array<Record<string, unknown>>>('GET', '/fapi/v1/income', {
      symbol: toBinanceSymbol(symbol),
      incomeType: 'FUNDING_FEE',
      startTime: sinceMs,
      ...(untilMs !== undefined ? { endTime: untilMs } : {}),
      limit: 1000,
    });
    return rows.map((row) => ({
      symbol,
      fundingTime: Number(row.time),
      amount: Number(row.income),
    }));
  }

  async getMarketInfo(symbol: string): Promise<MarketInfo> {
    const binanceSymbol = toBinanceSymbol(symbol);

    return withRetry(
      async () => {
        const res = await this.signedRequest<BinanceExchangeInfo>("GET", "/fapi/v1/exchangeInfo");

        const symInfo = res.symbols.find((s) => s.symbol === binanceSymbol && s.contractType === "PERPETUAL");

        if (!symInfo) {
          throw new ExchangeError(
            `Symbol ${symbol} not found in Binance exchange info`,
            "SYMBOL_NOT_FOUND",
            this.exchangeId,
            false,
          );
        }

        const lotSizeFilter = symInfo.filters.find((f) => f.filterType === "LOT_SIZE") as
          | { filterType: "LOT_SIZE"; minQty: string; maxQty: string; stepSize: string }
          | undefined;

        const minNotionalFilter = symInfo.filters.find((f) => f.filterType === "MIN_NOTIONAL") as
          | { filterType: "MIN_NOTIONAL"; notional: string }
          | undefined;

        const priceFilter = symInfo.filters.find((f) => f.filterType === "PRICE_FILTER") as
          | { filterType: "PRICE_FILTER"; minPrice: string; maxPrice: string; tickSize: string }
          | undefined;

        // Fetch actual commission rates
        let makerFeeRate = 0.0002;
        let takerFeeRate = 0.0005;
        try {
          const commission = await this.signedRequest<{ makerCommissionRate: string; takerCommissionRate: string }>("GET", "/fapi/v1/commissionRate", { symbol: binanceSymbol });
          makerFeeRate = parseFloat(commission.makerCommissionRate);
          takerFeeRate = parseFloat(commission.takerCommissionRate);
        } catch {
          // Use defaults if commission rate API fails
        }

        return {
          symbol,
          rawSymbol: binanceSymbol,
          minQty: lotSizeFilter ? parseFloat(lotSizeFilter.minQty) : 0,
          minNotional: minNotionalFilter ? parseFloat(minNotionalFilter.notional) : 0,
          stepSize: lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0,
          tickSize: priceFilter ? parseFloat(priceFilter.tickSize) : 0,
          contractSize: 1, // Binance uses coin units directly
          makerFeeRate,
          takerFeeRate,
        };
      },
      {},
      "getMarketInfo",
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  destroy(): void {
    this.publicWs?.disconnect();
    this.publicWs = null;
    this.userDataWs?.disconnect();
    this.userDataWs = null;
    for (const client of this.activeWsClients) {
      client.disconnect();
    }
    this.activeWsClients.clear();
  }

  // ── Reconnect Sync ────────────────────────────────────────────

  async syncStateAfterReconnect(symbol: string): Promise<SyncResult> {
    // Individual fetch operations already have their own withRetry wrapping;
    // no outer retry needed to avoid amplification.
    const openOrders = await this.fetchOpenOrders(symbol);
    const openAlgoOrders = await this.fetchAlgoOrders(symbol);
    const position = await this.fetchPosition(symbol);
    return { openOrders, openAlgoOrders, position };
  }

  // ── Response Mappers ──────────────────────────────────────────

  private mapBinanceOrder(raw: BinanceOrderResponse, symbol: string): Order {
    const statusMap: Record<string, Order["status"]> = {
      NEW: "open",
      PARTIALLY_FILLED: "partial",
      FILLED: "filled",
      CANCELED: "cancelled",
      EXPIRED: "cancelled",
      REJECTED: "cancelled",
    };

    return {
      orderId: String(raw.orderId),
      clientOrderId: raw.clientOrderId,
      symbol,
      side: raw.side.toLowerCase() as "buy" | "sell",
      type: raw.type.toLowerCase(),
      qty: parseFloat(raw.origQty),
      price: raw.price ? parseFloat(raw.price) : undefined,
      status: statusMap[raw.status] ?? "open",
      filledQty: parseFloat(raw.executedQty),
      avgPrice: raw.avgPrice ? parseFloat(raw.avgPrice) : undefined,
      ts: raw.updateTime,
    };
  }

  private mapBinanceAlgoOrder(
    raw: BinanceAlgoOrderResponse,
    symbol: string,
    triggerCondition: "price_below" | "price_above"
  ): AlgoOrder {
    const statusMap: Record<string, AlgoOrder["status"]> = {
      NEW: "open",
      WORKING: "open",
      EXPIRED: "cancelled",
      CANCELLED: "cancelled",
      FILLED: "triggered",
      TRIGGERED: "triggered",
    };

    return {
      algoOrderId: String(raw.algoId),
      clientAlgoId: raw.clientAlgoId,
      symbol,
      side: raw.side.toLowerCase() as "buy" | "sell",
      triggerPrice: parseFloat(raw.triggerPrice),
      triggerCondition,
      qty: raw.origQty ? parseFloat(raw.origQty) : 0,
      closePosition: raw.closePosition ?? false,
      status: statusMap[raw.status] ?? "open",
      ts: raw.updateTime,
      // F6-link: Binance reports the executed order via actualOrderId once the conditional
      // triggers (absent/empty on still-open orders; harmless when undefined).
      derivedOrderId: (raw as { actualOrderId?: string | number }).actualOrderId
        ? String((raw as { actualOrderId?: string | number }).actualOrderId)
        : undefined,
    };
  }
}

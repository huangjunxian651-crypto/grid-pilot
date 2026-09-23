// GateioAdapter — USDT 永续合约适配器
// 使用 gate-api 官方 SDK (REST)
// WebSocket 手动实现（无官方 Node.js WS SDK）
// 按 environment 路由端点：demo(默认，测试网 GATEIO_REST_TESTNET) / live(实盘 GATEIO_REST_LIVE)

import axios, { AxiosError } from "axios";
import {
  ApiClient,
  AccountApi,
  FuturesApi,
  FuturesOrder,
  FuturesInitialOrder,
  FuturesPriceTrigger,
  FuturesPriceTriggeredOrder,
  FuturesPositionCrossMode,
} from "gate-api";
import type {
  FuturesOrder as FuturesOrderType,
  FuturesInitialOrder as FuturesInitialOrderType,
} from "gate-api";
import {
  IExchangeAdapter,
  ExchangeError,
  ErrorCategory,
  Ticker,
  OrderFill,
  FundingFeeRecord,
  AlgoTrigger,
  Position,
  Order,
  AlgoOrder,
  Balance,
  MarketInfo,
  SyncResult,
  CreateOrderParams,
  CreateAlgoOrderParams,
} from "../../interfaces/exchange-adapter.interface";
import { GATEIO_REST_TESTNET, GATEIO_WS_TESTNET, GATEIO_REST_LIVE, GATEIO_SETTLE } from "./gateio.types";
import { ExchangeEnvironment } from "@gridpilot/shared-types";
import { GateioWsClient } from "./gateio-ws-client";
import {
  toGateioSymbol,
  toGateioClientId,
  fromGateioClientId,
  deriveGateioAlgoSide,
  coinToContracts,
  contractsToCoin,
  nowMs,
} from "../utils";
import { withRetry } from "../utils/retry";

/**
 * AUTO_ORDER_NOT_FOUND：price-triggered 单不存在/已撤/已触发（testnet 实测
 * 2026-06-12）。撤单的目标状态（不再活跃）已达成，按幂等成功处理，
 * 与 OKX 51400 同款（否则 runner cancelWithRetry 空转 3 次重试）。
 */
const GATEIO_CANCEL_TARGET_ALREADY_GONE = "AUTO_ORDER_NOT_FOUND";

// ── Pure mapping: Gate REST getMyTradesWithTimeRange → OrderFill ─────────────
/**
 * Maps a MyFuturesTradeTimeRange SDK object (or plain record) to an OrderFill.
 * `contractSize` is the per-symbol quanto multiplier (e.g. 0.01 for ETH).
 * Returns null when size is 0 (defensive guard).
 */
export function mapGateRestTrade(t: Record<string, unknown>, contractSize: number): OrderFill | null {
  const size = parseFloat(t.size as string);
  if (!size || size === 0) return null;
  return {
    orderId: String(t.orderId ?? ''),
    clientOrderId: t.text ? fromGateioClientId(t.text as string) : undefined,
    tradeId: t.tradeId != null ? String(t.tradeId) : undefined,
    symbol: (t.contract as string).replace('_', '/'),
    side: size >= 0 ? 'buy' : 'sell',
    filledQty: contractsToCoin(Math.abs(size), contractSize),
    avgPrice: parseFloat(t.price as string),
    fee: t.fee != null ? Math.abs(parseFloat(t.fee as string)) : undefined,
    feeAsset: 'USDT',
    status: 'filled',
    ts: t.createTime != null ? Number(t.createTime) * 1000 : Date.now(),
  };
}

// ── Pure mapping: Gate futures.book_ticker → Ticker ─────────────────────────
/** book_ticker 频道的订阅确认/心跳帧没有 b/a 字段，旧逻辑 `parseFloat(x ?? "0")`
 * 会映射成 0 价 Ticker——FSM 把 price=0 当真实价直接误清算 LONG（2026-06-12
 * 实测激活死循环）。无效帧返回 null 由调用方丢弃。 */
export function mapGateioBookTickerFrame(symbol: string, result: Record<string, string>): Ticker | null {
  const bestBid = parseFloat(result.b);
  const bestAsk = parseFloat(result.a);
  if (!Number.isFinite(bestBid) || bestBid <= 0 || !Number.isFinite(bestAsk) || bestAsk <= 0) {
    return null;
  }
  return {
    symbol,
    bestBid,
    bestAsk,
    lastPrice: bestAsk,
    ts: Date.now(),
  };
}

// ── Pure mapping: Gate futures account_book (type=fund) → FundingFeeRecord ───
/**
 * Gate account_book 的 time 字段为秒（UNIX epoch）。
 * fundingTime 转换为毫秒（×1000）。
 * symbol 直接使用调用方传入的规范格式（如 'ETH/USDT'）。
 */
export function mapGateAccountBookEntry(
  symbol: string,
  entry: { time: number | string; change: number | string },
): FundingFeeRecord {
  return {
    symbol,
    fundingTime: Number(entry.time) * 1000,
    amount: Number(entry.change),
  };
}

// ── Pure mapping: Gate futures.usertrades → OrderFill ────────────────────────
export function mapGateUserTrade(raw: Record<string, unknown>, contractSize: number): OrderFill | null {
  const size = parseFloat(raw.size as string);
  if (!size || size === 0) return null;
  const price = parseFloat(raw.price as string);
  if (!price || price === 0) return null;
  return {
    orderId: String(raw.order_id ?? ""),
    clientOrderId: raw.text ? fromGateioClientId(raw.text as string) : undefined,
    tradeId: raw.id != null ? String(raw.id) : undefined,
    symbol: (raw.contract as string).replace("_", "/"),
    side: size >= 0 ? "buy" : "sell",
    filledQty: contractsToCoin(Math.abs(size), contractSize),
    avgPrice: price,
    fee: raw.fee != null ? Math.abs(parseFloat(raw.fee as string)) : undefined,
    feeAsset: "USDT",
    status: "filled",
    ts: raw.create_time_ms != null ? Number(raw.create_time_ms) : Date.now(),
  };
}

export class GateioAdapter implements IExchangeAdapter {
  readonly exchangeId = "gateio" as const;
  readonly accountId: string;

  private client: FuturesApi;
  private accountApi: AccountApi;
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private environment: ExchangeEnvironment;
  // Unsigned HTTP client for public market endpoints (REST ticker fallback)
  private http = axios.create({ timeout: 30000 });

  // algoId -> clientAlgoId mapping (in-memory, lazily restored after reconnect)
  private algoIdToClientAlgoId = new Map<string, string>();
  // Cache contract sizes to avoid repeated API calls
  private contractSizes = new Map<string, number>();

  // Track per-generator WS clients so destroy() can clean them up
  private activeWsClients = new Set<GateioWsClient>();

  constructor(credentials: { apiKey: string; apiSecret: string; accountId?: string; environment?: ExchangeEnvironment }) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.accountId = credentials.accountId ?? "gateio-account";
    this.environment = credentials.environment ?? "demo";
    this.baseUrl = this.environment === "live" ? GATEIO_REST_LIVE : GATEIO_REST_TESTNET;

    // The SDK uses the process-wide axios instance by default and has no request
    // timeout. One stalled Gate request then keeps the signed request queue alive
    // long enough for later timestamps to expire. Keep this adapter's REST client
    // bounded so retry creates a fresh signature instead of piling up forever.
    const apiHttp = axios.create({ timeout: 15_000 });
    const apiClient = new ApiClient(undefined, apiHttp);
    apiClient.setApiKeySecret(this.apiKey, this.apiSecret);
    (apiClient as any).basePath = this.baseUrl;
    this.client = new FuturesApi(apiClient);
    this.accountApi = new AccountApi(apiClient);
  }

  // ── REST Ticker (cold-start fallback when WS is unavailable) ──
  // GET /futures/usdt/tickers?contract=ETH_USDT — public, no signature.
  // Returns an array; take the first entry. Survives WS 502 outages.

  async getTicker(symbol: string): Promise<Ticker> {
    const rawSymbol = toGateioSymbol(symbol);
    const url = `${this.baseUrl}/futures/${GATEIO_SETTLE}/tickers`;

    try {
      const { data } = await this.http.get<
        Array<{ contract?: string; last?: string; highest_bid?: string; lowest_ask?: string }>
      >(url, { params: { contract: rawSymbol } });

      const raw = Array.isArray(data) ? data[0] : undefined;
      if (!raw) {
        throw new ExchangeError(
          `Gate.io getTicker: no ticker data for ${rawSymbol}`,
          "NO_TICKER",
          this.exchangeId,
          true,
        );
      }

      const lastPrice = parseFloat(raw.last ?? "");
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
        throw new ExchangeError(
          `Gate.io getTicker: invalid last price for ${rawSymbol}: ${raw.last}`,
          "NO_TICKER",
          this.exchangeId,
          true,
        );
      }
      return {
        symbol,
        bestBid: parseFloat(raw.highest_bid ?? "0"),
        bestAsk: parseFloat(raw.lowest_ask ?? "0"),
        lastPrice,
        ts: nowMs(),
      };
    } catch (err) {
      if (err instanceof ExchangeError) throw err;
      if (axios.isAxiosError(err)) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;
        const retryable = !status || status === 429 || status >= 500;
        throw new ExchangeError(
          `Gate.io getTicker error: ${axiosErr.message}`,
          status === 429 ? "RATE_LIMIT" : status && status >= 500 ? "SERVER_ERROR" : "NETWORK_ERROR",
          this.exchangeId,
          retryable,
        );
      }
      throw new ExchangeError(
        `Gate.io getTicker unexpected error: ${(err as Error)?.message ?? String(err)}`,
        "UNKNOWN_ERROR",
        this.exchangeId,
        false,
      );
    }
  }

  // ── WebSocket Streams ─────────────────────────────────────────

  async *watchTicker(symbol: string): AsyncIterableIterator<Ticker> {
    const client = new GateioWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, this.environment);
    this.activeWsClients.add(client);
    const STREAM_TIMEOUT_MS = 30000;
    try {
      await client.connect();

      const rawSymbol = toGateioSymbol(symbol);
      client.subscribe("futures.book_ticker", [rawSymbol]);

      const queue: Ticker[] = [];
      let resolveNext: (() => void) | null = null;
      let lastTickAt = Date.now();

      const onData = (msg: { channel: string; result: unknown }) => {
        if (msg.channel !== "futures.book_ticker") return;
        lastTickAt = Date.now();
        const ticker = mapGateioBookTickerFrame(symbol, msg.result as Record<string, string>);
        if (!ticker) return; // 订阅确认/心跳帧，丢弃
        queue.push(ticker);
        resolveNext?.();
      };

      client.on("data", onData);

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
              timer = setTimeout(() => resolve(), STREAM_TIMEOUT_MS);
              if (queue.length > 0) {
                if (timer) clearTimeout(timer);
                resolve();
              }
            });

            if (queue.length === 0 && Date.now() - lastTickAt >= STREAM_TIMEOUT_MS) {
              throw new ExchangeError(
                `Gate.io ticker stream stalled for ${symbol}`,
                "WS_STALLED",
                this.exchangeId,
                true,
              );
            }
          }
        }
      } finally {
        client.off("data", onData);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchOrderFills(_symbol: string): AsyncIterableIterator<OrderFill> {
    const client = new GateioWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();
      await client.authenticate();

      client.subscribe("futures.usertrades");

      // onData 必须同步：只把原始消息按到达顺序入队，不在回调里 await。
      // 否则 async 回调 + await getContractSize 会让多条消息并发挂起、按 resolve 时机
      // 乱序入队。contractSize 的解析（可能含 REST 拉取）移到下方单一消费循环里按序进行。
      const rawQueue: Record<string, unknown>[] = [];
      let resolveNext: (() => void) | null = null;

      const onData = (msg: { channel: string; result: unknown }) => {
        if (msg.channel !== "futures.usertrades") return;
        rawQueue.push(msg.result as Record<string, unknown>);
        resolveNext?.();
      };

      client.on("data", onData);

      try {
        while (true) {
          if (rawQueue.length > 0) {
            const raw = rawQueue.shift()!;
            const symbol = (raw.contract as string).replace("_", "/");
            let contractSize = 1;
            try { contractSize = await this.getContractSize(symbol); } catch { contractSize = 1; }
            const f = mapGateUserTrade(raw, contractSize);
            if (f) yield f;
          } else {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
              if (rawQueue.length > 0) resolve();
            });
          }
        }
      } finally {
        client.off("data", onData);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchAlgoTriggers(_symbol: string): AsyncIterableIterator<AlgoTrigger> {
    const client = new GateioWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();
      await client.authenticate();

      client.subscribe("futures.autoorders");

      const queue: AlgoTrigger[] = [];
      let resolveNext: (() => void) | null = null;

      const onData = (msg: { channel: string; result: unknown }) => {
        if (msg.channel !== "futures.autoorders") return;
        const order = msg.result as Record<string, unknown>;
        if ((order.status as string) !== "finished") return;

        const initial = order.initial as Record<string, unknown>;
        queue.push({
          algoOrderId: String(order.id ?? ""),
          clientAlgoId: initial?.text ? fromGateioClientId(initial.text as string) : "",
          symbol: (initial?.contract as string)?.replace("_", "/") ?? "",
          side: (initial?.size as number) >= 0 ? "buy" : "sell",
          triggerPrice: parseFloat((order.trigger as Record<string, string>)?.price ?? "0"),
          filledQty: Math.abs(parseFloat(initial?.size as string)),
          ts: Date.now(),
        });
        resolveNext?.();
      };

      client.on("data", onData);

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
        client.off("data", onData);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  async *watchPositions(symbol: string): AsyncIterableIterator<Position> {
    const client = new GateioWsClient({ apiKey: this.apiKey, apiSecret: this.apiSecret }, this.environment);
    this.activeWsClients.add(client);
    try {
      await client.connect();
      await client.authenticate();

      const rawSymbol = toGateioSymbol(symbol);
      client.subscribe("futures.positions", [rawSymbol]);

      const contractSize = await this.getContractSize(symbol);
      const queue: Position[] = [];
      let resolveNext: (() => void) | null = null;

      const onData = (msg: { channel: string; result: unknown }) => {
        if (msg.channel !== "futures.positions") return;
        const pos = msg.result as Record<string, unknown>;
        if ((pos.contract as string) !== rawSymbol) return;

        const size = parseFloat(pos.size as string);
        queue.push({
          symbol,
          side: size > 0 ? "long" : size < 0 ? "short" : "none",
          qty: contractsToCoin(Math.abs(size), contractSize),
          avgCost: parseFloat(pos.entry_price as string) || 0,
          unrealizedPnl: parseFloat(pos.unrealised_pnl as string) || 0,
          leverage: parseInt(pos.leverage as string) || 1,
          ts: Date.now(),
        });
        resolveNext?.();
      };

      client.on("data", onData);

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
        client.off("data", onData);
      }
    } finally {
      client.disconnect();
      this.activeWsClients.delete(client);
    }
  }

  // ── Orders ────────────────────────────────────────────────────

  async createOrder(params: CreateOrderParams): Promise<Order> {
    const rawSymbol = toGateioSymbol(params.symbol);
    const contractSize = await this.getContractSize(params.symbol);

    const orderSize = coinToContracts(params.qty, contractSize);

    // Build the order
    const order = new FuturesOrder();
    order.contract = rawSymbol;
    order.size = String(params.side === "buy" ? orderSize : -orderSize);
    order.price = String(params.price ?? 0);
    order.tif = (params.type === "post_only"
      ? FuturesOrder.Tif.Poc
      : FuturesOrder.Tif.Gtc) as FuturesOrderType.Tif;
    order.reduceOnly = params.reduceOnly ?? false;

    if (params.clientOrderId) {
      const text = toGateioClientId(params.clientOrderId);
      if (text.length > 30) {
        throw new ExchangeError(
          `Gate.io clientOrderId text too long: "${text}" (${text.length} > 30)`,
          "CLIENT_ID_TOO_LONG",
          this.exchangeId,
          false,
        );
      }
      order.text = text;
    }

    const res = await this.wrapSdkCall(
      () => this.client.createFuturesOrder(GATEIO_SETTLE, order),
      "createFuturesOrder",
    );

    // POC(post-only) 立即成交时 Gate 有两种拒单形态：①HTTP 400 label=ORDER_POC_IMMEDIATE
    // （由 wrapSdkCall 抛出并分类）；②HTTP 200 + finish_as=poc 的静默撤单。post-only 不可能
    // 吃单成交，finish_as=poc 必然零成交=已死单。两条路径统一抛 POST_ONLY_REJECT，让上层
    // 走 pocRetryLoop/降级 GTC；否则该单会被映射成 partial→PLACED，runner 误登记幽灵挂单。
    if (String(res.body?.finishAs ?? "").toLowerCase() === "poc") {
      throw new ExchangeError(
        `Gate.io API error during createFuturesOrder: ORDER_POC_IMMEDIATE (finish_as=poc)`,
        "ORDER_POC_IMMEDIATE",
        this.exchangeId,
        false,
        ErrorCategory.POST_ONLY_REJECT,
      );
    }

    return this.mapFuturesOrderToOrder(res.body, params.symbol, contractSize);
  }

  async cancelOrder(orderId: string, _symbol: string): Promise<void> {
    await withRetry(
      () => this.wrapSdkCall(
        () => this.client.cancelFuturesOrder(GATEIO_SETTLE, orderId),
        "cancelFuturesOrder",
      ),
      {},
      "cancelOrder",
    );
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const rawSymbol = toGateioSymbol(symbol);
    await withRetry(
      () => this.wrapSdkCall(
        () => this.client.cancelFuturesOrders(GATEIO_SETTLE, { contract: rawSymbol }),
        "cancelFuturesOrders",
      ),
      {},
      "cancelAllOrders",
    );
  }

  async closePosition(symbol: string, side: "long" | "short"): Promise<Order> {
    const rawSymbol = toGateioSymbol(symbol);
    const contractSize = await this.getContractSize(symbol);

    const order = new FuturesOrder();
    order.contract = rawSymbol;
    order.size = "0";
    order.close = true;
    order.tif = FuturesOrder.Tif.Ioc as FuturesOrderType.Tif;
    order.price = "0";

    const res = await this.wrapSdkCall(
      () => this.client.createFuturesOrder(GATEIO_SETTLE, order),
      "createFuturesOrder",
    );
    return this.mapFuturesOrderToOrder(res.body, symbol, contractSize);
  }

  // ── Algo Orders ───────────────────────────────────────────────

  async createAlgoOrder(params: CreateAlgoOrderParams): Promise<AlgoOrder> {
    const rawSymbol = toGateioSymbol(params.symbol);
    const contractSize = await this.getContractSize(params.symbol);

    // Build initial order
    const initial = new FuturesInitialOrder();
    initial.contract = rawSymbol;
    initial.price = "0";
    initial.tif = FuturesInitialOrder.Tif.Ioc as FuturesInitialOrderType.Tif;
    const text = toGateioClientId(params.clientAlgoId);
    if (text.length > 30) {
      throw new ExchangeError(
        `Gate.io clientAlgoId text too long: "${text}" (${text.length} > 30)`,
        "CLIENT_ID_TOO_LONG",
        this.exchangeId,
        false,
      );
    }
    initial.text = text;

    if (params.closePosition) {
      initial.size = 0;
      initial.close = true;
    } else {
      const orderSize = coinToContracts(params.qty, contractSize);
      initial.size = params.side === "buy" ? orderSize : -orderSize;
    }

    // Build trigger
    const trigger = new FuturesPriceTrigger();
    trigger.price = String(params.triggerPrice);
    // rule: 1 = >= (price_above), 2 = <= (price_below)
    trigger.rule = params.triggerCondition === "price_above" ? 1 : 2;

    // Build price triggered order
    const priceTriggeredOrder = new FuturesPriceTriggeredOrder();
    priceTriggeredOrder.initial = initial;
    priceTriggeredOrder.trigger = trigger;

    const res = await this.wrapSdkCall(
      () => this.client.createPriceTriggeredOrder(GATEIO_SETTLE, priceTriggeredOrder),
      "createPriceTriggeredOrder",
    );

    // Cache algoId -> clientAlgoId mapping
    const algoId = String(res.body.id ?? res.body.idString ?? "");
    if (algoId) {
      this.algoIdToClientAlgoId.set(algoId, params.clientAlgoId);
    }

    return {
      algoOrderId: algoId,
      clientAlgoId: params.clientAlgoId,
      symbol: params.symbol,
      side: params.side,
      triggerPrice: params.triggerPrice,
      triggerCondition: params.triggerCondition,
      qty: params.qty,
      closePosition: params.closePosition ?? false,
      status: "open",
      ts: nowMs(),
    };
  }

  async cancelAlgoOrder(algoOrderId: string, _symbol: string): Promise<void> {
    // Gate.io algo IDs can exceed Number.MAX_SAFE_INTEGER.
    // The SDK types orderId as number, but the HTTP API accepts it as a string path param.
    // BigInt preserves all digits at runtime; the SDK's HTTP client stringifies it for the URL.
    // The cast bypasses TypeScript only — the runtime value remains a BigInt.
    const algoId = BigInt(algoOrderId);
    try {
      await withRetry(
        () => this.wrapSdkCall(
          () => this.client.cancelPriceTriggeredOrder(GATEIO_SETTLE, algoId as unknown as number),
          "cancelPriceTriggeredOrder",
        ),
        {},
        "cancelAlgoOrder",
      );
    } catch (err) {
      if (!(err instanceof ExchangeError) || err.code !== GATEIO_CANCEL_TARGET_ALREADY_GONE) {
        throw err;
      }
    }
    this.algoIdToClientAlgoId.delete(algoOrderId);
  }

  async cancelAllAlgoOrders(symbol: string): Promise<void> {
    const rawSymbol = toGateioSymbol(symbol);
    await withRetry(
      () => this.wrapSdkCall(
        () => this.client.cancelPriceTriggeredOrderList(GATEIO_SETTLE, { contract: rawSymbol }),
        "cancelPriceTriggeredOrderList",
      ),
      {},
      "cancelAllAlgoOrders",
    );
    // Clear all cached algo IDs for this symbol
    // We don't know which ones belong to this symbol, so we clear all
    // In practice, a bot only trades one symbol at a time per adapter instance
    this.algoIdToClientAlgoId.clear();
  }

  async fetchAlgoOrders(symbol: string): Promise<AlgoOrder[]> {
    const rawSymbol = toGateioSymbol(symbol);
    const contractSize = await this.getContractSize(symbol);

    const res = await withRetry(
      () => this.wrapSdkCall(
        () => this.client.listPriceTriggeredOrders(GATEIO_SETTLE, "open", {
          contract: rawSymbol,
        }),
        "listPriceTriggeredOrders",
      ),
      {},
      "fetchAlgoOrders",
    );

    const orders: AlgoOrder[] = [];

    for (const raw of res.body) {
      const algoId = String(raw.id ?? raw.idString ?? "");
      const clientAlgoId = raw.initial?.text
        ? fromGateioClientId(raw.initial.text)
        : undefined;

      if (algoId && clientAlgoId) {
        this.algoIdToClientAlgoId.set(algoId, clientAlgoId);
      }

      const side: "buy" | "sell" = deriveGateioAlgoSide(
        Number(raw.initial?.size ?? 0),
        raw.initial?.close ?? false,
        Number(raw.trigger?.rule ?? 1),
      );
      const triggerCondition: "price_below" | "price_above" =
        raw.trigger?.rule === 2 ? "price_below" : "price_above";
      const qty = raw.initial?.size
        ? contractsToCoin(Math.abs(Number(raw.initial.size)), contractSize)
        : 0;

      orders.push({
        algoOrderId: algoId,
        clientAlgoId,
        symbol,
        side,
        triggerPrice: Number(raw.trigger?.price ?? 0),
        triggerCondition,
        qty,
        closePosition: raw.initial?.close ?? false,
        status: this.mapAlgoStatus(String(raw.status ?? "")),
        ts: (raw.createTime ?? nowMs()) * 1000,
        // F6-link: Gate links the executed order via me_order_id once the price order fires
        // (absent on still-open orders; harmless when undefined).
        derivedOrderId: (raw as { meOrderId?: number | string }).meOrderId != null
          ? String((raw as { meOrderId?: number | string }).meOrderId)
          : undefined,
      });
    }

    return orders;
  }

  isImmediateTriggerError(err: Error): boolean {
    const msg = err.message ?? "";
    return (
      msg.includes("AUTO_TRIGGER_PRICE_GREATE_MARK") ||
      msg.includes("AUTO_TRIGGER_PRICE_LESS_MARK")
    );
  }

  // ── Account Initialization ────────────────────────────────────

  async setPositionMode(oneWay: boolean): Promise<void> {
    // Check current mode first to avoid API errors when already in target mode
    const current = await this.getPositionMode();
    if (current === oneWay) return;

    try {
      await this.client.setPositionMode(GATEIO_SETTLE, oneWay ? "single" : "dual");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Ignore "already in this mode" errors (various casing from API)
      if (msg.toLowerCase().includes("already in this mode")) {
        return;
      }
      throw err;
    }
  }

  async getPositionMode(): Promise<boolean> {
    const res = await this.wrapSdkCall(
      () => this.client.listFuturesAccounts(GATEIO_SETTLE),
      "listFuturesAccounts",
    );
    // position_mode: "single" = one-way, "dual" = hedge mode
    return res.body.positionMode === "single" || res.body.positionMode === "Single";
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const rawSymbol = toGateioSymbol(symbol);
    await this.wrapSdkCall(
      () => this.client.updatePositionLeverage(GATEIO_SETTLE, rawSymbol, String(leverage)),
      "updatePositionLeverage",
    );
  }

  async setMarginMode(symbol: string, crossMargin: boolean): Promise<void> {
    // Check current mode first to avoid API errors when already in target mode
    const current = await this.getMarginMode(symbol);
    if (current === crossMargin) return;

    const rawSymbol = toGateioSymbol(symbol);
    const crossMode = new FuturesPositionCrossMode();
    // Gate.io API requires UPPERCASE mode values
    crossMode.mode = crossMargin ? "CROSS" : "ISOLATED";
    crossMode.contract = rawSymbol;
    await this.wrapSdkCall(
      () => this.client.updatePositionCrossMode(GATEIO_SETTLE, crossMode),
      "updatePositionCrossMode",
    );
  }

  async getMarginMode(symbol: string): Promise<boolean> {
    const rawSymbol = toGateioSymbol(symbol);
    const res = await this.wrapSdkCall(
      () => this.client.getPosition(GATEIO_SETTLE, rawSymbol),
      "getPosition",
    );
    // posMarginMode: "cross" / "Cross" / "CROSS" = cross margin
    const mode = String(res.body.posMarginMode ?? "").toLowerCase();
    return mode === "cross";
  }

  // ── REST Queries ──────────────────────────────────────────────

  async fetchPosition(symbol: string): Promise<Position> {
    const rawSymbol = toGateioSymbol(symbol);
    const contractSize = await this.getContractSize(symbol);

    try {
      const res = await withRetry(
        () => this.wrapSdkCall(
          () => this.client.getPosition(GATEIO_SETTLE, rawSymbol),
          "getPosition",
        ),
        {},
        "fetchPosition",
      );
      return this.mapGateioPositionToPosition(res.body, symbol, contractSize);
    } catch (err) {
      // Gate's single-position endpoint returns POSITION_NOT_FOUND when the account
      // has no open position for this contract. Treat that normal cold-start state as 0.
      if (err instanceof ExchangeError && err.code === "POSITION_NOT_FOUND") {
        return this.mapGateioPositionToPosition({}, symbol, contractSize);
      }
      throw err;
    }
  }

  async fetchBalance(): Promise<Balance> {
    const res = await withRetry(
      () => this.wrapSdkCall(
        () => this.client.listFuturesAccounts(GATEIO_SETTLE),
        "listFuturesAccounts",
      ),
      {},
      "fetchBalance",
    );
    return {
      usdt: Number(res.body.available ?? 0),
      // Gate 的 total 不含未实现盈亏；权益口径须与 Binance(totalMarginBalance)/
      // OKX 对齐，否则持仓期间权益恒定（2026-06-13 实测）
      totalEquity: Number(res.body.total ?? 0) + Number(res.body.unrealisedPnl ?? 0),
      ts: nowMs(),
    };
  }

  async fetchOpenOrders(symbol: string): Promise<Order[]> {
    const rawSymbol = toGateioSymbol(symbol);
    const contractSize = await this.getContractSize(symbol);

    const res = await withRetry(
      () => this.wrapSdkCall(
        () => this.client.listFuturesOrders(GATEIO_SETTLE, "open", {
          contract: rawSymbol,
        }),
        "listFuturesOrders",
      ),
      {},
      "fetchOpenOrders",
    );

    return res.body.map((raw) => this.mapFuturesOrderToOrder(raw, symbol, contractSize));
  }

  async fetchMyTrades(symbol: string, sinceMs: number): Promise<OrderFill[]> {
    const contract = toGateioSymbol(symbol);
    let contractSize = 1;
    const res = await withRetry(
      async () => {
        // Keep contract-size lookup inside the retry so a transient REST failure
        // cannot silently convert fills with the wrong unit.
        contractSize = await this.getContractSize(symbol);
        return this.wrapSdkCall(
          () => this.client.getMyTradesWithTimeRange(GATEIO_SETTLE, {
            contract,
            from: sinceMs ? Math.floor(sinceMs / 1000) : undefined,
          }),
          'getMyTradesWithTimeRange',
        );
      },
      {},
      'fetchMyTrades',
    );
    const rows = (res.body ?? []) as unknown as Record<string, unknown>[];
    return rows.map((t) => mapGateRestTrade(t, contractSize)).filter((f): f is OrderFill => f !== null);
  }

  async fetchFundingHistory(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]> {
    const rawSymbol = toGateioSymbol(symbol);
    const opts: { type: string; from?: number; to?: number; limit?: number; contract?: string } = {
      type: 'fund',
      contract: rawSymbol,
      limit: 100,
      from: sinceMs ? Math.floor(sinceMs / 1000) : undefined,
    };
    if (untilMs !== undefined) {
      opts.to = Math.floor(untilMs / 1000);
    }

    const res = await this.wrapSdkCall(
      () => this.client.listFuturesAccountBook(GATEIO_SETTLE, opts),
      'listFuturesAccountBook',
    );

    return (res.body as Array<{ time: number; change: string; contract: string }>)
      .filter((entry) => entry.contract === rawSymbol)
      .map((entry) => mapGateAccountBookEntry(symbol, entry));
  }

  async getMarketInfo(symbol: string): Promise<MarketInfo> {
    const rawSymbol = toGateioSymbol(symbol);
    const res = await withRetry(
      () => this.wrapSdkCall(
        () => this.client.getFuturesContract(GATEIO_SETTLE, rawSymbol),
        "getFuturesContract",
      ),
      {},
      "getMarketInfo",
    );
    const c = res.body;

    const contractSize = Number(c.quantoMultiplier ?? "0.001");
    const orderSizeMin = Number(c.orderSizeMin ?? "1");
    const orderPriceRound = Number(c.orderPriceRound ?? "0.1");

    return {
      symbol,
      rawSymbol,
      minQty: contractsToCoin(orderSizeMin, contractSize),
      minNotional: 0, // Gate.io 合约按张数计价，不单独暴露 USDT 名义价值门槛；真实下限由 minQty 承担
      stepSize: contractsToCoin(1, contractSize), // 1 contract step
      tickSize: orderPriceRound,
      contractSize,
      makerFeeRate: Number(c.makerFeeRate ?? "0.0002"),
      takerFeeRate: Number(c.takerFeeRate ?? "0.0005"),
    };
  }

  async getAccountUid(): Promise<string> {
    const res = await this.accountApi.getAccountDetail();
    const userId = (res.body as { userId?: number | string }).userId;
    if (userId === undefined || userId === null || `${userId}` === '') {
      throw new ExchangeError(
        'Gate.io getAccountDetail returned no userId',
        'ACCOUNT_UID_MISSING',
        'gateio',
        false,
      );
    }
    return `${userId}`;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  destroy(): void {
    this.algoIdToClientAlgoId.clear();
    this.contractSizes.clear();
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

    return {
      openOrders,
      openAlgoOrders,
      position,
    };
  }

  // ── Private Helpers ───────────────────────────────────────────

  private mapFuturesOrderToOrder(raw: any, symbol: string, contractSize: number): Order {
    const size = Number(raw.size ?? 0);
    const side: "buy" | "sell" = size >= 0 ? "buy" : "sell";
    const qty = contractsToCoin(Math.abs(size), contractSize);
    const left = Math.abs(Number(raw.left ?? raw.size ?? 0));
    const filledQty = contractsToCoin(Math.abs(size) - left, contractSize);

    return {
      orderId: String(raw.id ?? ""),
      clientOrderId: raw.text ? fromGateioClientId(raw.text) : undefined,
      symbol,
      side,
      type: this.mapOrderType(raw.tif),
      qty,
      price: raw.price ? Number(raw.price) : undefined,
      status: this.mapOrderStatus(raw.status, raw.finishAs, left, Math.abs(size)),
      filledQty,
      avgPrice: raw.fillPrice ? Number(raw.fillPrice) : undefined,
      ts: (raw.createTime ?? nowMs()) * 1000,
    };
  }

  private mapOrderType(tif?: string): string {
    switch (tif?.toLowerCase()) {
      case "poc":
        return "post_only";
      case "ioc":
        return "market"; // IOC is typically used for market-like execution
      default:
        return "limit";
    }
  }

  private mapOrderStatus(
    status?: string,
    finishAs?: string,
    left?: number,
    origSize?: number,
  ): "open" | "filled" | "partial" | "cancelled" {
    if (status?.toLowerCase() === "open") {
      // If left equals original size, order hasn't been filled at all
      if (left === origSize) return "open";
      // If some has been filled but not all, it's partial
      if (left && left > 0 && left < (origSize ?? Number.MAX_SAFE_INTEGER)) return "partial";
      return "open";
    }
    if (finishAs?.toLowerCase() === "filled") return "filled";
    if (finishAs?.toLowerCase() === "cancelled") return "cancelled";
    if (finishAs?.toLowerCase() === "ioc") return left === 0 ? "filled" : "cancelled";
    // post-only 立即成交被动撤单：零成交的已死单，绝非 partial（否则对账/同步误判为活动挂单）。
    if (finishAs?.toLowerCase() === "poc") return "cancelled";
    if (left && left > 0) return "partial";
    return "filled";
  }

  private mapAlgoStatus(status?: string): "open" | "triggered" | "cancelled" {
    switch (status?.toLowerCase()) {
      case "open":
        return "open";
      case "finished":
        return "triggered";
      case "inactive":
      case "invalid":
        return "cancelled";
      default:
        return "open";
    }
  }

  private async wrapSdkCall<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      // Gate.io REST 400/4xx 走 axios，err.message 只有通用的
      // "Request failed with status code 400"，真正的拒单原因在响应体
      // err.response.data = { label, detail/message }。务必把它捞进 message，
      // 否则上层日志与前端只会看到通用文案，无从调试。
      const body = err?.response?.data;
      const label = body?.label;
      const detail = body?.detail ?? body?.message;
      const status = err?.response?.status;
      const baseMsg = err?.message ?? String(err);
      const msg = label
        ? `${label}${detail ? `: ${detail}` : ""}${status ? ` (HTTP ${status})` : ""}`
        : baseMsg;
      const errCode = label ?? err?.code ?? "API_ERROR";

      // Network-level errors are always retryable
      const isNetworkError =
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("ENOTFOUND") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ECONNABORTED") ||
        msg.includes("EPIPE") ||
        msg.includes("EAI_AGAIN") ||
        msg.includes("socket hang up") ||
        msg.includes("Client network socket disconnected") ||
        msg.includes("secure TLS connection") ||
        msg.includes("Network Error") ||
        msg.includes("timeout") ||
        msg.includes("Timeout");
      if (isNetworkError) {
        throw new ExchangeError(
          `Gate.io network error during ${operation}: ${msg}`,
          "NETWORK_ERROR",
          this.exchangeId,
          true,
        );
      }

      // Map Gate.io error labels to retryable status
      const retryableLabels = [
        "RATE_LIMIT",
        "SERVER_ERROR",
        "SERVICE_UNAVAILABLE",
        "GATEWAY_TIMEOUT",
      ];
      const isRetryable = retryableLabels.some((label) => msg.includes(label) || errCode === label);

      // POC(post-only) 立即成交被拒：优先按 Gate.io 错误 label 判定（与 OKX 51420 / Binance -5022
      // 的按码分类一致、最稳），正则仅作兜底。真实 label 为 ORDER_POC_IMMEDIATE，
      // detail 形如 "order price X while counter price Y"，不含 "post only"/"match"。
      const isPocReject =
        errCode === "ORDER_POC_IMMEDIATE" ||
        /poc[\s_-]?immediate/i.test(msg) ||
        /post[\s_-]?only/i.test(msg) ||
        (/poc/i.test(msg) && /match/i.test(msg));

      throw new ExchangeError(
        `Gate.io API error during ${operation}: ${msg}`,
        String(errCode),
        this.exchangeId,
        isRetryable,
        isPocReject ? ErrorCategory.POST_ONLY_REJECT : undefined,
      );
    }
  }

  private async getContractSize(symbol: string): Promise<number> {
    const rawSymbol = toGateioSymbol(symbol);
    if (this.contractSizes.has(rawSymbol)) {
      return this.contractSizes.get(rawSymbol)!;
    }
    const contractInfo = await this.wrapSdkCall(
      () => this.client.getFuturesContract(GATEIO_SETTLE, rawSymbol),
      "getFuturesContract",
    );
    const size = Number(contractInfo.body.quantoMultiplier ?? "0.001");
    this.contractSizes.set(rawSymbol, size);
    return size;
  }

  private mapGateioPositionToPosition(
    raw: any,
    symbol: string,
    contractSize: number,
  ): Position {
    const size = Number(raw.size ?? 0);
    let side: "long" | "short" | "none" = "none";
    let qty = 0;

    if (size > 0) {
      side = "long";
      qty = contractsToCoin(size, contractSize);
    } else if (size < 0) {
      side = "short";
      qty = contractsToCoin(Math.abs(size), contractSize);
    }

    return {
      symbol,
      side,
      qty,
      avgCost: Number(raw.entryPrice ?? 0),
      unrealizedPnl: Number(raw.unrealisedPnl ?? 0),
      leverage: Number(raw.leverage ?? 1),
      marginType: "cross",
      ts: (raw.updateTime ?? nowMs()) * 1000,
    };
  }
}

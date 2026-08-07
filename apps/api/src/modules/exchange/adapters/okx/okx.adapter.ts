// OkxAdapter — 永续合约适配器
// 使用 axios 直接对接 OKX v5 API（无官方 Node.js SDK）
// 对接 OKX Demo 环境

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
import {
  OKX_INST_TYPE,
  OKX_SYMBOL,
  OKX_ALGO_ORD_TYPE,
  OkxCredentials,
  OkxTicker,
  OkxOrder,
  OkxAlgoOrder,
  OkxPosition,
  OkxBalance,
  OkxInstrument,
} from "./okx.types";
import { Logger } from "@nestjs/common";
import { OkxRestClient } from "./okx-rest-client";
import { OkxWsClient } from "./okx-ws-client";
import { toOkxSymbol, toOkxClientId, coinToContracts, contractsToCoin , okxSanitizeClientId } from "../utils";
import { OKX_WS_PUBLIC, OKX_WS_PRIVATE, OKX_WS_PUBLIC_LIVE, OKX_WS_PRIVATE_LIVE } from "./okx.types";
import { withRetry } from "../utils/retry";
import { ExchangeEnvironment } from "@gridpilot/shared-types";

/** OKX error codes that are safe to retry (transient server/rate issues) */
const OKX_RETRYABLE_CODES = new Set([
  "50011", // Request too frequent
  "50012", // System busy
  "50013", // System timeout
  "50026", // System busy, please retry later
  "50027", // System timeout
  "50119", // Interface limit
  "50120", // Request too frequent
  "50121", // System timeout
]);

/** OKX error codes that should NOT be retried (business logic errors) */
const OKX_NON_RETRYABLE_CODES = new Set([
  "50040", // Account frozen
  "50041", // Account banned
  "51001", // Instrument ID does not exist
  "51004", // Order amount exceeds max limit
  "51008", // Insufficient balance
  "51010", // Account mode restriction
  "51020", // Trigger price cannot be higher than last price
  "51021", // Trigger price cannot be lower than last price
]);

function isRetryableOkxCode(code: string): boolean {
  if (OKX_NON_RETRYABLE_CODES.has(code)) return false;
  if (OKX_RETRYABLE_CODES.has(code)) return true;
  // Default: 5xxxx server errors are retryable, everything else is not
  return code.startsWith("5");
}

// OKX standard contract size for ETH-USDT-SWAP (fallback)
const DEFAULT_CONTRACT_SIZE = 0.1;
// 张数步进（lotSz，单位=张）回退值：1=整张（保守，最坏退回旧行为）。
// 实例化后由 getMarketInfo 用真实 lotSz（ETH-USDT-SWAP=0.01，允许零头张）覆盖。
const DEFAULT_LOT_SIZE = 1;

/** 51400 已成交/已撤/不存在：撤单的目标状态（不再活跃）已达成，按幂等成功处理 */
const OKX_CANCEL_TARGET_ALREADY_GONE = "51400";

/**
 * 批量交易接口（order-algo / cancel-algos）失败时顶层 msg 常为空，
 * 真实错误在 data[0].sCode/sMsg——优先取子项错误，缺省回落顶层。
 */
function extractOkxBatchError(res: {
  code: string;
  msg: string;
  data?: Array<{ sCode?: string; sMsg?: string }>;
}): { code: string; message: string } {
  const sCode = res.data?.[0]?.sCode;
  const sMsg = res.data?.[0]?.sMsg;
  const code = sCode && sCode !== "0" ? sCode : res.code;
  return { code, message: sMsg || res.msg || `code=${code}` };
}

/**
 * Pure mapping function: converts a raw OKX `orders` channel push payload into
 * an `OrderFill`. Extracted for unit-testability; `toCoin` is injected so this
 * function stays side-effect-free.
 *
 * OKX `fillFee` convention: fee paid is expressed as a negative number, rebate
 * as positive. We normalise to "paid-positive" by negating the value.
 */
export function mapOkxFill(
  raw: Record<string, string>,
  toCoin: (n: number, symbol: string) => number,
): OrderFill | null {
  if (!raw.fillSz || parseFloat(raw.fillSz) === 0) return null;
  const symbol = raw.instId?.replace(/-/g, '/').replace('/SWAP', '') ?? '';
  // WS 路径用 fillFee/fillFeeCcy，REST 路径（/api/v5/trade/fills*）用 fee/feeCcy；
  // 两者均以已付为负的约定表示，取负归一为已付正值。
  const rawFeeStr = raw.fillFee ?? raw.fee;
  const fillFee = rawFeeStr != null ? parseFloat(rawFeeStr) : undefined;
  return {
    orderId: raw.ordId ?? '',
    // algo 触发单生成的订单 clOrdId 是 OKX 自动 id（O…），我们的 id 在独立
    // 字段 algoClOrdId（模拟盘实测）。优先取它，止损成交才能按 id 归属。
    clientOrderId: raw.algoClOrdId || raw.clOrdId,
    tradeId: raw.tradeId || undefined,
    symbol,
    side: (raw.side as 'buy' | 'sell') ?? 'buy',
    filledQty: toCoin(parseFloat(raw.fillSz), symbol),
    avgPrice: parseFloat(raw.fillPx ?? raw.avgPx ?? '0'), // 本笔成交价，优先 fillPx
    fee: fillFee != null ? -fillFee : undefined, // OKX fee 已付为负 → 取负归一为已付正
    feeAsset: raw.fillFeeCcy ?? raw.feeCcy ?? undefined,
    status: (raw.state === 'filled' ? 'filled' : raw.state === 'partially_filled' ? 'partial' : 'open') as OrderFill['status'],
    ts: parseInt(raw.fillTime ?? raw.uTime ?? '0', 10),
  };
}

/** Helper to create an async generator from WebSocket event emitter */
async function* wsStream<T>(
  client: OkxWsClient,
  channel: string,
  instId: string,
  transform: (data: unknown[]) => T | null,
  instType?: string,
  timeoutMs?: number,
): AsyncIterableIterator<T> {
  const queue: T[] = [];
  let resolveNext: (() => void) | null = null;
  let lastDataAt = Date.now();

  const onData = (msg: { channel: string; data: unknown[] }) => {
    if (msg.channel !== channel) return;
    const item = transform(msg.data);
    if (item !== null) {
      lastDataAt = Date.now();
      queue.push(item);
      resolveNext?.();
    }
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
          if (timeoutMs && timeoutMs > 0) {
            timer = setTimeout(() => resolve(), timeoutMs);
          }
          if (queue.length > 0) {
            if (timer) clearTimeout(timer);
            resolve();
          }
        });

        if (
          timeoutMs &&
          timeoutMs > 0 &&
          queue.length === 0 &&
          Date.now() - lastDataAt >= timeoutMs
        ) {
          throw new ExchangeError(
            `OKX stream stalled on channel ${channel} for ${instId || "(all)"}`,
            "WS_STALLED",
            "okx",
            true,
          );
        }
      }
    }
  } finally {
    client.off("data", onData);
    client.unsubscribe(channel, instType, instId || undefined);
  }
}

// OKX error codes/messages for immediate trigger (lowercased for case-insensitive match)
const IMMEDIATE_TRIGGER_ERRORS = [
  "51020", // Trigger price cannot be higher than the last price
  "51021", // Trigger price cannot be lower than the last price
  "the trigger price is already reached",
  "trigger price is already reached",
  "already triggered",
];

export class OkxAdapter implements IExchangeAdapter {
  readonly exchangeId = "okx" as const;
  readonly accountId: string;

  private readonly logger = new Logger(OkxAdapter.name);
  private rest: OkxRestClient;
  private environment: ExchangeEnvironment;
  private contractSizes = new Map<string, number>();
  private lotSizes = new Map<string, number>();
  private credentials: OkxCredentials;

  // WebSocket clients (lazy initialized)
  private publicWs: OkxWsClient | null = null;
  private privateWs: OkxWsClient | null = null;

  // algoId -> metadata mapping (in-memory, lazily restored after reconnect)
  private algoIdToClosePosition = new Map<string, boolean>();
  private algoIdToTriggerCondition = new Map<string, "price_below" | "price_above">();

  constructor(credentials: OkxCredentials & { accountId?: string; environment?: ExchangeEnvironment }) {
    this.environment = credentials.environment ?? "demo";
    this.rest = new OkxRestClient(credentials, undefined, this.environment);
    this.credentials = credentials;
    this.accountId = credentials.accountId ?? "okx-account";
  }

  // ── Helpers ───────────────────────────────────────────────────

  private getContractSize(symbol: string): number {
    return this.contractSizes.get(symbol) ?? DEFAULT_CONTRACT_SIZE;
  }

  private getLotSize(symbol: string): number {
    return this.lotSizes.get(symbol) ?? DEFAULT_LOT_SIZE;
  }

  /**
   * 下单前确保合约面值(ctVal)与张数步进(lotSz)已缓存，否则按 lotSz 取整会落到
   * 保守默认(整张)而把零头张数量进位成 2×。best-effort：拉取失败则沿用已有缓存/默认，
   * 不阻断下单（与 Binance 下单前 getMarketInfo 同模式，但失败不致命）。
   */
  private async ensureInstrumentInfo(symbol: string): Promise<void> {
    if (this.lotSizes.has(symbol) && this.contractSizes.has(symbol)) return;
    try {
      await this.getMarketInfo(symbol);
    } catch (err) {
      // best-effort：拉取失败沿用已有缓存/默认，不阻断下单。但冷缓存下回退到
      // DEFAULT_LOT_SIZE(整张) 会让零头张数量被进位成 2×（正是本修复要消灭的 churn），
      // 必须告警可观测，而非静默亏钱。下一单会自动重试拉取（has() 仍为 false），可自愈。
      if (!this.lotSizes.has(symbol)) {
        this.logger.warn(
          `ensureInstrumentInfo(${symbol}) failed with cold cache; falling back to ` +
            `DEFAULT_LOT_SIZE=${DEFAULT_LOT_SIZE} (orders may be oversized until next refresh): ` +
            `${(err as Error).message}`,
        );
      }
    }
  }

  private toContracts(qty: number, symbol: string): number {
    return coinToContracts(qty, this.getContractSize(symbol), this.getLotSize(symbol));
  }

  private toCoin(qty: number, symbol: string): number {
    return contractsToCoin(qty, this.getContractSize(symbol));
  }

  private parseOkxOrder(raw: OkxOrder): Order {
    const symbol = raw.instId.replace(/-/g, "/").replace("/SWAP", "");
    const stateMap: Record<string, Order["status"]> = {
      live: "open",
      partially_filled: "partial",
      filled: "filled",
      canceled: "cancelled",
    };

    return {
      orderId: raw.ordId,
      clientOrderId: raw.clOrdId,
      symbol,
      side: raw.side as "buy" | "sell",
      type: raw.ordType,
      qty: this.toCoin(parseFloat(raw.sz), symbol),
      price: raw.px ? parseFloat(raw.px) : undefined,
      status: stateMap[raw.state] ?? "open",
      filledQty: this.toCoin(parseFloat(raw.fillSz), symbol),
      avgPrice: raw.avgPx ? parseFloat(raw.avgPx) : undefined,
      ts: parseInt(raw.uTime, 10),
    };
  }

  private parseOkxAlgoOrder(raw: OkxAlgoOrder): AlgoOrder {
    const stateMap: Record<string, AlgoOrder["status"]> = {
      live: "open",
      effective: "triggered",
      canceled: "cancelled",
      order_failed: "cancelled",
    };

    // Use cached metadata if available; OKX API does not return these fields directly
    const triggerCondition =
      this.algoIdToTriggerCondition.get(raw.algoId) ?? "price_below";
    const closePosition =
      this.algoIdToClosePosition.get(raw.algoId) ?? false;
    const symbol = raw.instId.replace(/-/g, "/").replace("/SWAP", "");

    return {
      algoOrderId: raw.algoId,
      clientAlgoId: raw.algoClOrdId,
      symbol,
      side: raw.side as "buy" | "sell",
      // conditional 止损单触发价在 slTriggerPx；trigger 单在 triggerPx。
      // hasOwnEmergency 去重靠 triggerPrice 比对，取错字段会让每 tick 重下。
      triggerPrice: parseFloat(raw.slTriggerPx ?? raw.triggerPx),
      triggerCondition,
      // closeFraction 平仓单回报可能不带 sz；qty 仅供展示，所有权/去重靠
      // clientOrderId 与 triggerPrice，故缺省回 0 即可，不可让 NaN 外泄。
      qty: this.toCoin(parseFloat(raw.sz) || 0, symbol),
      closePosition,
      status: stateMap[raw.state] ?? "open",
      ts: parseInt(raw.cTime, 10),
    };
  }

  private parseOkxPosition(raw: OkxPosition): Position {
    const pos = parseFloat(raw.pos);
    const side: Position["side"] =
      pos > 0 ? "long" : pos < 0 ? "short" : "none";
    const symbol = raw.instId.replace(/-/g, "/").replace("/SWAP", "");

    return {
      symbol,
      side,
      qty: Math.abs(this.toCoin(pos, symbol)),
      avgCost: parseFloat(raw.avgPx) || 0,
      unrealizedPnl: parseFloat(raw.upl) || 0,
      leverage: parseFloat(raw.lever) || 1,
      marginType: raw.mgnMode === "isolated" ? "isolated" : "cross",
      ts: Date.now(),
    };
  }

  // ── WebSocket Streams ─────────────────────────────────────────

  private async getPublicWs(): Promise<OkxWsClient> {
    if (!this.publicWs) {
      const url = this.environment === "live" ? OKX_WS_PUBLIC_LIVE : OKX_WS_PUBLIC;
      this.publicWs = new OkxWsClient(this.credentials, url, false);
      await this.publicWs.connect();
    }
    return this.publicWs;
  }

  private async getPrivateWs(): Promise<OkxWsClient> {
    if (!this.privateWs) {
      const url = this.environment === "live" ? OKX_WS_PRIVATE_LIVE : OKX_WS_PRIVATE;
      this.privateWs = new OkxWsClient(this.credentials, url, true);
      await this.privateWs.connect(); // connect() auto-calls login()
    }
    return this.privateWs;
  }

  async *watchTicker(symbol: string): AsyncIterableIterator<Ticker> {
    const client = await this.getPublicWs();
    const instId = toOkxSymbol(symbol);
    client.subscribe("tickers", undefined, instId);

    yield* wsStream<Ticker>(client, "tickers", instId, (data) => {
      const raw = (data[0] ?? {}) as Record<string, string>;
      const lastPrice = parseFloat(raw.last ?? "");
      // 空 data/确认帧映射出的 0 价 ticker 会被 FSM 当真实价误清算，丢弃
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;
      return {
        symbol,
        bestBid: parseFloat(raw.bidPx ?? "0"),
        bestAsk: parseFloat(raw.askPx ?? "0"),
        lastPrice,
        ts: parseInt(raw.ts ?? "0", 10),
      };
    }, undefined, 30000);
  }

  // ── REST Ticker (cold-start fallback when WS is unavailable) ──
  // Public market endpoint; no signature strictly required, but the shared
  // REST client signs every request — OKX accepts signed public calls fine.

  async getTicker(symbol: string): Promise<Ticker> {
    const instId = toOkxSymbol(symbol);
    const res = (await withRetry(
      () => this.rest.getTicker(instId),
      {},
      "getTicker",
    )) as {
      code: string;
      msg: string;
      data?: OkxTicker[];
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX getTicker failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    const raw = res.data?.[0];
    if (!raw) {
      throw new ExchangeError(
        `OKX getTicker: no ticker data for ${instId}`,
        "NO_TICKER",
        this.exchangeId,
        true,
      );
    }

    return {
      symbol,
      bestBid: parseFloat(raw.bidPx),
      bestAsk: parseFloat(raw.askPx),
      lastPrice: parseFloat(raw.last),
      ts: parseInt(raw.ts, 10) || Date.now(),
    };
  }

  async *watchOrderFills(_symbol: string): AsyncIterableIterator<OrderFill> {
    const client = await this.getPrivateWs();
    client.subscribe("orders", OKX_INST_TYPE);

    yield* wsStream<OrderFill>(
      client,
      "orders",
      "",
      (data) => mapOkxFill((data[0] ?? {}) as Record<string, string>, (n, s) => this.toCoin(n, s)),
      OKX_INST_TYPE,
    );
  }

  async *watchAlgoTriggers(_symbol: string): AsyncIterableIterator<AlgoTrigger> {
    const client = await this.getPrivateWs();
    client.subscribe("orders-algo", OKX_INST_TYPE);

    yield* wsStream<AlgoTrigger>(
      client,
      "orders-algo",
      "",
      (data) => {
        const raw = (data[0] ?? {}) as Record<string, string>;
        // Only yield when algo order is triggered (effective state)
        if (raw.state !== "effective") return null;
        return {
          algoOrderId: raw.algoId ?? "",
          clientAlgoId: raw.algoClOrdId ?? "",
          symbol: raw.instId?.replace(/-/g, "/").replace("/SWAP", "") ?? "",
          side: (raw.side as "buy" | "sell") ?? "buy",
          triggerPrice: parseFloat(raw.triggerPx ?? "0"),
          filledQty: this.toCoin(parseFloat(raw.sz ?? "0"), raw.instId?.replace(/-/g, "/").replace("/SWAP", "") ?? ""),
          ts: parseInt(raw.cTime ?? "0", 10),
        };
      },
      OKX_INST_TYPE,
    );
  }

  async *watchPositions(_symbol: string): AsyncIterableIterator<Position> {
    const client = await this.getPrivateWs();
    client.subscribe("positions", OKX_INST_TYPE);

    yield* wsStream<Position>(
      client,
      "positions",
      "",
      (data) => {
        const raw = (data[0] ?? {}) as Record<string, string>;
        return this.parseWsPosition(raw);
      },
      OKX_INST_TYPE,
    );
  }

  private parseWsPosition(raw: Record<string, string>): Position {
    const pos = parseFloat(raw.pos ?? "0");
    const side: Position["side"] =
      pos > 0 ? "long" : pos < 0 ? "short" : "none";
    const symbol = raw.instId?.replace(/-/g, "/").replace("/SWAP", "") ?? "";

    return {
      symbol,
      side,
      qty: Math.abs(this.toCoin(pos, symbol)),
      avgCost: parseFloat(raw.avgPx ?? "0") || 0,
      unrealizedPnl: parseFloat(raw.upl ?? "0") || 0,
      leverage: parseFloat(raw.lever ?? "1") || 1,
      ts: Date.now(),
    };
  }

  // ── Account Level Check ─────────────────────────────────────

  private async checkAccountLevel(): Promise<void> {
    const config = (await this.rest.getAccountConfig()) as {
      code: string;
      msg: string;
      data?: Array<{ acctLv: string; level: string }>;
    };
    if (config.code === "0" && config.data?.[0]) {
      const lv = config.data[0].acctLv;
      if (lv === "1") {
        throw new ExchangeError(
          `OKX account is in Simple mode (Lv1). Contract trading requires upgrading to Futures mode (Lv2+) via the OKX website.`,
          "ACCOUNT_MODE_RESTRICTED",
          this.exchangeId,
          false,
        );
      }
    }
  }

  // ── Orders ────────────────────────────────────────────────────

  async createOrder(params: CreateOrderParams): Promise<Order> {
    // 静默 slice(0,32) 会把高序号网格 id 截成低序号（…B1000→…B100）撞 id，
    // 成交按 clientOrderId 解析会被错误归属。超长必须 fail-loud（先于网络调用）。
    if (params.clientOrderId) {
      const sanitized = okxSanitizeClientId(params.clientOrderId);
      if (sanitized.length > 32) {
        throw new ExchangeError(
          `OKX clOrdId too long after sanitize: "${sanitized}" (${sanitized.length} > 32)`,
          "CLIENT_ID_TOO_LONG",
          this.exchangeId,
          false,
        );
      }
    }

    await this.checkAccountLevel();

    const instId = toOkxSymbol(params.symbol);
    const ordType = params.type; // 'limit' | 'market' | 'post_only'
    await this.ensureInstrumentInfo(params.symbol); // 保证 ctVal/lotSz 已缓存，避免零头张被进位成 2×
    const sz = String(this.toContracts(params.qty, params.symbol));
    const clOrdId = params.clientOrderId
      ? toOkxClientId(params.clientOrderId)
      : undefined;

    const body: Record<string, unknown> = {
      instId,
      tdMode: "cross",
      side: params.side,
      ordType,
      sz,
    };

    if (clOrdId) body.clOrdId = clOrdId;
    if (params.price !== undefined && (ordType === "limit" || ordType === "post_only")) {
      body.px = String(params.price);
    }
    if (params.reduceOnly) {
      body.reduceOnly = "true";
    }

    const res = (await this.rest.placeOrder(body)) as {
      code: string;
      msg: string;
      data?: Array<{ ordId: string; clOrdId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      // 顶层 code:"1" msg:"All operations failed" 时真实原因在 data[0].sCode/sMsg，
      // 与 cancelOrder 同一 OKX 接口特性，同样必须透传，否则 actionable-rejections
      // 白名单里的 51008/51010 永远匹配不上（见 okx.adapter.unit.spec.ts 对应用例）。
      const { code, message } = extractOkxBatchError(res);
      if (code === "51420") {
        throw new ExchangeError(
          `OKX createOrder failed: ${message}`,
          code,
          this.exchangeId,
          false,
          ErrorCategory.POST_ONLY_REJECT,
        );
      }
      throw new ExchangeError(
        `OKX createOrder failed: ${message}`,
        code,
        this.exchangeId,
        isRetryableOkxCode(code),
      );
    }

    const orderId = res.data?.[0]?.ordId ?? "";
    const returnedClOrdId = res.data?.[0]?.clOrdId;

    return {
      orderId,
      clientOrderId: returnedClOrdId ?? clOrdId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      qty: params.qty,
      price: params.price,
      status: "open",
      filledQty: 0,
      ts: Date.now(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    const instId = toOkxSymbol(symbol);
    const res = (await withRetry(
      () => this.rest.cancelOrder(instId, orderId),
      {},
      "cancelOrder",
    )) as {
      code: string;
      msg: string;
      data?: Array<{ ordId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      // 顶层 code:"1" msg:"All operations failed" 时真实原因在 data[0].sCode；
      // 51400=已成交/已撤/不存在，撤单目标（不再活跃）已达成，按幂等成功处理，不抛错。
      const { code, message } = extractOkxBatchError(res);
      if (code !== OKX_CANCEL_TARGET_ALREADY_GONE) {
        throw new ExchangeError(
          `OKX cancelOrder failed: ${message}`,
          code,
          this.exchangeId,
          isRetryableOkxCode(code),
        );
      }
    }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    const instId = toOkxSymbol(symbol);

    // Fetch all open orders for this symbol
    const openRes = (await withRetry(
      () => this.rest.getOpenOrders(OKX_INST_TYPE, instId),
      {},
      "getOpenOrders",
    )) as {
      code: string;
      msg: string;
      data?: OkxOrder[];
    };

    if (openRes.code !== "0") {
      throw new ExchangeError(
        `OKX getOpenOrders failed: ${openRes.msg}`,
        openRes.code,
        this.exchangeId,
        isRetryableOkxCode(openRes.code),
      );
    }

    const orders = openRes.data ?? [];
    if (orders.length === 0) return;

    // Batch cancel all open orders
    const cancelList = orders.map((o) => ({
      instId: o.instId,
      ordId: o.ordId,
    }));

    const res = (await withRetry(
      () => this.rest.cancelBatchOrders(cancelList),
      {},
      "cancelBatchOrders",
    )) as {
      code: string;
      msg: string;
      data?: Array<{ ordId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      // 与 cancelOrder 同一 OKX 接口特性：顶层 code:"1" msg:"All operations failed" 时
      // 真实原因在 data[0].sCode/sMsg。
      const { code, message } = extractOkxBatchError(res);
      throw new ExchangeError(
        `OKX cancelBatchOrders failed: ${message}`,
        code,
        this.exchangeId,
        isRetryableOkxCode(code),
      );
    }
  }

  async closePosition(symbol: string, side: "long" | "short"): Promise<Order> {
    const instId = toOkxSymbol(symbol);
    // Close position: opposite side, reduceOnly market order
    const closeSide = side === "long" ? "sell" : "buy";

    // Fetch current position to get exact qty
    const pos = await this.fetchPosition(symbol);
    if (pos.qty === 0) {
      throw new ExchangeError(
        `No open position to close for ${symbol}`,
        "NO_POSITION",
        this.exchangeId,
        false,
      );
    }
    // 平仓张数向上取整：四舍五入会把分数合约残留在交易所（实测 38.41 张
    // round→38 留 0.41 张），且残留 <0.5 张时 round→0 直接抛错永远平不掉。
    // reduceOnly 保证超出部分被交易所截断，不会反向开仓。
    const sz = String(Math.ceil(pos.qty / this.getContractSize(symbol)));

    const body: Record<string, unknown> = {
      instId,
      tdMode: "cross",
      side: closeSide,
      ordType: "market",
      sz,
      reduceOnly: "true",
    };

    const res = (await this.rest.placeOrder(body)) as {
      code: string;
      msg: string;
      data?: Array<{ ordId: string; clOrdId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      const { code, message } = extractOkxBatchError(res);
      throw new ExchangeError(
        `OKX closePosition failed: ${message}`,
        code,
        this.exchangeId,
        isRetryableOkxCode(code),
      );
    }

    const orderId = res.data?.[0]?.ordId ?? "";

    return {
      orderId,
      symbol,
      side: closeSide,
      type: "market",
      qty: pos.qty,
      status: "open",
      filledQty: 0,
      ts: Date.now(),
    };
  }

  // ── Algo Orders ───────────────────────────────────────────────

  async createAlgoOrder(params: CreateAlgoOrderParams): Promise<AlgoOrder> {
    // toOkxClientId 的 slice(0,32) 会静默吃掉超长 id 的尾部随机后缀：每次
    // 重下得到同一 id 被 OKX 拒重复，且所有权前缀匹配失效。超长必须 fail-loud。
    const sanitized = okxSanitizeClientId(params.clientAlgoId);
    if (sanitized.length > 32) {
      throw new ExchangeError(
        `OKX algoClOrdId too long after sanitize: "${sanitized}" (${sanitized.length} > 32)`,
        "CLIENT_ID_TOO_LONG",
        this.exchangeId,
        false,
      );
    }

    await this.checkAccountLevel();

    const instId = toOkxSymbol(params.symbol);
    const algoClOrdId = toOkxClientId(params.clientAlgoId);
    await this.ensureInstrumentInfo(params.symbol); // 保证 ctVal/lotSz 已缓存，避免零头张被进位成 2×
    const sz = String(this.toContracts(params.qty, params.symbol));

    const body: Record<string, unknown> = {
      instId,
      tdMode: "cross",
      side: params.side,
      algoClOrdId,
    };

    if (params.closePosition) {
      // OKX trigger 单不支持 reduce-only 平整仓：reduceOnly+sz 回 51205
      // 'Reduce Only is not available.'，改发 closeFraction 又回 51000 'Parameter
      // sz error'（trigger 忽略 closeFraction、仍强制 sz）——均为模拟盘实测。
      // closeFraction（按实时仓位平 100%、reduce-only、永不反向开仓）只对 conditional
      // 止损单生效，故平仓单走 conditional：slTriggerPx 触发、slOrdPx=-1 市价。
      // closeFraction 仅对 reduceOnly 单生效（51328），同时带 reduceOnly。
      body.ordType = OKX_ALGO_ORD_TYPE; // "conditional"
      body.slTriggerPx = String(params.triggerPrice);
      body.slTriggerPxType = "last";
      body.slOrdPx = "-1"; // market on trigger
      body.closeFraction = "1";
      body.reduceOnly = "true";
    } else {
      body.ordType = "trigger";
      body.triggerPx = String(params.triggerPrice);
      body.triggerPxType = "last";
      // 触发单的委托价参数名是 orderPx（普通单才是 px/ordPx）：
      // 模拟盘实测发 ordPx 报 50014 'Parameter orderPx can not be empty'
      body.orderPx = "-1"; // market order on trigger
      body.sz = sz;
    }

    const res = (await this.rest.placeAlgoOrder(body)) as {
      code: string;
      msg: string;
      data?: Array<{ algoId: string; algoClOrdId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      const { code, message } = extractOkxBatchError(res);
      throw new ExchangeError(
        `OKX createAlgoOrder failed: ${message}`,
        code,
        this.exchangeId,
        isRetryableOkxCode(code),
      );
    }

    const algoOrderId = res.data?.[0]?.algoId ?? "";
    const returnedAlgoClOrdId = res.data?.[0]?.algoClOrdId;

    // Cache metadata for correct reconstruction on fetch
    if (algoOrderId) {
      this.algoIdToClosePosition.set(algoOrderId, params.closePosition ?? false);
      this.algoIdToTriggerCondition.set(algoOrderId, params.triggerCondition);
    }

    return {
      algoOrderId,
      clientAlgoId: returnedAlgoClOrdId ?? algoClOrdId,
      symbol: params.symbol,
      side: params.side,
      triggerPrice: params.triggerPrice,
      triggerCondition: params.triggerCondition,
      qty: params.qty,
      closePosition: params.closePosition ?? false,
      status: "open",
      ts: Date.now(),
    };
  }

  async cancelAlgoOrder(algoOrderId: string, symbol: string): Promise<void> {
    const instId = toOkxSymbol(symbol);
    const res = (await withRetry(
      () => this.rest.cancelAlgoOrders([{ instId, algoId: algoOrderId }]),
      {},
      "cancelAlgoOrders",
    )) as {
      code: string;
      msg: string;
      data?: Array<{ algoId?: string; sCode?: string; sMsg?: string }>;
    };

    if (res.code !== "0") {
      const { code, message } = extractOkxBatchError(res);
      if (code !== OKX_CANCEL_TARGET_ALREADY_GONE) {
        throw new ExchangeError(
          `OKX cancelAlgoOrder failed: ${message}`,
          code,
          this.exchangeId,
          isRetryableOkxCode(code),
        );
      }
    }

    this.algoIdToClosePosition.delete(algoOrderId);
    this.algoIdToTriggerCondition.delete(algoOrderId);
  }

  async cancelAllAlgoOrders(symbol: string): Promise<void> {
    const instId = toOkxSymbol(symbol);

    // Fetch all pending algo orders
    const pendingRes = (await withRetry(
      () => this.rest.getPendingAlgoOrders(OKX_ALGO_ORD_TYPE, OKX_INST_TYPE, instId),
      {},
      "getPendingAlgoOrders",
    )) as {
      code: string;
      msg: string;
      data?: OkxAlgoOrder[];
    };

    if (pendingRes.code !== "0") {
      throw new ExchangeError(
        `OKX getPendingAlgoOrders failed: ${pendingRes.msg}`,
        pendingRes.code,
        this.exchangeId,
        isRetryableOkxCode(pendingRes.code),
      );
    }

    const algos = pendingRes.data ?? [];
    if (algos.length === 0) return;

    // Cancel in batches of max 10 (OKX limit)
    const batchSize = 10;
    for (let i = 0; i < algos.length; i += batchSize) {
      const batch = algos.slice(i, i + batchSize).map((a) => ({
        instId: a.instId,
        algoId: a.algoId,
      }));

      const res = (await withRetry(
        () => this.rest.cancelAlgoOrders(batch),
        {},
        "cancelAlgoOrders",
      )) as {
        code: string;
        msg: string;
        data?: Array<{ algoId?: string; sCode?: string; sMsg?: string }>;
      };

      if (res.code !== "0") {
        // 逐项检查：51400（已不在）不算失败，其余子项错误带 sMsg 抛出
        const realFailure = (res.data ?? []).find(
          (d) => d.sCode && d.sCode !== "0" && d.sCode !== OKX_CANCEL_TARGET_ALREADY_GONE,
        );
        if (realFailure) {
          throw new ExchangeError(
            `OKX cancelAlgoOrders batch failed: ${realFailure.sMsg || res.msg || `code=${realFailure.sCode}`}`,
            realFailure.sCode as string,
            this.exchangeId,
            isRetryableOkxCode(realFailure.sCode as string),
          );
        }
        // 只有"所有子项均为 0/51400"才算幂等成功；空 data 或缺 sCode 的
        // 异常负载放行就是静默吞错，按顶层错误抛出
        const allItemsBenign =
          (res.data?.length ?? 0) > 0 &&
          (res.data ?? []).every(
            (d) => d.sCode === "0" || d.sCode === OKX_CANCEL_TARGET_ALREADY_GONE,
          );
        if (!allItemsBenign) {
          throw new ExchangeError(
            `OKX cancelAlgoOrders batch failed: ${res.msg || `code=${res.code}`}`,
            res.code,
            this.exchangeId,
            isRetryableOkxCode(res.code),
          );
        }
      }

      // Clean up metadata for successfully canceled algos in this batch
      for (const a of batch) {
        this.algoIdToClosePosition.delete(a.algoId);
        this.algoIdToTriggerCondition.delete(a.algoId);
      }
    }
  }

  async fetchAlgoOrders(symbol: string): Promise<AlgoOrder[]> {
    const instId = toOkxSymbol(symbol);

    const res = (await withRetry(
      () => this.rest.getPendingAlgoOrders(OKX_ALGO_ORD_TYPE, OKX_INST_TYPE, instId),
      {},
      "getPendingAlgoOrders",
    )) as {
      code: string;
      msg: string;
      data?: OkxAlgoOrder[];
    };

    if (res.code !== "0") {
      // Account mode restrictions (e.g. Lv1 Simple mode) return 51010
      if (res.code === "51010") {
        return [];
      }
      throw new ExchangeError(
        `OKX fetchAlgoOrders failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    return (res.data ?? []).map((a) => this.parseOkxAlgoOrder(a));
  }

  isImmediateTriggerError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    return IMMEDIATE_TRIGGER_ERRORS.some((pattern) =>
      msg.includes(pattern.toLowerCase()),
    );
  }

  // ── Account Initialization ────────────────────────────────────

  async setPositionMode(oneWay: boolean): Promise<void> {
    // OKX: net_mode = one-way (single direction), long_short_mode = hedge mode
    const posMode = oneWay ? "net_mode" : "long_short_mode";
    const res = (await this.rest.setPositionMode(posMode)) as {
      code: string;
      msg: string;
    };

    if (res.code !== "0") {
      // If already in the requested mode, OKX may return an error — ignore it
      if (res.msg?.toLowerCase().includes("position mode")) {
        return;
      }
      throw new ExchangeError(
        `OKX setPositionMode failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }
  }

  async getPositionMode(): Promise<boolean> {
    const res = (await this.rest.getAccountConfig()) as {
      code: string;
      msg: string;
      data?: Array<{ posMode: string }>;
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX getAccountConfig failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    const posMode = res.data?.[0]?.posMode;
    return posMode === "net_mode";
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    const instId = toOkxSymbol(symbol);
    const res = (await this.rest.setLeverage(
      instId,
      String(leverage),
      "cross",
    )) as {
      code: string;
      msg: string;
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX setLeverage failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }
  }

  async setMarginMode(symbol: string, crossMargin: boolean): Promise<void> {
    // OKX: No independent margin mode API
    // setLeverage already binds via mgnMode, each order uses tdMode=cross
    // This is a no-op
    return;
  }

  async getMarginMode(symbol: string): Promise<boolean> {
    // Check position mgnMode, optimistic default true (cross)
    try {
      const instId = toOkxSymbol(symbol);
      const res = (await this.rest.getPositions(OKX_INST_TYPE, instId)) as {
        code: string;
        msg: string;
        data?: OkxPosition[];
      };

      if (res.code === "0" && res.data && res.data.length > 0) {
        return res.data[0].mgnMode === "cross";
      }
    } catch {
      // Ignore errors, return optimistic default
    }

    return true; // Optimistic default: cross margin
  }

  // ── REST Queries ──────────────────────────────────────────────

  async fetchPosition(symbol: string): Promise<Position> {
    const instId = toOkxSymbol(symbol);

    const res = (await withRetry(
      () => this.rest.getPositions(OKX_INST_TYPE, instId),
      {},
      "getPositions",
    )) as {
      code: string;
      msg: string;
      data?: OkxPosition[];
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX fetchPosition failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    const positions = res.data ?? [];
    if (positions.length === 0) {
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

    return this.parseOkxPosition(positions[0]);
  }

  async getAccountUid(): Promise<string> {
    const cfg = (await this.rest.getAccountConfig()) as {
      code: string;
      msg: string;
      data?: Array<{ uid?: string }>;
    };
    const uid = cfg.data?.[0]?.uid;
    if (!uid) {
      throw new ExchangeError(
        `OKX account/config returned no uid (code=${cfg.code} msg=${cfg.msg})`,
        'ACCOUNT_UID_MISSING',
        'okx',
        false,
      );
    }
    return uid;
  }

  async fetchBalance(): Promise<Balance> {
    const res = (await withRetry(
      () => this.rest.getBalance(),
      {},
      "getBalance",
    )) as {
      code: string;
      msg: string;
      data?: Array<{
        details?: OkxBalance[];
        totalEq?: string;
      }>;
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX fetchBalance failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    const details = res.data?.[0]?.details ?? [];
    const usdtEntry = details.find((d) => d.ccy === "USDT");

    return {
      usdt: parseFloat(usdtEntry?.availEq || usdtEntry?.availBal || usdtEntry?.eq || "0"),
      totalEquity: parseFloat(res.data?.[0]?.totalEq ?? "0"),
      ts: Date.now(),
    };
  }

  async fetchOpenOrders(symbol: string): Promise<Order[]> {
    const instId = toOkxSymbol(symbol);

    const res = (await withRetry(
      () => this.rest.getOpenOrders(OKX_INST_TYPE, instId),
      {},
      "getOpenOrders",
    )) as {
      code: string;
      msg: string;
      data?: OkxOrder[];
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX fetchOpenOrders failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    return (res.data ?? []).map((o) => this.parseOkxOrder(o));
  }

  async fetchMyTrades(symbol: string, sinceMs: number): Promise<OrderFill[]> {
    const instId = toOkxSymbol(symbol);
    const res = (await this.rest.getFills(
      OKX_INST_TYPE,
      instId,
      sinceMs ? String(sinceMs) : undefined,
    )) as { code?: string; data?: Record<string, string>[] };
    const rows = res?.data ?? [];
    const fills = rows.map((raw) => mapOkxFill(raw, (n, s) => this.toCoin(n, s))).filter((f): f is OrderFill => f !== null);

    // REST /trade/fills 不带 algoClOrdId（WS 订单事件才有）：algo 触发单成交
    // 的 clOrdId 是 OKX 自动 id（O…，模拟盘实测），不从 orders-history 拼回
    // 的话，WS 错过时止损成交永远无法按 id 归属。富化失败不阻断对账。
    if (fills.length > 0) {
      try {
        const hist = (await this.rest.getOrdersHistory(
          OKX_INST_TYPE,
          instId,
          sinceMs ? String(sinceMs) : undefined,
        )) as { data?: Array<{ ordId?: string; algoClOrdId?: string }> };
        const algoIdByOrdId = new Map(
          (hist?.data ?? [])
            .filter((o) => o.ordId && o.algoClOrdId)
            .map((o) => [o.ordId as string, o.algoClOrdId as string]),
        );
        if (algoIdByOrdId.size > 0) {
          for (const f of fills) {
            const algoClOrdId = algoIdByOrdId.get(f.orderId);
            if (algoClOrdId) f.clientOrderId = algoClOrdId;
          }
        }
      } catch {
        // 富化是 best-effort：orders-history 失败时返回原始成交
      }
    }
    return fills;
  }

  /**
   * 拉取资金费历史。OKX /api/v5/account/bills 仅保留最近 7 天；
   * 超过 7 天须改用 /api/v5/account/bills-archive（TODO：后续迭代支持）。
   */
  async fetchFundingHistory(symbol: string, sinceMs: number, untilMs?: number): Promise<FundingFeeRecord[]> {
    const instId = toOkxSymbol(symbol);
    const res = await this.rest.getFundingBills(instId);

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX fetchFundingHistory failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    return (res.data ?? [])
      .filter((entry) => entry["type"] === "8")
      .map((entry) => ({
        symbol,
        fundingTime: Number(entry["ts"]),
        amount: Number(entry["balChg"]),
      }))
      .filter(
        (record) =>
          record.fundingTime >= sinceMs &&
          (untilMs === undefined || record.fundingTime <= untilMs),
      );
  }

  async getMarketInfo(symbol: string): Promise<MarketInfo> {
    const instId = toOkxSymbol(symbol);

    const res = (await withRetry(
      () => this.rest.getInstruments(OKX_INST_TYPE, instId),
      {},
      "getInstruments",
    )) as {
      code: string;
      msg: string;
      data?: OkxInstrument[];
    };

    if (res.code !== "0") {
      throw new ExchangeError(
        `OKX getMarketInfo failed: ${res.msg}`,
        res.code,
        this.exchangeId,
        isRetryableOkxCode(res.code),
      );
    }

    const inst = res.data?.[0];
    if (!inst) {
      throw new ExchangeError(
        `OKX getMarketInfo: instrument ${instId} not found`,
        "INSTRUMENT_NOT_FOUND",
        this.exchangeId,
        false,
      );
    }

    const ctVal = parseFloat(inst.ctVal);
    this.contractSizes.set(symbol, ctVal);
    this.lotSizes.set(symbol, parseFloat(inst.lotSz)); // lotSz 单位=张，按此对齐零头张下单

    return {
      symbol,
      rawSymbol: inst.instId,
      minQty: parseFloat(inst.minSz) * ctVal, // minSz is in contract units
      // minNotionalSz is in quote currency (USDT), no conversion needed
      minNotional: parseFloat(inst.minNotionalSz ?? "0"),
      stepSize: parseFloat(inst.lotSz) * ctVal, // lotSz is in contract units
      tickSize: parseFloat(inst.tickSz),
      contractSize: ctVal,
      makerFeeRate: parseFloat(inst.makerFee),
      takerFeeRate: parseFloat(inst.takerFee),
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  destroy(): void {
    this.algoIdToClosePosition.clear();
    this.algoIdToTriggerCondition.clear();
    this.contractSizes.clear();
    this.lotSizes.clear();
    this.publicWs?.disconnect();
    this.publicWs = null;
    this.privateWs?.disconnect();
    this.privateWs = null;
  }

  // ── Reconnect Sync ────────────────────────────────────────────

  async syncStateAfterReconnect(symbol: string): Promise<SyncResult> {
    // Individual fetch operations already have their own withRetry wrapping;
    // no outer retry needed to avoid amplification.
    // Sequential: fetchOpenOrders -> fetchAlgoOrders -> fetchPosition
    // Order matters to avoid state races
    const openOrders = await this.fetchOpenOrders(symbol);
    const openAlgoOrders = await this.fetchAlgoOrders(symbol);
    const position = await this.fetchPosition(symbol);

    return {
      openOrders,
      openAlgoOrders,
      position,
    };
  }
}

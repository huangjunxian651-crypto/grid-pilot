// binance.adapter.unit.spec.ts — Binance adapter unit tests with nock
// Intercepts all HTTP requests to Binance Testnet, no live network calls

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { BinanceAdapter } from "./binance.adapter";
import { ExchangeError, ErrorCategory } from "../../interfaces/exchange-adapter.interface";
import { BINANCE_REST_TESTNET } from "./binance.types";

const BASE_URL = BINANCE_REST_TESTNET;

function createAdapter(): BinanceAdapter {
  return new BinanceAdapter({
    apiKey: "test-key",
    apiSecret: "test-secret",
    accountId: "test-binance",
  });
}

// Match any query string (signed requests include timestamp + signature)
function matchAnyQuery() {
  return true;
}

describe("BinanceAdapter", () => {
  let adapter: BinanceAdapter;

  beforeEach(() => {
    adapter = createAdapter();
    nock.cleanAll();
  });

  afterEach(() => {
    adapter.destroy();
    nock.cleanAll();
  });

  // ── getTicker (REST) ──────────────────────────────────────────

  it("getTicker fetches REST ticker snapshot from public endpoints", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/ticker/bookTicker")
      .query({ symbol: "ETHUSDT" })
      .reply(200, {
        symbol: "ETHUSDT",
        bidPrice: "2456.5",
        bidQty: "10",
        askPrice: "2456.9",
        askQty: "12",
        time: 1589437530011,
      });

    nock(BASE_URL)
      .get("/fapi/v1/ticker/price")
      .query({ symbol: "ETHUSDT" })
      .reply(200, {
        symbol: "ETHUSDT",
        price: "2456.7",
        time: 1589437530011,
      });

    const ticker = await adapter.getTicker("ETH/USDT");
    expect(ticker.symbol).toBe("ETH/USDT");
    expect(ticker.lastPrice).toBe(2456.7);
    expect(ticker.bestBid).toBe(2456.5);
    expect(ticker.bestAsk).toBe(2456.9);
    expect(ticker.ts).toBeGreaterThan(0);
  });

  // ── createOrder ───────────────────────────────────────────────

  it("createOrder returns Order on success", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(200, {
        orderId: 12345,
        clientOrderId: "testclientid",
        symbol: "ETHUSDT",
        side: "BUY",
        type: "LIMIT",
        origQty: "0.1",
        price: "2400",
        status: "NEW",
        executedQty: "0",
        avgPrice: "0",
        updateTime: 1000,
      });

    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "buy",
      type: "limit",
      qty: 0.1,
      price: 2400,
      clientOrderId: "test-client-id",
    });

    expect(order.orderId).toBe("12345");
    expect(order.symbol).toBe("ETH/USDT");
    expect(order.side).toBe("buy");
    expect(order.status).toBe("open");
    expect(order.type).toBe("limit");
  });

  it("createOrder maps post_only correctly", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(200, {
        orderId: 1,
        symbol: "ETHUSDT",
        side: "SELL",
        type: "LIMIT",
        origQty: "0.05",
        price: "2500",
        status: "NEW",
        executedQty: "0",
        avgPrice: "0",
        updateTime: 1000,
      });

    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "sell",
      type: "post_only",
      qty: 0.05,
      price: 2500,
    });

    expect(order.type).toBe("limit"); // Binance returns LIMIT for post_only (GTX timeInForce)
  });

  it("createOrder throws ExchangeError on API error", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(400, { code: -2015, msg: "Invalid API-key, IP, or permissions for action" });

    await expect(
      adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 }),
    ).rejects.toThrow(ExchangeError);
  });

  // ── cancelOrder ───────────────────────────────────────────────

  it("cancelOrder resolves on success", async () => {
    nock(BASE_URL)
      .delete("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(200, { orderId: 12345, symbol: "ETHUSDT", status: "CANCELED" });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).resolves.toBeUndefined();
  });

  // ── cancelAllOrders ───────────────────────────────────────────

  it("cancelAllOrders resolves on success", async () => {
    nock(BASE_URL)
      .delete("/fapi/v1/allOpenOrders")
      .query(matchAnyQuery)
      .reply(200, { code: 200, msg: "The operation of cancel all open order is done." });

    await expect(adapter.cancelAllOrders("ETH/USDT")).resolves.toBeUndefined();
  });

  // ── fetchPosition ─────────────────────────────────────────────

  it("fetchPosition returns position with data", async () => {
    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, [
        {
          symbol: "ETHUSDT",
          positionAmt: "0.5",
          entryPrice: "2400",
          unrealizedProfit: "100",
          leverage: "10",
          marginType: "cross",
          positionSide: "BOTH",
          updateTime: 1000,
        },
      ]);

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.symbol).toBe("ETH/USDT");
    expect(pos.side).toBe("long");
    expect(pos.qty).toBe(0.5);
    expect(pos.avgCost).toBe(2400);
  });

  it("fetchPosition parses unRealizedProfit from real positionRisk payload", async () => {
    // 真实 /fapi/v2/positionRisk 响应字段为 unRealizedProfit（大写 R），
    // 2026-06-12 测试网实测 payload，浮盈不得丢失为 0
    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, [
        {
          symbol: "ETHUSDT",
          positionAmt: "3.300",
          entryPrice: "1682.760327273",
          breakEvenPrice: "1683.24974962",
          markPrice: "1668.28000000",
          unRealizedProfit: "-47.78507999",
          liquidationPrice: "1078.88590733",
          leverage: "20",
          marginType: "cross",
          positionSide: "BOTH",
          updateTime: 1781279226008,
        },
      ]);

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.unrealizedPnl).toBeCloseTo(-47.78507999, 6);
  });

  it("fetchPosition returns empty position when no position", async () => {
    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, []);

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.side).toBe("none");
    expect(pos.qty).toBe(0);
  });

  // ── fetchBalance ──────────────────────────────────────────────

  it("fetchBalance returns balance", async () => {
    nock(BASE_URL)
      .get("/fapi/v2/account")
      .query(matchAnyQuery)
      .reply(200, {
        totalWalletBalance: "10000",
        totalMarginBalance: "9000",
        availableBalance: "5000",
        updateTime: 1000,
      });

    const balance = await adapter.fetchBalance();
    expect(balance.usdt).toBe(5000);
    expect(balance.totalEquity).toBe(9000);
  });

  // ── getMarketInfo ─────────────────────────────────────────────

  it("getMarketInfo returns symbol info with dynamic fees", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/exchangeInfo")
      .query(matchAnyQuery)
      .reply(200, {
        symbols: [
          {
            symbol: "ETHUSDT",
            contractType: "PERPETUAL",
            filters: [
              { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
              { filterType: "MIN_NOTIONAL", notional: "5" },
              { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "100000", tickSize: "0.1" },
            ],
          },
        ],
      });

    nock(BASE_URL)
      .get("/fapi/v1/commissionRate")
      .query(matchAnyQuery)
      .reply(200, {
        symbol: "ETHUSDT",
        makerCommissionRate: "0.00015",
        takerCommissionRate: "0.00045",
      });

    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.symbol).toBe("ETH/USDT");
    expect(info.rawSymbol).toBe("ETHUSDT");
    expect(info.minQty).toBe(0.001);
    expect(info.tickSize).toBe(0.1);
    expect(info.contractSize).toBe(1);
    expect(info.makerFeeRate).toBe(0.00015);
    expect(info.takerFeeRate).toBe(0.00045);
  });

  it("getMarketInfo falls back to default fees if commission API fails", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/exchangeInfo")
      .query(matchAnyQuery)
      .reply(200, {
        symbols: [
          {
            symbol: "ETHUSDT",
            contractType: "PERPETUAL",
            filters: [
              { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
            ],
          },
        ],
      });

    nock(BASE_URL)
      .get("/fapi/v1/commissionRate")
      .query(matchAnyQuery)
      .reply(400, { code: -1121, msg: "Invalid symbol." });

    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.makerFeeRate).toBe(0.0002);
    expect(info.takerFeeRate).toBe(0.0005);
  });

  // ── createAlgoOrder ───────────────────────────────────────────

  it("createAlgoOrder returns AlgoOrder on success", async () => {
    // Mock getMarketInfo for precision formatting
    nock(BASE_URL)
      .get("/fapi/v1/exchangeInfo")
      .query(matchAnyQuery)
      .reply(200, {
        symbols: [{
          symbol: "ETHUSDT",
          contractType: "PERPETUAL",
          filters: [
            { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", notional: "5" },
            { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "100000", tickSize: "0.1" },
          ],
        }],
      })
      .post("/fapi/v1/algoOrder")
      .query(matchAnyQuery)
      .reply(200, {
        algoId: 98765,
        symbol: "ETHUSDT",
        side: "BUY",
        algoType: "CONDITIONAL",
        type: "STOP_MARKET",
        triggerPrice: "2300",
        status: "NEW",
        origQty: "0.1",
        updateTime: 1000,
      });

    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo",
    });

    expect(algo.algoOrderId).toBe("98765");
    expect(algo.status).toBe("open");
    expect(algo.triggerPrice).toBe(2300);
  });

  it("createAlgoOrder closePosition 发 STOP_MARKET+closePosition、不带 quantity（reduce-only 平整仓、不反向开仓）", async () => {
    // 紧急止损必须按实时仓位平整仓、且永不反向开仓。Binance 的实现是
    // STOP_MARKET + closePosition=true（忽略数量、reduce-only），不可附带 quantity。
    let sentQuery: Record<string, string> = {};
    nock(BASE_URL)
      .get("/fapi/v1/exchangeInfo")
      .query(matchAnyQuery)
      .reply(200, {
        symbols: [{
          symbol: "ETHUSDT",
          contractType: "PERPETUAL",
          filters: [
            { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", notional: "5" },
            { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "100000", tickSize: "0.1" },
          ],
        }],
      })
      .post("/fapi/v1/algoOrder")
      .query((q) => {
        sentQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, {
        algoId: 98766,
        symbol: "ETHUSDT",
        side: "BUY",
        algoType: "CONDITIONAL",
        type: "STOP_MARKET",
        triggerPrice: "2920",
        status: "NEW",
        updateTime: 1000,
      });

    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2920,
      triggerCondition: "price_above",
      qty: 3.6,
      clientAlgoId: "test-close",
      closePosition: true,
    });

    expect(sentQuery.type).toBe("STOP_MARKET");
    expect(sentQuery.closePosition).toBe("true");
    expect(sentQuery.quantity).toBeUndefined();
  });

  it("createAlgoOrder formats precision correctly (non-decimal tickSize)", async () => {
    // Mock getMarketInfo with non-decimal tickSize=0.05, stepSize=0.001
    nock(BASE_URL)
      .get("/fapi/v1/exchangeInfo")
      .query(matchAnyQuery)
      .reply(200, {
        symbols: [{
          symbol: "ETHUSDT",
          contractType: "PERPETUAL",
          filters: [
            { filterType: "LOT_SIZE", minQty: "0.001", maxQty: "1000", stepSize: "0.001" },
            { filterType: "MIN_NOTIONAL", notional: "5" },
            { filterType: "PRICE_FILTER", minPrice: "0.1", maxPrice: "100000", tickSize: "0.05" },
          ],
        }],
      })
      .post("/fapi/v1/algoOrder")
      .query(matchAnyQuery)
      .reply(200, {
        algoId: 98766,
        symbol: "ETHUSDT",
        side: "SELL",
        algoType: "CONDITIONAL",
        type: "STOP_MARKET",
        triggerPrice: "2200",
        status: "NEW",
        origQty: "0.033",
        updateTime: 1001,
      });

    // Test with values that need formatting
    // triggerPrice: 2200.025 should round to 2200.05 with tickSize=0.05
    // qty: 0.03333 should floor to 0.033 with stepSize=0.001
    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "sell",
      triggerPrice: 2200.025, // should format to 2200.05
      triggerCondition: "price_below",
      qty: 0.03333, // should format to 0.033
      clientAlgoId: "test-algo-2",
    });

    expect(algo.algoOrderId).toBe("98766");
    expect(algo.status).toBe("open");
  });

  // ── cancelAlgoOrder ───────────────────────────────────────────

  it("cancelAlgoOrder resolves on success", async () => {
    nock(BASE_URL)
      .delete("/fapi/v1/algoOrder")
      .query(matchAnyQuery)
      .reply(200, { algoId: 98765, symbol: "ETHUSDT", status: "CANCELLED" });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAlgoOrder 把 -2011（订单不存在/已撤/已成交）视为幂等成功", async () => {
    // 撤单的目标状态是"该单不再活跃"，-2011 表示目标已达成（testnet 实测
    // 2026-06-12：撤不存在的 algoId 返回 -2011 "Unknown order sent."）。
    // 抛出会让 runner cancelWithRetry 空转 3 次——与 OKX 51400 同款处理。
    nock(BASE_URL)
      .delete("/fapi/v1/algoOrder")
      .query(matchAnyQuery)
      .reply(400, { code: -2011, msg: "Unknown order sent." });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAlgoOrder 其他错误码仍然抛出", async () => {
    nock(BASE_URL)
      .delete("/fapi/v1/algoOrder")
      .query(matchAnyQuery)
      .reply(400, { code: -1102, msg: "Mandatory parameter 'algoId' was not sent." });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).rejects.toMatchObject({
      code: "-1102",
    });
  });

  // ── fetchAlgoOrders ───────────────────────────────────────────

  it("fetchAlgoOrders returns pending algo orders", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/openAlgoOrders")
      .query(matchAnyQuery)
      .reply(200, [
        {
          algoId: 1,
          symbol: "ETHUSDT",
          side: "SELL",
          algoType: "CONDITIONAL",
          type: "STOP_MARKET",
          triggerPrice: "2500",
          status: "WORKING",
          origQty: "0.1",
          updateTime: 1000,
        },
      ]);

    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos).toHaveLength(1);
    expect(algos[0].algoOrderId).toBe("1");
    expect(algos[0].triggerCondition).toBe("price_below"); // SELL side maps to price_below
  });

  // ── setPositionMode ───────────────────────────────────────────

  it("setPositionMode sends correct dualSidePosition value", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/positionSide/dual")
      .query(matchAnyQuery)
      .reply(200, { code: 200, msg: "success" });

    await expect(adapter.setPositionMode(true)).resolves.toBeUndefined();
  });

  // ── getPositionMode ───────────────────────────────────────────

  it("getPositionMode returns correct mode", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/positionSide/dual")
      .query(matchAnyQuery)
      .reply(200, { dualSidePosition: true });

    const mode = await adapter.getPositionMode();
    expect(mode).toBe(false); // dualSidePosition=true means hedge mode, so oneWay=false
  });

  // ── setLeverage ───────────────────────────────────────────────

  it("setLeverage resolves on success", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/leverage")
      .query(matchAnyQuery)
      .reply(200, { symbol: "ETHUSDT", leverage: 10 });

    await expect(adapter.setLeverage("ETH/USDT", 10)).resolves.toBeUndefined();
  });

  // ── setMarginMode ─────────────────────────────────────────────

  it("setMarginMode sends CROSSED for cross margin", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/marginType")
      .query(matchAnyQuery)
      .reply(200, { code: 200, msg: "success" });

    await expect(adapter.setMarginMode("ETH/USDT", true)).resolves.toBeUndefined();
  });

  // ── getMarginMode ─────────────────────────────────────────────

  it("getMarginMode returns true for cross margin", async () => {
    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, [
        { symbol: "ETHUSDT", marginType: "cross", positionAmt: "0.1", entryPrice: "2400", unrealizedProfit: "0", leverage: "10", positionSide: "BOTH", updateTime: 1000 },
      ]);

    const mode = await adapter.getMarginMode("ETH/USDT");
    expect(mode).toBe(true);
  });

  // ── closePosition ─────────────────────────────────────────────

  it("closePosition places closePosition order", async () => {
    // Mock fetchPosition call to get current position
    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, [
        {
          positionAmt: '0.1',
          entryPrice: '2400',
        },
      ]);

    nock(BASE_URL)
      .post("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(200, {
        orderId: 999,
        symbol: "ETHUSDT",
        side: "SELL",
        type: "MARKET",
        status: "NEW",
        origQty: "0.1",
        executedQty: "0",
        avgPrice: "0",
        updateTime: 1000,
      });

    const order = await adapter.closePosition("ETH/USDT", "long");
    expect(order.side).toBe("sell");
    expect(order.type).toBe("market");
  });

  // ── fetchOpenOrders ───────────────────────────────────────────

  it("fetchOpenOrders returns open orders", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/openOrders")
      .query(matchAnyQuery)
      .reply(200, [
        {
          orderId: 1,
          clientOrderId: "c1",
          symbol: "ETHUSDT",
          side: "BUY",
          type: "LIMIT",
          origQty: "0.1",
          price: "2400",
          status: "NEW",
          executedQty: "0",
          avgPrice: "0",
          updateTime: 1000,
        },
      ]);

    const orders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("open");
  });

  it("createAlgoOrder 拒绝超 36 字符的 clientAlgoId（与其余三处守卫一致）", async () => {
    await expect(
      adapter.createAlgoOrder({
        symbol: "ETH/USDT",
        side: "buy",
        triggerPrice: 2300,
        triggerCondition: "price_above",
        qty: 0.1,
        clientAlgoId: "X".repeat(37),
      }),
    ).rejects.toMatchObject({ code: "CLIENT_ID_TOOLONG".replace("TOOLONG", "TOO_LONG") });
  });

  it("createOrder 拒绝超 36 字符的 clientOrderId（不静默截断）", async () => {
    await expect(
      adapter.createOrder({
        symbol: "ETH/USDT",
        side: "buy",
        type: "limit",
        qty: 0.1,
        price: 2000,
        clientOrderId: "X".repeat(25) + "260611071735" + "B99999",
      }),
    ).rejects.toMatchObject({ code: "CLIENT_ID_TOO_LONG" });
  });

  // ── fetchMyTrades ─────────────────────────────────────────────

  it("fetchMyTrades 用 allOrders 把 clientOrderId 拼回成交（userTrades 不带该字段）", async () => {
    // 模拟盘实测：条件单触发生成的订单 clientOrderId=clientAlgoId（传播成立），
    // 但 /fapi/v1/userTrades 回报无 clientOrderId。不拼回则 WS 错过时
    // 止损成交无法按 id 归属（algo 单不落库，byExchangeOrderId 也无行）。
    nock(BASE_URL)
      .get("/fapi/v1/userTrades")
      .query(matchAnyQuery)
      .reply(200, [
        { orderId: 14765383423, id: 502945619, symbol: "BTCUSDT", side: "BUY", qty: "0.001", price: "62950", commission: "0.01", commissionAsset: "USDT", time: 1000 },
      ]);
    nock(BASE_URL)
      .get("/fapi/v1/allOrders")
      .query(matchAnyQuery)
      .reply(200, [
        { orderId: 14765383423, clientOrderId: "BTCUSDT260611071735AE3k", symbol: "BTCUSDT", status: "FILLED" },
      ]);

    const fills = await adapter.fetchMyTrades("BTC/USDT", 0);
    expect(fills).toHaveLength(1);
    expect(fills[0].clientOrderId).toBe("BTCUSDT260611071735AE3k");
  });

  it("fetchMyTrades 在 allOrders 失败时返回原始成交（富化失败不阻断对账）", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/userTrades")
      .query(matchAnyQuery)
      .reply(200, [
        { orderId: 1, id: 2, symbol: "BTCUSDT", side: "SELL", qty: "0.001", price: "62950", time: 1000 },
      ]);
    nock(BASE_URL)
      .get("/fapi/v1/allOrders")
      .query(matchAnyQuery)
      .reply(500, { code: -1000, msg: "internal error" });

    const fills = await adapter.fetchMyTrades("BTC/USDT", 0);
    expect(fills).toHaveLength(1);
    expect(fills[0].clientOrderId).toBeUndefined();
  });

  // ── syncStateAfterReconnect ───────────────────────────────────

  it("syncStateAfterReconnect returns all state", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/openOrders")
      .query(matchAnyQuery)
      .reply(200, []);

    nock(BASE_URL)
      .get("/fapi/v1/openAlgoOrders")
      .query(matchAnyQuery)
      .reply(200, []);

    nock(BASE_URL)
      .get("/fapi/v2/positionRisk")
      .query(matchAnyQuery)
      .reply(200, []);

    const sync = await adapter.syncStateAfterReconnect("ETH/USDT");
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
  });

  // ── isImmediateTriggerError ───────────────────────────────────

  it("isImmediateTriggerError recognizes Binance error code -2021", () => {
    const err = new Error("order failed") as any;
    err.code = -2021;
    expect(adapter.isImmediateTriggerError(err)).toBe(true);

    const err2 = new Error("other error") as any;
    err2.code = -2015;
    expect(adapter.isImmediateTriggerError(err2)).toBe(false);
  });

  // ── ExchangeError retryable classification ────────────────────

  it("rate limit errors are marked retryable", async () => {
    nock(BASE_URL)
      .get("/fapi/v2/account")
      .query(matchAnyQuery)
      .reply(418, { code: -1003, msg: "Too many requests" });

    await expect(adapter.fetchBalance()).rejects.toThrow(ExchangeError);
  });

  it("post-only reject (-5022) has POST_ONLY_REJECT category", async () => {
    nock(BASE_URL)
      .post("/fapi/v1/order")
      .query(matchAnyQuery)
      .reply(400, { code: -5022, msg: "Due to the order is self-protection,order is rejected." });

    try {
      await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "post_only", qty: 0.1, price: 2400 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExchangeError);
      expect((err as ExchangeError).category).toBe(ErrorCategory.POST_ONLY_REJECT);
      expect((err as ExchangeError).isRetryable).toBe(false);
    }
  });

  // ── destroy ───────────────────────────────────────────────────

  it("destroy() is safe to call multiple times", () => {
    expect(() => adapter.destroy()).not.toThrow();
    expect(() => adapter.destroy()).not.toThrow();
  });

  // ── fetchFundingHistory ───────────────────────────────────────

  it("fetchFundingHistory 将 Binance income 行映射为 FundingFeeRecord[]", async () => {
    nock(BASE_URL)
      .get("/fapi/v1/income")
      .query(matchAnyQuery)
      .reply(200, [
        { symbol: "ETHUSDT", incomeType: "FUNDING_FEE", income: "-1.23", time: 1718000000000 },
      ]);

    const records = await adapter.fetchFundingHistory!("ETH/USDT", 0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      symbol: "ETH/USDT",
      fundingTime: 1718000000000,
      amount: -1.23,
    });
  });

  it("fetchFundingHistory 带 untilMs 时传递 endTime 参数", async () => {
    let capturedQuery: Record<string, string> = {};
    nock(BASE_URL)
      .get("/fapi/v1/income")
      .query((q) => {
        capturedQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, []);

    await adapter.fetchFundingHistory!("ETH/USDT", 1000, 2000);
    expect(capturedQuery.startTime).toBe("1000");
    expect(capturedQuery.endTime).toBe("2000");
  });

  it("fetchFundingHistory 不带 untilMs 时不传 endTime 参数", async () => {
    let capturedQuery: Record<string, string> = {};
    nock(BASE_URL)
      .get("/fapi/v1/income")
      .query((q) => {
        capturedQuery = q as Record<string, string>;
        return true;
      })
      .reply(200, []);

    await adapter.fetchFundingHistory!("ETH/USDT", 1000);
    expect(capturedQuery.startTime).toBe("1000");
    expect(capturedQuery.endTime).toBeUndefined();
  });
});

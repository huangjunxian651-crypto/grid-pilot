// gateio.adapter.unit.spec.ts — Gate.io adapter unit tests with nock
// Intercepts all HTTP requests via gate-api SDK (axios under the hood)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { GateioAdapter } from "./gateio.adapter";
import { ExchangeError, ErrorCategory } from "../../interfaces/exchange-adapter.interface";
import { GATEIO_REST_TESTNET, GATEIO_REST_LIVE } from "./gateio.types";

const BASE_URL = GATEIO_REST_TESTNET;

function createAdapter(): GateioAdapter {
  return new GateioAdapter({
    apiKey: "test-key",
    apiSecret: "test-secret",
    accountId: "test-gateio",
  });
}

describe("GateioAdapter", () => {
  let adapter: GateioAdapter;

  beforeEach(() => {
    adapter = createAdapter();
    nock.cleanAll();
  });

  afterEach(() => {
    adapter.destroy();
    nock.cleanAll();
  });

  // ── getTicker (REST) ──────────────────────────────────────────

  it("getTicker fetches REST ticker snapshot", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/tickers")
      .query({ contract: "ETH_USDT" })
      .reply(200, [
        {
          contract: "ETH_USDT",
          last: "2456.7",
          highest_bid: "2456.5",
          lowest_ask: "2456.9",
        },
      ]);

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
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
        maker_fee_rate: "0.0002",
        taker_fee_rate: "0.0005",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .reply(200, {
        id: 12345,
        text: "t-test-client-id",
        contract: "ETH_USDT",
        size: 1,
        price: "2400",
        tif: "gtc",
        status: "open",
        left: 1,
        fill_price: "0",
        create_time: 1,
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
    expect(order.clientOrderId).toBe("test-client-id");
    expect(order.symbol).toBe("ETH/USDT");
    expect(order.side).toBe("buy");
    expect(order.status).toBe("open");
  });

  // ── cancelOrder ───────────────────────────────────────────────

  it("cancelOrder resolves on success", async () => {
    nock(BASE_URL)
      .delete("/futures/usdt/orders/12345")
      .reply(200, { id: 12345, contract: "ETH_USDT", status: "finished", finish_as: "cancelled" });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).resolves.toBeUndefined();
  });

  // ── cancelAllOrders ───────────────────────────────────────────

  it("cancelAllOrders resolves on success", async () => {
    nock(BASE_URL)
      .delete("/futures/usdt/orders")
      .query(true)
      .reply(200, [{ id: 1, contract: "ETH_USDT", status: "finished", finish_as: "cancelled" }]);

    await expect(adapter.cancelAllOrders("ETH/USDT")).resolves.toBeUndefined();
  });

  // ── fetchPosition ─────────────────────────────────────────────

  it("fetchPosition returns position with data", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, {
        contract: "ETH_USDT",
        size: 10,
        entry_price: "2400",
        unrealised_pnl: "100",
        leverage: "10",
        update_time: 1,
      });

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.symbol).toBe("ETH/USDT");
    expect(pos.side).toBe("long");
    expect(pos.qty).toBe(0.01); // 10 contracts * 0.001
    expect(pos.avgCost).toBe(2400);
  });

  it("fetchPosition returns empty position when size is 0", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, {
        contract: "ETH_USDT",
        size: 0,
        entry_price: "0",
        unrealised_pnl: "0",
        leverage: "1",
        update_time: 1,
      });

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.side).toBe("none");
    expect(pos.qty).toBe(0);
  });

  // ── fetchBalance ──────────────────────────────────────────────

  it("fetchBalance returns balance", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, {
        available: "5000",
        total: "10000",
        position_mode: "single",
      });

    const balance = await adapter.fetchBalance();
    expect(balance.usdt).toBe(5000);
    expect(balance.totalEquity).toBe(10000);
  });

  it("fetchBalance totalEquity includes unrealised PnL (与 Binance/OKX 权益口径一致)", async () => {
    // Gate /futures/usdt/accounts 的 total 不含未实现盈亏,持仓期间权益恒定
    // (2026-06-13 实测三次检查 725.21 纹丝不动);须加上 unrealised_pnl
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, {
        available: "5000",
        total: "10000",
        unrealised_pnl: "123.45",
        position_mode: "single",
      });

    const balance = await adapter.fetchBalance();
    expect(balance.totalEquity).toBeCloseTo(10123.45, 6);
  });

  // ── getMarketInfo ─────────────────────────────────────────────

  it("getMarketInfo returns contract info", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
        maker_fee_rate: "0.0002",
        taker_fee_rate: "0.0005",
      });

    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.symbol).toBe("ETH/USDT");
    expect(info.rawSymbol).toBe("ETH_USDT");
    expect(info.contractSize).toBe(0.001);
    expect(info.tickSize).toBe(0.1);
    expect(info.makerFeeRate).toBe(0.0002);
    expect(info.takerFeeRate).toBe(0.0005);
  });

  // ── createAlgoOrder ───────────────────────────────────────────

  it("createAlgoOrder returns AlgoOrder on success", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .post("/futures/usdt/price_orders")
      .reply(200, {
        id: 98765,
        initial: { text: "t-test-algo-id", size: 1, close: false },
        trigger: { price: "2300", rule: 2 },
        status: "open",
        create_time: 1,
      });

    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo-id",
    });

    expect(algo.algoOrderId).toBe("98765");
    expect(algo.clientAlgoId).toBe("test-algo-id");
    expect(algo.triggerCondition).toBe("price_below");
    expect(algo.status).toBe("open");
  });

  it("createAlgoOrder closePosition 发 close=true、size=0（reduce-only 平整仓、不反向开仓）", async () => {
    // 紧急止损必须按实时仓位平整仓、且永不反向开仓。Gate 的实现是价格触发单
    // initial.close=true + size=0（按持仓平整仓、reduce-only），不指定开仓数量。
    let sentBody: { initial?: Record<string, unknown>; trigger?: Record<string, unknown> } = {};
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, { name: "ETH_USDT", quanto_multiplier: "0.001" });
    nock(BASE_URL)
      .post("/futures/usdt/price_orders", (body) => {
        sentBody = body as typeof sentBody;
        return true;
      })
      .reply(200, {
        id: 98766,
        initial: { text: "t-test-close", size: 0, close: true },
        trigger: { price: "2920", rule: 1 },
        status: "open",
        create_time: 1,
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

    expect(sentBody.initial?.close).toBe(true);
    expect(sentBody.initial?.size).toBe(0);
    // price_above ⇒ rule 1 (>=)：空头止损在触发价之上触发
    expect(sentBody.trigger?.rule).toBe(1);
  });

  it("createAlgoOrder 拒绝超长 text（与 createOrder 同样 fail-loud）", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, { name: "ETH_USDT", quanto_multiplier: "0.001" });

    await expect(
      adapter.createAlgoOrder({
        symbol: "ETH/USDT",
        side: "buy",
        triggerPrice: 2300,
        triggerCondition: "price_below",
        qty: 0.1,
        clientAlgoId: "ETHUSDT_260611071735_algo_emergency_3k2j",
      }),
    ).rejects.toMatchObject({ code: "CLIENT_ID_TOO_LONG" });
  });

  // ── cancelAlgoOrder ───────────────────────────────────────────

  it("cancelAlgoOrder resolves on success", async () => {
    nock(BASE_URL)
      .delete("/futures/usdt/price_orders/98765")
      .reply(200, { id: 98765, status: "inactive" });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAlgoOrder 把 AUTO_ORDER_NOT_FOUND 视为幂等成功", async () => {
    // 撤单的目标状态是"该单不再活跃"，AUTO_ORDER_NOT_FOUND 表示目标已达成
    // （testnet 实测 2026-06-12：撤不存在的 algoId 返回 HTTP 400 label=
    // AUTO_ORDER_NOT_FOUND）。抛出会让 runner cancelWithRetry 空转 3 次——
    // 与 OKX 51400 同款处理。
    nock(BASE_URL)
      .delete("/futures/usdt/price_orders/98765")
      .reply(400, { label: "AUTO_ORDER_NOT_FOUND", detail: "No order found with the given ID" });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAlgoOrder 其他错误 label 仍然抛出", async () => {
    nock(BASE_URL)
      .delete("/futures/usdt/price_orders/98765")
      .reply(400, { label: "INVALID_PARAM_VALUE", detail: "invalid id" });

    await expect(adapter.cancelAlgoOrder("98765", "ETH/USDT")).rejects.toMatchObject({
      code: "INVALID_PARAM_VALUE",
    });
  });

  // ── cancelAllAlgoOrders ───────────────────────────────────────

  it("cancelAllAlgoOrders resolves on success", async () => {
    nock(BASE_URL)
      .delete("/futures/usdt/price_orders")
      .query(true)
      .reply(200, []);

    await expect(adapter.cancelAllAlgoOrders("ETH/USDT")).resolves.toBeUndefined();
  });

  // ── fetchAlgoOrders ───────────────────────────────────────────

  it("fetchAlgoOrders returns pending algo orders", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .get("/futures/usdt/price_orders")
      .query(true)
      .reply(200, [
        {
          id: 1,
          initial: { text: "t-clientalgo", size: -1, close: false },
          trigger: { price: "2500", rule: 1 },
          status: "open",
          create_time: 1,
        },
      ]);

    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos).toHaveLength(1);
    expect(algos[0].algoOrderId).toBe("1");
    expect(algos[0].clientAlgoId).toBe("clientalgo");
    expect(algos[0].side).toBe("sell"); // negative size
    expect(algos[0].triggerCondition).toBe("price_above"); // rule 1
  });

  // ── setPositionMode ───────────────────────────────────────────

  it("setPositionMode resolves on success", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, { position_mode: "single", available: "5000", total: "10000" });
    nock(BASE_URL)
      .post("/futures/usdt/set_position_mode")
      .query({ position_mode: "single" })
      .reply(200, {});

    await expect(adapter.setPositionMode(true)).resolves.toBeUndefined();
  });

  it("setPositionMode resolves for dual mode", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, { position_mode: "dual", available: "5000", total: "10000" });
    nock(BASE_URL)
      .post("/futures/usdt/set_position_mode")
      .query({ position_mode: "dual" })
      .reply(200, {});

    await expect(adapter.setPositionMode(false)).resolves.toBeUndefined();
  });

  // ── getPositionMode ───────────────────────────────────────────

  it("getPositionMode returns true for single mode", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, { position_mode: "single", available: "5000", total: "10000" });

    const mode = await adapter.getPositionMode();
    expect(mode).toBe(true);
  });

  it("getPositionMode returns false for dual mode", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, { position_mode: "dual", available: "5000", total: "10000" });

    const mode = await adapter.getPositionMode();
    expect(mode).toBe(false);
  });

  // ── setLeverage ───────────────────────────────────────────────

  it("setLeverage resolves on success", async () => {
    nock(BASE_URL)
      .post("/futures/usdt/positions/ETH_USDT/leverage")
      .query({ leverage: "10" })
      .reply(200, { leverage: "10" });

    await expect(adapter.setLeverage("ETH/USDT", 10)).resolves.toBeUndefined();
  });

  // ── setMarginMode ─────────────────────────────────────────────

  it("setMarginMode resolves on success", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/accounts")
      .reply(200, { position_mode: "single", available: "5000", total: "10000" });
    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, { margin_mode: "cross", maintenance_rate: "0.005", value: "1000" });
    nock(BASE_URL)
      .post("/futures/usdt/positions/cross_mode")
      .reply(200, { margin_mode: "cross" });

    await expect(adapter.setMarginMode("ETH/USDT", true)).resolves.toBeUndefined();
  });

  // ── getMarginMode ─────────────────────────────────────────────

  it("getMarginMode returns true for cross margin", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, {
        contract: "ETH_USDT",
        size: 0,
        pos_margin_mode: "cross",
      });

    const mode = await adapter.getMarginMode("ETH/USDT");
    expect(mode).toBe(true);
  });

  it("getMarginMode returns false for isolated margin", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, {
        contract: "ETH_USDT",
        size: 0,
        pos_margin_mode: "isolated",
      });

    const mode = await adapter.getMarginMode("ETH/USDT");
    expect(mode).toBe(false);
  });

  // ── closePosition ─────────────────────────────────────────────

  it("closePosition places close order", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .reply(200, {
        id: 999,
        contract: "ETH_USDT",
        size: 0,
        close: true,
        status: "open",
        create_time: 1,
      });

    const order = await adapter.closePosition("ETH/USDT", "long");
    expect(order.orderId).toBe("999");
  });

  // ── fetchOpenOrders ───────────────────────────────────────────

  it("fetchOpenOrders returns open orders", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .get("/futures/usdt/orders")
      .query(true)
      .reply(200, [
        {
          id: 1,
          text: "t-client1",
          contract: "ETH_USDT",
          size: 1,
          price: "2400",
          tif: "gtc",
          status: "open",
          left: 1,
          create_time: 1,
        },
      ]);

    const orders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe("open");
  });

  // ── syncStateAfterReconnect ───────────────────────────────────

  it("syncStateAfterReconnect returns all state", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .times(3)
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
      });

    nock(BASE_URL)
      .get("/futures/usdt/orders")
      .query(true)
      .reply(200, []);

    nock(BASE_URL)
      .get("/futures/usdt/price_orders")
      .query(true)
      .reply(200, []);

    nock(BASE_URL)
      .get("/futures/usdt/positions/ETH_USDT")
      .reply(200, {
        contract: "ETH_USDT",
        size: 0,
        update_time: 1,
      });

    const sync = await adapter.syncStateAfterReconnect("ETH/USDT");
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
  });

  // ── isImmediateTriggerError ───────────────────────────────────

  it("isImmediateTriggerError recognizes Gate.io trigger errors", () => {
    expect(adapter.isImmediateTriggerError(new Error("AUTO_TRIGGER_PRICE_GREATE_MARK"))).toBe(true);
    expect(adapter.isImmediateTriggerError(new Error("AUTO_TRIGGER_PRICE_LESS_MARK"))).toBe(true);
    expect(adapter.isImmediateTriggerError(new Error("unrelated error"))).toBe(false);
  });

  it("POC rejection has POST_ONLY_REJECT category", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .replyWithError("Post only order would match");

    try {
      await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "post_only", qty: 0.1, price: 2400 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExchangeError);
      expect((err as ExchangeError).category).toBe(ErrorCategory.POST_ONLY_REJECT);
    }
  });

  // 线上真实报文：Gate.io 期货 POC(post-only) 立即成交被拒，label=ORDER_POC_IMMEDIATE，
  // detail 形如 "order price X while counter price Y"——既无 "post only" 也无 "match"。
  // 旧分类正则 (/poc/ && /match/) 漏判 → 上层跳过优雅 POC 重试/GTC 降级 → 退避停摆。
  it("POC rejection (real ORDER_POC_IMMEDIATE label) has POST_ONLY_REJECT category", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .reply(400, {
        label: "ORDER_POC_IMMEDIATE",
        detail: "order price 1735 while counter price 1735.1",
      });

    try {
      await adapter.createOrder({ symbol: "ETH/USDT", side: "sell", type: "post_only", qty: 0.1, price: 1735 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExchangeError);
      expect((err as ExchangeError).category).toBe(ErrorCategory.POST_ONLY_REJECT);
    }
  });

  // 同源隐患：POC(post-only) 立即成交时 Gate 也可能以 HTTP 200 + finish_as=poc 静默撤单
  // （而非 400）。若不识别，这张已死的单会被映射成 partial→PLACED，runner 误登记为幽灵挂单。
  // 必须与 400 路径一致抛 POST_ONLY_REJECT，让上层走 pocRetryLoop/降级 GTC。
  it("createOrder throws POST_ONLY_REJECT on HTTP 200 finish_as=poc (silent post-only cancel)", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .reply(200, {
        id: 999,
        contract: "ETH_USDT",
        size: -1,
        price: "1735",
        tif: "poc",
        status: "finished",
        finish_as: "poc",
        left: -1,
        fill_price: "0",
        create_time: 1,
      });

    try {
      await adapter.createOrder({ symbol: "ETH/USDT", side: "sell", type: "post_only", qty: 0.1, price: 1735 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExchangeError);
      expect((err as ExchangeError).category).toBe(ErrorCategory.POST_ONLY_REJECT);
    }
  });

  it("createOrder surfaces Gate.io error label+detail from 400 body", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
      });

    nock(BASE_URL)
      .post("/futures/usdt/orders")
      .reply(400, {
        label: "INVALID_PARAM_VALUE",
        detail: "size 0 is too small, min order size is 1",
      });

    try {
      await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ExchangeError);
      const e = err as ExchangeError;
      // 真正的下单被拒原因必须出现在 message 中，否则无从调试
      expect(e.message).toContain("INVALID_PARAM_VALUE");
      expect(e.message).toContain("size 0 is too small");
      expect(e.code).toBe("INVALID_PARAM_VALUE");
    }
  });

  it("createOrder 在 text 超 30 字符时 fail-loud 抛错（不静默）", async () => {
    nock(BASE_URL)
      .get("/futures/usdt/contracts/ETH_USDT")
      .reply(200, {
        name: "ETH_USDT",
        quanto_multiplier: "0.001",
        order_size_min: "1",
        order_price_round: "0.1",
      });
    // 不为 POST /orders 设置 nock：若断言生效，请求根本不应发出。

    const longId = "X".repeat(29); // t- + 29 = 31 > 30
    await expect(
      adapter.createOrder({
        symbol: "ETH/USDT",
        side: "buy",
        type: "limit",
        qty: 0.1,
        price: 2400,
        clientOrderId: longId,
      }),
    ).rejects.toThrow(/text.*30|长度|length/i);
  });

  // ── destroy ───────────────────────────────────────────────────

  it("destroy() is safe to call multiple times", () => {
    expect(() => adapter.destroy()).not.toThrow();
    expect(() => adapter.destroy()).not.toThrow();
  });
});

import { mapGateioBookTickerFrame } from './gateio.adapter';

describe('mapGateioBookTickerFrame — book_ticker 帧映射（0 价帧曾致 LONG 机器人秒清算）', () => {
  it('有效 update 帧映射为 Ticker（lastPrice 取 ask）', () => {
    const ticker = mapGateioBookTickerFrame('ETH/USDT', { b: '1675.10', a: '1675.20' });
    expect(ticker).not.toBeNull();
    expect(ticker!.bestBid).toBe(1675.1);
    expect(ticker!.bestAsk).toBe(1675.2);
    expect(ticker!.lastPrice).toBe(1675.2);
  });

  it('订阅确认帧（无 b/a 字段）返回 null 而非 0 价 Ticker', () => {
    expect(mapGateioBookTickerFrame('ETH/USDT', { status: 'success' } as Record<string, string>)).toBeNull();
  });

  it('字段为 0 或非数字返回 null', () => {
    expect(mapGateioBookTickerFrame('ETH/USDT', { b: '0', a: '0' })).toBeNull();
    expect(mapGateioBookTickerFrame('ETH/USDT', { b: 'abc', a: 'def' })).toBeNull();
  });
});

describe("GateioAdapter environment routing", () => {
  afterEach(() => nock.cleanAll());

  it("live targets GATEIO_REST_LIVE for the REST ticker fallback", async () => {
    const adapter = new GateioAdapter({ apiKey: "k", apiSecret: "s", accountId: "a", environment: "live" });
    const liveScope = nock(GATEIO_REST_LIVE)
      .get("/futures/usdt/tickers")
      .query({ contract: "ETH_USDT" })
      .reply(200, [{ contract: "ETH_USDT", last: "2500", highest_bid: "2499", lowest_ask: "2501" }]);
    await adapter.getTicker("ETH/USDT");
    expect(liveScope.isDone()).toBe(true);
  });
});

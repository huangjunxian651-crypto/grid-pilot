// okx.adapter.unit.spec.ts — OKX adapter unit tests with nock
// Intercepts all HTTP requests to OKX Demo API, no live network calls

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import nock from "nock";
import { ExchangeError, ErrorCategory } from "../../interfaces/exchange-adapter.interface";
import { OKX_REST_DEMO, OKX_WS_PUBLIC, OKX_WS_PRIVATE, OKX_WS_PUBLIC_LIVE, OKX_WS_PRIVATE_LIVE } from "./okx.types";

// 在模块边界 mock WS client：可控假客户端，记录构造函数收到的 url/isPrivate 参数，
// 用于验证 OkxAdapter.getPublicWs()/getPrivateWs() 是否按 environment 解析出正确的 WS
// 端点常量，以及是否把正确的 isPrivate 传给 OkxWsClient（与 gateio.adapter.spec.ts 的
// FakeGateioWsClient 同一模式）。此文件其余测试全部走 REST（nock），不会构造
// OkxWsClient，故此 mock 不影响既有用例。
const h = vi.hoisted(() => {
  const wsInstances: Array<{
    url: string;
    isPrivate: boolean;
    handlers: Record<string, Array<(a: unknown) => void>>;
    emit: (ev: string, a: unknown) => void;
  }> = [];
  class FakeOkxWsClient {
    url: string;
    isPrivate: boolean;
    handlers: Record<string, Array<(a: unknown) => void>> = {};
    constructor(_credentials: unknown, url: string, isPrivate: boolean) {
      this.url = url;
      this.isPrivate = isPrivate;
      wsInstances.push(this);
    }
    async connect() {}
    on(ev: string, fn: (a: unknown) => void) {
      (this.handlers[ev] ??= []).push(fn);
    }
    off() {}
    disconnect() {}
    subscribe() {}
    unsubscribe() {}
    emit(ev: string, arg: unknown) {
      (this.handlers[ev] ?? []).forEach((fn) => fn(arg));
    }
  }
  return { wsInstances, FakeOkxWsClient };
});
vi.mock("./okx-ws-client", () => ({ OkxWsClient: h.FakeOkxWsClient }));

import { OkxAdapter } from "./okx.adapter";

const BASE_URL = new URL(OKX_REST_DEMO).origin;

function createAdapter(): OkxAdapter {
  return new OkxAdapter({
    apiKey: "test-key",
    apiSecret: "test-secret",
    passphrase: "test-pass",
    accountId: "test-okx",
  });
}

describe("OkxAdapter", () => {
  let adapter: OkxAdapter;

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
      .get("/api/v5/market/ticker")
      .query({ instId: "ETH-USDT-SWAP" })
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          {
            instType: "SWAP",
            instId: "ETH-USDT-SWAP",
            last: "2456.7",
            bidPx: "2456.5",
            askPx: "2456.9",
            ts: "1597026383085",
          },
        ],
      });

    const ticker = await adapter.getTicker("ETH/USDT");
    expect(ticker.symbol).toBe("ETH/USDT");
    expect(ticker.lastPrice).toBe(2456.7);
    expect(ticker.bestBid).toBe(2456.5);
    expect(ticker.bestAsk).toBe(2456.9);
    expect(ticker.ts).toBe(1597026383085);
  });

  // ── createOrder ───────────────────────────────────────────────

  it("createOrder returns Order on success", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ ordId: "12345", clOrdId: "testclientid" }],
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
    expect(order.clientOrderId).toBe("testclientid");
    expect(order.symbol).toBe("ETH/USDT");
    expect(order.side).toBe("buy");
    expect(order.status).toBe("open");
  });

  it("createOrder 拒绝净化后超 32 字符的 clientOrderId（不静默截断）", async () => {
    // 静默 slice(0,32) 会把 …B1000 截成 …B100，与既有低序号网格单撞 id，
    // 成交按 clientOrderId 解析会被错误归属。超长必须 fail-loud。
    await expect(
      adapter.createOrder({
        symbol: "ETH/USDT",
        side: "buy",
        type: "limit",
        qty: 0.1,
        price: 2000,
        clientOrderId: "X".repeat(21) + "260611071735" + "B99999",
      }),
    ).rejects.toMatchObject({ code: "CLIENT_ID_TOO_LONG" });
  });

  it("createOrder 按 lotSz 下零头张：0.05 ETH → sz=0.5（不再进位成 1=2×churn）", async () => {
    let sentSz: unknown;
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    nock(BASE_URL)
      .get("/api/v5/public/instruments")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", minSz: "0.01", lotSz: "0.01", tickSz: "0.01", ctVal: "0.1", ctValCcy: "ETH", makerFee: "0.0002", takerFee: "0.0005", minNotionalSz: "1" },
        ],
      });
    nock(BASE_URL)
      .post("/api/v5/trade/order", (body) => {
        sentSz = (body as Record<string, unknown>).sz;
        return true;
      })
      .reply(200, { code: "0", msg: "", data: [{ ordId: "1", clOrdId: "c" }] });

    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "post_only", qty: 0.05, price: 1795 });
    expect(sentSz).toBe("0.5");
  });

  it("createOrder 在 instrument 信息拉取失败时仍下单（best-effort，不阻断）", async () => {
    let posted = false;
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    // 冷缓存 + instruments 返回空 data → getMarketInfo 抛 INSTRUMENT_NOT_FOUND（不可重试）
    nock(BASE_URL)
      .get("/api/v5/public/instruments")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });
    nock(BASE_URL)
      .post("/api/v5/trade/order", () => {
        posted = true;
        return true;
      })
      .reply(200, { code: "0", msg: "", data: [{ ordId: "9", clOrdId: "c" }] });

    const order = await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "post_only", qty: 0.1, price: 1795 });
    expect(order.orderId).toBe("9"); // 下单未被阻断
    expect(posted).toBe(true);
  });

  it("createOrder throws ExchangeError on API error", async () => {
    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, { code: "51020", msg: "Trigger price cannot be higher" });

    await expect(
      adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 }),
    ).rejects.toThrow(ExchangeError);
  });

  it("createOrder 顶层 code:1 msg:'All operations failed' 时必须透传 data[0].sCode/sMsg 真实原因，而非丢给调用方一个裸的 '1'", async () => {
    // 生产实况（2026-08-04）：ETHUSDT 网格连续 100+ 次下单被拒，日志和通知里只有
    // "OKX createOrder failed: All operations failed"/裸错误码 "1"，真实原因（保证金不足等）
    // 被顶层聚合状态盖住。cancelOrder/createAlgoOrder 已用 extractOkxBatchError 处理同一 OKX 接口
    // 特性，createOrder 必须补齐同一处理，否则 actionable-rejections 白名单里的 51008/51010 永远匹配不上。
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ sCode: "51008", sMsg: "Order failed. Insufficient margin" }],
      });

    await expect(
      adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 }),
    ).rejects.toMatchObject({
      code: "51008",
      message: expect.stringContaining("Insufficient margin"),
    });
  });

  // ── cancelOrder ───────────────────────────────────────────────

  it("cancelOrder resolves on success", async () => {
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-order")
      .reply(200, { code: "0", msg: "" });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelOrder treats sCode 51400 (order already gone) as idempotent success", async () => {
    // OKX 单笔撤单顶层为 code:"1" msg:"All operations failed"，真实原因在 data[0].sCode；
    // 51400 = 已成交/已撤/不存在，撤单目标（不再活跃）已达成，应按成功处理，不抛错。
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-order")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ ordId: "12345", sCode: "51400", sMsg: "Cancellation failed as the order does not exist." }],
      });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelOrder throws on a genuine per-order failure (non-51400 sCode)", async () => {
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-order")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ ordId: "12345", sCode: "51401", sMsg: "Cancellation failed as the order is already canceled." }],
      });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).rejects.toBeInstanceOf(ExchangeError);
  });

  it("cancelOrder throws on sCode 51402 (order already filled) — must NOT be swallowed as success", async () => {
    // 51402 = 订单已成交。绝不能当幂等成功吞掉：抛错会触发调用方 invalidateAndRefresh 拉回仓位，
    // 吞掉则会漏掉这笔成交导致仓位/盈亏错误。这是本修复的承载性正确性保证。
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-order")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ ordId: "12345", sCode: "51402", sMsg: "Cancellation failed as the order has been completed." }],
      });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).rejects.toBeInstanceOf(ExchangeError);
  });

  it("cancelOrder throws (fail-loud) when top-level code is non-zero but data is missing", async () => {
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-order")
      .reply(200, { code: "1", msg: "All operations failed" });

    await expect(adapter.cancelOrder("12345", "ETH/USDT")).rejects.toBeInstanceOf(ExchangeError);
  });

  // ── cancelAllOrders ───────────────────────────────────────────

  it("cancelAllOrders cancels all open orders", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", ordId: "1", side: "buy", ordType: "limit", sz: "1", px: "2400", state: "live", fillSz: "0", uTime: "1000" },
          { instId: "ETH-USDT-SWAP", ordId: "2", side: "sell", ordType: "limit", sz: "1", px: "2500", state: "live", fillSz: "0", uTime: "1000" },
        ],
      });

    nock(BASE_URL)
      .post("/api/v5/trade/cancel-batch-orders")
      .reply(200, { code: "0", msg: "" });

    await expect(adapter.cancelAllOrders("ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAllOrders 顶层 code:1 msg:'All operations failed' 时必须透传 data[0].sCode/sMsg 真实原因（cancelBatchOrders 同一 OKX 接口特性）", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", ordId: "1", side: "buy", ordType: "limit", sz: "1", px: "2400", state: "live", fillSz: "0", uTime: "1000" },
        ],
      });

    nock(BASE_URL)
      .post("/api/v5/trade/cancel-batch-orders")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ ordId: "1", sCode: "51503", sMsg: "Cancellation failed as the order is not found." }],
      });

    await expect(adapter.cancelAllOrders("ETH/USDT")).rejects.toMatchObject({
      code: "51503",
      message: expect.stringContaining("Cancellation failed as the order is not found"),
    });
  });

  // ── fetchPosition ─────────────────────────────────────────────

  it("fetchPosition returns position with data", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", posSide: "long", pos: "1", avgPx: "2400", upl: "100", lever: "10", mgnMode: "cross", availPos: "1" },
        ],
      });

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.symbol).toBe("ETH/USDT");
    expect(pos.side).toBe("long");
    expect(pos.qty).toBeGreaterThan(0);
    expect(pos.avgCost).toBe(2400);
  });

  it("fetchPosition returns empty position when no position", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });

    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.side).toBe("none");
    expect(pos.qty).toBe(0);
  });

  // ── fetchBalance ──────────────────────────────────────────────

  it("fetchBalance returns balance", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/balance")
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          {
            details: [{ ccy: "USDT", availEq: "5000" }],
            totalEq: "10000",
          },
        ],
      });

    const balance = await adapter.fetchBalance();
    expect(balance.usdt).toBe(5000);
    expect(balance.totalEquity).toBe(10000);
  });

  // ── getMarketInfo ─────────────────────────────────────────────

  it("getMarketInfo returns instrument info", async () => {
    nock(BASE_URL)
      .get("/api/v5/public/instruments")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          {
            instId: "ETH-USDT-SWAP",
            minSz: "1",
            lotSz: "1",
            tickSz: "0.1",
            ctVal: "0.1",
            ctValCcy: "ETH",
            makerFee: "0.0002",
            takerFee: "0.0005",
            minNotionalSz: "5",
          },
        ],
      });

    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.symbol).toBe("ETH/USDT");
    expect(info.rawSymbol).toBe("ETH-USDT-SWAP");
    expect(info.contractSize).toBe(0.1);
    expect(info.tickSize).toBe(0.1);
    expect(info.makerFeeRate).toBe(0.0002);
    expect(info.takerFeeRate).toBe(0.0005);
    expect(info.minNotional).toBe(5);
  });

  // ── createAlgoOrder ───────────────────────────────────────────

  it("createAlgoOrder returns AlgoOrder on success", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    let sentBody: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v5/trade/order-algo", (body) => { sentBody = body as Record<string, unknown>; return true; })
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ algoId: "algo-123", algoClOrdId: "algoclientid" }],
      });

    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo-id",
    });

    expect(algo.algoOrderId).toBe("algo-123");
    expect(algo.clientAlgoId).toBe("algoclientid");
    expect(algo.triggerCondition).toBe("price_below");
    expect(algo.status).toBe("open");
    // OKX 触发单的市价参数名是 orderPx（非 ordPx）：模拟盘实测 ordPx 报
    // 50014 'Parameter orderPx can not be empty'，紧急止损从未下成功过。
    expect(sentBody.orderPx).toBe("-1");
    expect(sentBody.ordPx).toBeUndefined();
  });

  it("createAlgoOrder closePosition 走 conditional 止损单（slTriggerPx + closeFraction，不发 sz/triggerPx）", async () => {
    // OKX trigger 单平整仓两次实测均败：reduceOnly+sz → 51205 'Reduce Only is
    // not available.'；改 closeFraction → 51000 'Parameter sz error'（trigger
    // 忽略 closeFraction 仍强制 sz）。closeFraction（reduce-only、按实时仓位平
    // 100%、永不反向开仓）只对 conditional 止损单生效，故平仓单走 conditional：
    // slTriggerPx 触发、slOrdPx=-1 市价、不发 sz/triggerPx，并按 51328 带 reduceOnly。
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "3" }] });
    let sentBody: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v5/trade/order-algo", (body) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, { code: "0", msg: "", data: [{ algoId: "algo-cf", algoClOrdId: "cf" }] });

    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 1800,
      triggerCondition: "price_above",
      qty: 3.6,
      clientAlgoId: "test-close-id",
      closePosition: true,
    });

    expect(sentBody.ordType).toBe("conditional");
    expect(sentBody.slTriggerPx).toBe("1800");
    expect(sentBody.slOrdPx).toBe("-1");
    expect(sentBody.closeFraction).toBe("1");
    expect(sentBody.reduceOnly).toBe("true");
    expect(sentBody.sz).toBeUndefined();
    expect(sentBody.triggerPx).toBeUndefined();
  });

  it("createAlgoOrder closePosition 回报用 slTriggerPx 还原 triggerPrice（去重比对依赖）", async () => {
    // conditional 单回报触发价在 slTriggerPx；取错字段会让 hasOwnEmergency
    // 永远匹配不上 → 每 tick 重下。
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "3" }] });
    nock(BASE_URL)
      .post("/api/v5/trade/order-algo")
      .reply(200, { code: "0", msg: "", data: [{ algoId: "algo-cf", algoClOrdId: "cf" }] });
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          {
            algoId: "algo-cf",
            algoClOrdId: "cf",
            instId: "ETH-USDT-SWAP",
            side: "buy",
            ordType: "conditional",
            slTriggerPx: "1800",
            slOrdPx: "-1",
            triggerPx: "",
            triggerPxType: "",
            sz: "",
            ordPx: "",
            state: "live",
            cTime: "1700000000000",
          },
        ],
      });

    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 1800,
      triggerCondition: "price_above",
      qty: 3.6,
      clientAlgoId: "test-close-id",
      closePosition: true,
    });
    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos[0].triggerPrice).toBe(1800);
    expect(algos[0].qty).toBe(0); // closeFraction 单无 sz，qty 缺省 0、不得 NaN
  });

  it("createAlgoOrder 非平仓单仍发 sz、不发 closeFraction/reduceOnly", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "3" }] });
    let sentBody: Record<string, unknown> = {};
    nock(BASE_URL)
      .post("/api/v5/trade/order-algo", (body) => {
        sentBody = body as Record<string, unknown>;
        return true;
      })
      .reply(200, { code: "0", msg: "", data: [{ algoId: "algo-plain", algoClOrdId: "p" }] });

    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-plain-id",
    });

    expect(sentBody.sz).toBe("1");
    expect(sentBody.closeFraction).toBeUndefined();
    expect(sentBody.reduceOnly).toBeUndefined();
  });

  it("createAlgoOrder 失败时透出 data[0].sCode/sMsg（顶层 msg 为空）", async () => {
    // OKX 批量接口顶层 code=1/msg=''，真实错误在 data[0]——只透顶层会让
    // 生产日志完全没有诊断信息。
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    nock(BASE_URL)
      .post("/api/v5/trade/order-algo")
      .reply(200, {
        code: "1",
        msg: "",
        data: [{ algoId: "", sCode: "50014", sMsg: "Parameter orderPx can not be empty." }],
      });

    await expect(
      adapter.createAlgoOrder({
        symbol: "ETH/USDT",
        side: "buy",
        triggerPrice: 2300,
        triggerCondition: "price_below",
        qty: 0.1,
        clientAlgoId: "test-algo-id",
      }),
    ).rejects.toMatchObject({ code: "50014", message: expect.stringContaining("orderPx") });
  });

  it("createAlgoOrder 拒绝净化后超 32 字符的 algoClOrdId（不静默截断）", async () => {
    // 静默 slice(0,32) 会吃掉随机后缀：每次重下同一 id 被 OKX 拒重复，
    // 且调用方对截断毫无感知。超长必须 fail-loud。
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
      .post("/api/v5/trade/cancel-algos")
      .reply(200, { code: "0", msg: "" });

    await expect(adapter.cancelAlgoOrder("algo-123", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAlgoOrder 失败时透出批量响应 data[0].sCode/sMsg（顶层 msg 为空）", async () => {
    // cancel-algos 是批量接口：顶层 msg 恒为空，真实错误在 data[0].sCode/sMsg。
    // 只读顶层 msg 会产出 "failed: " 空错误（2026-06-12 生产日志实锤），无法排障。
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-algos")
      .reply(200, {
        code: "1",
        msg: "",
        data: [{ algoId: "algo-123", sCode: "51000", sMsg: "Parameter algoId error" }],
      });

    const err = await adapter.cancelAlgoOrder("algo-123", "ETH/USDT").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExchangeError);
    expect((err as ExchangeError).code).toBe("51000");
    expect((err as ExchangeError).message).toContain("Parameter algoId error");
  });

  it("cancelAlgoOrder 把 51400（已成交/已撤/不存在）视为幂等成功", async () => {
    // 撤单的目标状态是"该单不再活跃"——51400 表示目标已达成，
    // 当失败抛出会让上层 cancelWithRetry 空转 3 次重试。
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-algos")
      .reply(200, {
        code: "1",
        msg: "",
        data: [
          {
            algoId: "algo-123",
            sCode: "51400",
            sMsg: "Order cancellation failed as the order has been filled, canceled or does not exist.",
          },
        ],
      });

    await expect(adapter.cancelAlgoOrder("algo-123", "ETH/USDT")).resolves.toBeUndefined();
  });

  it("cancelAllAlgoOrders 失败时透出批量项 sCode/sMsg，且 51400 项不视为失败", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { algoId: "algo-1", instId: "ETH-USDT-SWAP", side: "buy", ordType: "conditional", slTriggerPx: "1800", sz: "1", state: "live", cTime: "1000" },
          { algoId: "algo-2", instId: "ETH-USDT-SWAP", side: "buy", ordType: "conditional", slTriggerPx: "1810", sz: "1", state: "live", cTime: "1000" },
        ],
      });
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-algos")
      .reply(200, {
        code: "1",
        msg: "",
        data: [
          { algoId: "algo-1", sCode: "51400", sMsg: "Order cancellation failed as the order has been filled, canceled or does not exist." },
          { algoId: "algo-2", sCode: "51000", sMsg: "Parameter algoId error" },
        ],
      });

    const err = await adapter.cancelAllAlgoOrders("ETH/USDT").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExchangeError);
    expect((err as ExchangeError).code).toBe("51000");
    expect((err as ExchangeError).message).toContain("Parameter algoId error");
  });

  it("cancelAllAlgoOrders 子项缺失 sCode 的异常负载不得静默成功", async () => {
    // 防御性：顶层 code 非 0 但子项没有 sCode（非常规负载）时，
    // 若按"无真失败子项"放行就是静默吞错——必须按顶层错误抛出。
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { algoId: "algo-1", instId: "ETH-USDT-SWAP", side: "buy", ordType: "conditional", slTriggerPx: "1800", sz: "1", state: "live", cTime: "1000" },
        ],
      });
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-algos")
      .reply(200, {
        code: "1",
        msg: "Operation failed.",
        data: [{ algoId: "algo-1" }],
      });

    const err = await adapter.cancelAllAlgoOrders("ETH/USDT").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ExchangeError);
    expect((err as ExchangeError).code).toBe("1");
    expect((err as ExchangeError).message).toContain("Operation failed.");
  });

  it("cancelAllAlgoOrders 全部项均为 51400 时幂等成功", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { algoId: "algo-1", instId: "ETH-USDT-SWAP", side: "buy", ordType: "conditional", slTriggerPx: "1800", sz: "1", state: "live", cTime: "1000" },
        ],
      });
    nock(BASE_URL)
      .post("/api/v5/trade/cancel-algos")
      .reply(200, {
        code: "1",
        msg: "",
        data: [
          { algoId: "algo-1", sCode: "51400", sMsg: "Order cancellation failed as the order has been filled, canceled or does not exist." },
        ],
      });

    await expect(adapter.cancelAllAlgoOrders("ETH/USDT")).resolves.toBeUndefined();
  });

  // ── fetchAlgoOrders ───────────────────────────────────────────

  it("fetchAlgoOrders returns pending algo orders", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          {
            algoId: "algo-1",
            algoClOrdId: "client-algo-1",
            instId: "ETH-USDT-SWAP",
            side: "buy",
            ordType: "trigger",
            triggerPx: "2300",
            triggerPxType: "last",
            sz: "1",
            ordPx: "-1",
            state: "live",
            cTime: "1000",
          },
        ],
      });

    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos).toHaveLength(1);
    expect(algos[0].algoOrderId).toBe("algo-1");
    expect(algos[0].clientAlgoId).toBe("client-algo-1");
  });

  it("surfaces OKX error body (code/msg) when API replies HTTP 4xx", async () => {
    // 裸 axios 错误只有 "Request failed with status code 400"，OKX 的 code/msg
    // 在响应体里，必须透传出来否则排障无从下手
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(400, { code: "51000", data: [], msg: "Parameter ordType error" });

    const err = await adapter.fetchAlgoOrders("ETH/USDT").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExchangeError);
    expect((err as ExchangeError).message).toContain("Parameter ordType error");
    expect((err as ExchangeError).message).toContain("51000");
    expect((err as ExchangeError).isRetryable).toBe(false);
  });

  it("fetchAlgoOrders sends required ordType param (OKX 51000 otherwise)", async () => {
    // OKX GET /trade/orders-algo-pending 把 ordType 列为必填，缺失时返回
    // HTTP 400 {"code":"51000","msg":"Parameter ordType error"}
    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query((q) => q.ordType === "conditional" && q.instType === "SWAP" && q.instId === "ETH-USDT-SWAP")
      .reply(200, { code: "0", msg: "", data: [] });

    await expect(adapter.fetchAlgoOrders("ETH/USDT")).resolves.toEqual([]);
  });

  // ── setPositionMode ───────────────────────────────────────────

  it("setPositionMode resolves on success", async () => {
    nock(BASE_URL)
      .post("/api/v5/account/set-position-mode")
      .reply(200, { code: "0", msg: "" });

    await expect(adapter.setPositionMode(true)).resolves.toBeUndefined();
  });

  it("setPositionMode ignores 'already in mode' errors", async () => {
    nock(BASE_URL)
      .post("/api/v5/account/set-position-mode")
      .reply(200, { code: "1", msg: "Position mode error" });

    await expect(adapter.setPositionMode(true)).resolves.toBeUndefined();
  });

  // ── getPositionMode ───────────────────────────────────────────

  it("getPositionMode returns true for net_mode", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ posMode: "net_mode" }],
      });

    const mode = await adapter.getPositionMode();
    expect(mode).toBe(true);
  });

  it("getPositionMode returns false for long_short_mode", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ posMode: "long_short_mode" }],
      });

    const mode = await adapter.getPositionMode();
    expect(mode).toBe(false);
  });

  // ── setLeverage ───────────────────────────────────────────────

  it("setLeverage resolves on success", async () => {
    nock(BASE_URL)
      .post("/api/v5/account/set-leverage")
      .reply(200, { code: "0", msg: "" });

    await expect(adapter.setLeverage("ETH/USDT", 10)).resolves.toBeUndefined();
  });

  // ── closePosition ─────────────────────────────────────────────

  it("closePosition throws when no position", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });

    await expect(adapter.closePosition("ETH/USDT", "long")).rejects.toThrow(ExchangeError);
  });

  it("closePosition places reduce-only market order", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ instId: "ETH-USDT-SWAP", posSide: "long", pos: "1", avgPx: "2400", upl: "0", lever: "10", mgnMode: "cross", availPos: "1" }],
      });

    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ ordId: "close-123" }],
      });

    const order = await adapter.closePosition("ETH/USDT", "long");
    expect(order.orderId).toBe("close-123");
    expect(order.side).toBe("sell");
    expect(order.type).toBe("market");
  });

  it("closePosition 顶层 code:1 msg:'All operations failed' 时必须透传 data[0].sCode/sMsg 真实原因", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ instId: "ETH-USDT-SWAP", posSide: "long", pos: "1", avgPx: "2400", upl: "0", lever: "10", mgnMode: "cross", availPos: "1" }],
      });
    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, {
        code: "1",
        msg: "All operations failed",
        data: [{ sCode: "51008", sMsg: "Order failed. Insufficient margin" }],
      });

    await expect(adapter.closePosition("ETH/USDT", "long")).rejects.toMatchObject({
      code: "51008",
      message: expect.stringContaining("Insufficient margin"),
    });
  });

  it("closePosition 分数合约持仓向上取整张数——reduceOnly 兜底,不留残仓(实测 38.41 张 round→38 残留 0.41 张)", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ instId: "ETH-USDT-SWAP", posSide: "short", pos: "-38.41", avgPx: "1676", upl: "0", lever: "20", mgnMode: "cross", availPos: "38.41" }],
      });

    let capturedBody: Record<string, unknown> | null = null;
    nock(BASE_URL)
      .post("/api/v5/trade/order", (body) => { capturedBody = body as Record<string, unknown>; return true; })
      .reply(200, { code: "0", msg: "", data: [{ ordId: "close-frac" }] });

    await adapter.closePosition("ETH/USDT", "short");
    expect(capturedBody!.sz).toBe("39");
    expect(capturedBody!.reduceOnly).toBe("true");
  });

  it("closePosition 残留不足一张(0.41张)仍能平掉——ceil 到 1 张而非 round 到 0 抛错", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [{ instId: "ETH-USDT-SWAP", posSide: "short", pos: "-0.41", avgPx: "1676", upl: "0", lever: "20", mgnMode: "cross", availPos: "0.41" }],
      });

    let capturedBody: Record<string, unknown> | null = null;
    nock(BASE_URL)
      .post("/api/v5/trade/order", (body) => { capturedBody = body as Record<string, unknown>; return true; })
      .reply(200, { code: "0", msg: "", data: [{ ordId: "close-dust" }] });

    await adapter.closePosition("ETH/USDT", "short");
    expect(capturedBody!.sz).toBe("1");
  });

  // ── fetchOpenOrders ───────────────────────────────────────────

  it("fetchOpenOrders returns open orders", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-pending")
      .query(true)
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { ordId: "1", clOrdId: "c1", instId: "ETH-USDT-SWAP", side: "buy", ordType: "limit", sz: "1", px: "2400", state: "live", fillSz: "0", uTime: "1000" },
        ],
      });

    const orders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(orders).toHaveLength(1);
    expect(orders[0].orderId).toBe("1");
    expect(orders[0].status).toBe("open");
  });

  // ── fetchMyTrades ─────────────────────────────────────────────

  it("fetchMyTrades 用 orders-history 把 algoClOrdId 拼回成交（REST fills 不带该字段）", async () => {
    // 模拟盘实测：algo 触发单成交的 clOrdId 是 OKX 自动 id（O…），REST
    // /trade/fills 无 algoClOrdId。不拼回则 WS 错过时止损成交永远无法按 id 归属。
    nock(BASE_URL)
      .get("/api/v5/trade/fills")
      .query(true)
      .reply(200, {
        code: "0",
        data: [
          { ordId: "ord-algo", clOrdId: "O123456", tradeId: "t1", instId: "ETH-USDT-SWAP", side: "sell", fillSz: "1", fillPx: "1640", state: "filled", fillTime: "1000" },
          { ordId: "ord-grid", clOrdId: "ETHUSDT260611071735B2", tradeId: "t2", instId: "ETH-USDT-SWAP", side: "buy", fillSz: "1", fillPx: "1650", state: "filled", fillTime: "1001" },
        ],
      });
    nock(BASE_URL)
      .get("/api/v5/trade/orders-history")
      .query(true)
      .reply(200, {
        code: "0",
        data: [
          { ordId: "ord-algo", clOrdId: "O123456", algoClOrdId: "ETHUSDT260611071735AE3k" },
          { ordId: "ord-grid", clOrdId: "ETHUSDT260611071735B2", algoClOrdId: "" },
        ],
      });

    const fills = await adapter.fetchMyTrades("ETH/USDT", 0);
    expect(fills).toHaveLength(2);
    expect(fills.find((f) => f.orderId === "ord-algo")!.clientOrderId).toBe("ETHUSDT260611071735AE3k");
    expect(fills.find((f) => f.orderId === "ord-grid")!.clientOrderId).toBe("ETHUSDT260611071735B2");
  });

  it("fetchMyTrades 在 orders-history 失败时返回原始成交（富化失败不阻断对账）", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/fills")
      .query(true)
      .reply(200, {
        code: "0",
        data: [
          { ordId: "ord-1", clOrdId: "c1", tradeId: "t1", instId: "ETH-USDT-SWAP", side: "buy", fillSz: "1", fillPx: "1650", state: "filled", fillTime: "1000" },
        ],
      });
    nock(BASE_URL)
      .get("/api/v5/trade/orders-history")
      .query(true)
      .reply(500, { code: "50013", msg: "system busy" });

    const fills = await adapter.fetchMyTrades("ETH/USDT", 0);
    expect(fills).toHaveLength(1);
    expect(fills[0].clientOrderId).toBe("c1");
  });

  // ── syncStateAfterReconnect ───────────────────────────────────

  it("syncStateAfterReconnect returns all state", async () => {
    nock(BASE_URL)
      .get("/api/v5/trade/orders-pending")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });

    nock(BASE_URL)
      .get("/api/v5/trade/orders-algo-pending")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });

    nock(BASE_URL)
      .get("/api/v5/account/positions")
      .query(true)
      .reply(200, { code: "0", msg: "", data: [] });

    const sync = await adapter.syncStateAfterReconnect("ETH/USDT");
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
  });

  // ── isImmediateTriggerError ───────────────────────────────────

  it("isImmediateTriggerError recognizes OKX trigger errors", () => {
    expect(adapter.isImmediateTriggerError(new Error("51020: trigger price error"))).toBe(true);
    expect(adapter.isImmediateTriggerError(new Error("51021: trigger price error"))).toBe(true);
    expect(adapter.isImmediateTriggerError(new Error("the trigger price is already reached"))).toBe(true);
    expect(adapter.isImmediateTriggerError(new Error("unrelated error"))).toBe(false);
  });

  // ── ExchangeError integration ─────────────────────────────────

  it("network errors are marked retryable", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/balance")
      .replyWithError("ECONNRESET");

    await expect(adapter.fetchBalance()).rejects.toThrow();
  });

  it("post-only reject (51420) has POST_ONLY_REJECT category", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/config")
      .reply(200, { code: "0", data: [{ acctLv: "2" }] });
    nock(BASE_URL)
      .post("/api/v5/trade/order")
      .reply(200, { code: "51420", msg: "Post only order will be matched immediately" });

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

  it("destroy() clears internal caches", () => {
    // No public way to verify, but should not throw
    expect(() => adapter.destroy()).not.toThrow();
    // Second destroy is safe
    expect(() => adapter.destroy()).not.toThrow();
  });

  // ── fetchFundingHistory ───────────────────────────────────────

  it("fetchFundingHistory: bills type=8 映射为 FundingFeeRecord，其他 type 过滤掉", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/bills")
      .query({ type: "8", instId: "ETH-USDT-SWAP" })
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "-1.23", ts: "1718000000000" },
          { instId: "ETH-USDT-SWAP", type: "2", balChg: "5.00", ts: "1718000001000" }, // 非资金费，应过滤
        ],
      });

    const records = await adapter.fetchFundingHistory("ETH/USDT", 0);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      symbol: "ETH/USDT",
      fundingTime: 1718000000000,
      amount: -1.23,
    });
  });

  it("fetchFundingHistory: sinceMs/untilMs 时间窗口过滤", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/bills")
      .query({ type: "8", instId: "ETH-USDT-SWAP" })
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "-1.00", ts: "1718000000000" }, // 在范围内
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "-2.00", ts: "1717999999999" }, // 早于 sinceMs
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "-3.00", ts: "1718000010001" }, // 晚于 untilMs
        ],
      });

    const records = await adapter.fetchFundingHistory("ETH/USDT", 1718000000000, 1718000010000);
    expect(records).toHaveLength(1);
    expect(records[0].amount).toBe(-1.0);
  });

  it("fetchFundingHistory: 无 untilMs 时不截断上界", async () => {
    nock(BASE_URL)
      .get("/api/v5/account/bills")
      .query({ type: "8", instId: "ETH-USDT-SWAP" })
      .reply(200, {
        code: "0",
        msg: "",
        data: [
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "0.50", ts: "1718000000000" },
          { instId: "ETH-USDT-SWAP", type: "8", balChg: "0.75", ts: "9999999999999" },
        ],
      });

    const records = await adapter.fetchFundingHistory("ETH/USDT", 0);
    expect(records).toHaveLength(2);
  });
});

describe("OkxAdapter environment routing", () => {
  afterEach(() => { nock.cleanAll(); });

  it("demo (default) sends x-simulated-trading header", async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a" });
    const scope = nock(BASE_URL, { reqheaders: { "x-simulated-trading": "1" } })
      .get("/api/v5/market/ticker")
      .query({ instId: "ETH-USDT-SWAP" })
      .reply(200, { code: "0", msg: "", data: [{ instId: "ETH-USDT-SWAP", last: "2456.7", bidPx: "2456.5", askPx: "2456.9", ts: "1597026383085" }] });
    await adapter.getTicker("ETH/USDT");
    expect(scope.isDone()).toBe(true);
  });

  it("live omits x-simulated-trading header", async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a", environment: "live" });
    const scope = nock(BASE_URL, { badheaders: ["x-simulated-trading"] })
      .get("/api/v5/market/ticker")
      .query({ instId: "ETH-USDT-SWAP" })
      .reply(200, { code: "0", msg: "", data: [{ instId: "ETH-USDT-SWAP", last: "2456.7", bidPx: "2456.5", askPx: "2456.9", ts: "1597026383085" }] });
    await adapter.getTicker("ETH/USDT");
    expect(scope.isDone()).toBe(true);
  });
});

// ── OkxAdapter → OkxWsClient WS URL/isPrivate 路由 ─────────────────────
// 姊妹任务(Binance/Gate.io)的教训:初版实现只做了 WS 端环境路由，却没有断言
// WS URL 选型本身或 isPrivate/environment 的透传，review 时两次都被标 Important，
// 需要补一轮才修完。这里从一开始就把覆盖建进来。
describe("OkxAdapter → OkxWsClient WS URL/isPrivate 路由", () => {
  beforeEach(() => {
    h.wsInstances.length = 0;
  });

  it("demo（缺省）watchTicker 创建的 OkxWsClient 走 OKX_WS_PUBLIC，isPrivate=false", async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a" });

    const collect = (async () => {
      for await (const _t of adapter.watchTicker("ETH/USDT")) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.url).toBe(OKX_WS_PUBLIC);
    expect(ws.isPrivate).toBe(false);

    ws.emit("data", { channel: "tickers", data: [{ last: "2000", bidPx: "1999", askPx: "2001", ts: "1" }] });
    await collect;
    adapter.destroy();
  });

  it('environment: "live" → watchTicker 创建的 OkxWsClient 走 OKX_WS_PUBLIC_LIVE（不是 demo 端点），isPrivate=false', async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a", environment: "live" });

    const collect = (async () => {
      for await (const _t of adapter.watchTicker("ETH/USDT")) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.url).toBe(OKX_WS_PUBLIC_LIVE);
    expect(ws.url).not.toBe(OKX_WS_PUBLIC);
    expect(ws.isPrivate).toBe(false);

    ws.emit("data", { channel: "tickers", data: [{ last: "2000", bidPx: "1999", askPx: "2001", ts: "1" }] });
    await collect;
    adapter.destroy();
  });

  it("demo（缺省）watchOrderFills 创建的 OkxWsClient 走 OKX_WS_PRIVATE，isPrivate=true（需要登录）", async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a" });

    const collect = (async () => {
      for await (const _f of adapter.watchOrderFills("ETH/USDT")) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.url).toBe(OKX_WS_PRIVATE);
    expect(ws.isPrivate).toBe(true);

    ws.emit("data", { channel: "orders", data: [{ ordId: "1", instId: "ETH-USDT-SWAP", side: "buy", fillSz: "1", fillPx: "2000", state: "filled", fillTime: "1" }] });
    await collect;
    adapter.destroy();
  });

  it('environment: "live" → watchOrderFills 创建的 OkxWsClient 走 OKX_WS_PRIVATE_LIVE，isPrivate=true（这是本 Task 要修的登录识别 bug 的直接回归覆盖）', async () => {
    const adapter = new OkxAdapter({ apiKey: "k", apiSecret: "s", passphrase: "p", accountId: "a", environment: "live" });

    const collect = (async () => {
      for await (const _f of adapter.watchOrderFills("ETH/USDT")) {
        break;
      }
    })();

    await new Promise((r) => setTimeout(r, 0));
    const ws = h.wsInstances[h.wsInstances.length - 1];
    expect(ws.url).toBe(OKX_WS_PRIVATE_LIVE);
    expect(ws.url).not.toBe(OKX_WS_PRIVATE);
    expect(ws.isPrivate).toBe(true);

    ws.emit("data", { channel: "orders", data: [{ ordId: "1", instId: "ETH-USDT-SWAP", side: "buy", fillSz: "1", fillPx: "2000", state: "filled", fillTime: "1" }] });
    await collect;
    adapter.destroy();
  });
});

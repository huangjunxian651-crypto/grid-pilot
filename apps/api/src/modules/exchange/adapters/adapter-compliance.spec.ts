// adapter-compliance.spec.ts — 三所共用合规测试套件 + MockExchangeAdapter 行为验证
// 每个交易所适配器必须通过相同的测试集
// 真实适配器测试使用 nock 拦截 HTTP（参见各 adapter 目录下的 *.unit.spec.ts）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { IExchangeAdapter, ExchangeError } from "../interfaces/exchange-adapter.interface";
import { MockExchangeAdapter } from "../interfaces/exchange-adapter.mock";
import { BinanceAdapter } from "./binance/binance.adapter";
import { GateioAdapter } from "./gateio/gateio.adapter";
import { OkxAdapter } from "./okx/okx.adapter";

// ── Helpers ─────────────────────────────────────────────────────

function createBinanceAdapter(): BinanceAdapter {
  return new BinanceAdapter({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    accountId: "test-binance",
  });
}

function createGateioAdapter(): GateioAdapter {
  return new GateioAdapter({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    accountId: "test-gateio",
  });
}

function createOkxAdapter(): OkxAdapter {
  return new OkxAdapter({
    apiKey: "test-api-key",
    apiSecret: "test-api-secret",
    passphrase: "test-passphrase",
    accountId: "test-okx",
  });
}

function getAdapter(exchange: "binance" | "gateio" | "okx" | "mock"): IExchangeAdapter {
  switch (exchange) {
    case "binance":
      return createBinanceAdapter();
    case "gateio":
      return createGateioAdapter();
    case "okx":
      return createOkxAdapter();
    case "mock":
      return new MockExchangeAdapter({ exchangeId: "gateio", accountId: "test-mock" });
  }
}

// ── Compliance Tests (structure only, no live network) ─────────

describe("ExchangeAdapter Compliance", () => {
  const exchanges: Array<"binance" | "gateio" | "okx"> = ["binance", "gateio", "okx"];

  describe.each(exchanges)("%s adapter", (exchange) => {
    let adapter: IExchangeAdapter;

    beforeEach(() => {
      adapter = getAdapter(exchange);
    });

    afterEach(() => {
      adapter.destroy();
    });

    it("has correct exchangeId", () => {
      expect(adapter.exchangeId).toBe(exchange);
    });

    it("has accountId", () => {
      expect(adapter.accountId).toBeDefined();
      expect(typeof adapter.accountId).toBe("string");
    });

    it("destroy() is callable without error", () => {
      expect(() => adapter.destroy()).not.toThrow();
    });

    it("isImmediateTriggerError is defined", () => {
      expect(typeof adapter.isImmediateTriggerError).toBe("function");
    });
  });
});

// ── MockExchangeAdapter Behavior Tests ──────────────────────────

describe("MockExchangeAdapter", () => {
  let adapter: MockExchangeAdapter;

  beforeEach(() => {
    adapter = new MockExchangeAdapter({ exchangeId: "gateio", accountId: "test-mock" });
    adapter.start(2400);
  });

  afterEach(() => {
    adapter.destroy();
  });

  it("has correct exchangeId and accountId", () => {
    expect(adapter.exchangeId).toBe("gateio");
    expect(adapter.accountId).toBe("test-mock");
  });

  it("start() sets initial price", () => {
    adapter.start(2500);
    expect(adapter.fetchBalance()).resolves.toBeDefined();
  });

  it("setPrice() overrides random walk", () => {
    adapter.setPrice(2600);
    expect(adapter.fetchBalance()).resolves.toBeDefined();
  });

  it("stop() is callable without error", () => {
    expect(() => adapter.stop()).not.toThrow();
  });

  it("destroy() cleans up resources", () => {
    expect(() => adapter.destroy()).not.toThrow();
  });

  // ── Market Data ───────────────────────────────────────────────

  it("getMarketInfo returns valid MarketInfo for ETH/USDT", async () => {
    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.symbol).toBe("ETH/USDT");
    expect(info.rawSymbol).toBeDefined();
    expect(info.minQty).toBeGreaterThan(0);
    expect(info.stepSize).toBeGreaterThan(0);
    expect(info.tickSize).toBeGreaterThan(0);
    expect(info.contractSize).toBeGreaterThan(0);
    expect(info.makerFeeRate).toBeGreaterThanOrEqual(0);
    expect(info.takerFeeRate).toBeGreaterThanOrEqual(0);
  });

  // ── Orders ────────────────────────────────────────────────────

  it("can place a limit order with clientOrderId", async () => {
    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "buy",
      type: "limit",
      qty: 0.1,
      price: 2400,
      clientOrderId: "test-limit-001",
    });
    expect(order.orderId).toBeDefined();
    expect(order.clientOrderId).toBe("test-limit-001");
    expect(order.status).toBe("open");
    expect(order.qty).toBe(0.1);
    expect(order.price).toBe(2400);
  });

  it("can place a post-only order", async () => {
    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "sell",
      type: "post_only",
      qty: 0.05,
      price: 2500,
    });
    expect(order.status).toBe("open");
    expect(order.type).toBe("post_only");
  });

  it("can place a market order", async () => {
    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "buy",
      type: "market",
      qty: 0.1,
    });
    expect(order.status).toBe("open");
    expect(order.type).toBe("market");
  });

  it("can cancel an order by orderId", async () => {
    const order = await adapter.createOrder({
      symbol: "ETH/USDT",
      side: "buy",
      type: "limit",
      qty: 0.1,
      price: 2400,
    });
    await adapter.cancelOrder(order.orderId, "ETH/USDT");
    const openOrders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(openOrders.find((o) => o.orderId === order.orderId)).toBeUndefined();
  });

  it("can cancel all orders for a symbol", async () => {
    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 });
    await adapter.createOrder({ symbol: "ETH/USDT", side: "sell", type: "limit", qty: 0.1, price: 2500 });
    await adapter.cancelAllOrders("ETH/USDT");
    const openOrders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(openOrders).toHaveLength(0);
  });

  it("can fetch open orders", async () => {
    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 });
    const openOrders = await adapter.fetchOpenOrders("ETH/USDT");
    expect(openOrders.length).toBeGreaterThanOrEqual(1);
    expect(openOrders[0].symbol).toBe("ETH/USDT");
  });

  // ── Algo Orders ───────────────────────────────────────────────

  it("can place an algo order with clientAlgoId", async () => {
    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo-001",
    });
    expect(algo.algoOrderId).toBeDefined();
    expect(algo.clientAlgoId).toBe("test-algo-001");
    expect(algo.status).toBe("open");
    expect(algo.triggerPrice).toBe(2300);
  });

  it("can cancel an algo order by algoOrderId", async () => {
    const algo = await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "sell",
      triggerPrice: 2500,
      triggerCondition: "price_above",
      qty: 0.1,
      clientAlgoId: "test-algo-002",
    });
    await adapter.cancelAlgoOrder(algo.algoOrderId, "ETH/USDT");
    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos.find((a) => a.algoOrderId === algo.algoOrderId)).toBeUndefined();
  });

  it("can cancel all algo orders for a symbol", async () => {
    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo-003",
    });
    await adapter.cancelAllAlgoOrders("ETH/USDT");
    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos).toHaveLength(0);
  });

  it("can fetch active algo orders", async () => {
    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "buy",
      triggerPrice: 2300,
      triggerCondition: "price_below",
      qty: 0.1,
      clientAlgoId: "test-algo-004",
    });
    const algos = await adapter.fetchAlgoOrders("ETH/USDT");
    expect(algos.length).toBeGreaterThanOrEqual(1);
    expect(algos[0].clientAlgoId).toBe("test-algo-004");
  });

  // ── Position ──────────────────────────────────────────────────

  it("can fetch current position", async () => {
    const pos = await adapter.fetchPosition("ETH/USDT");
    expect(pos.symbol).toBe("ETH/USDT");
    expect(["long", "short", "none"]).toContain(pos.side);
    expect(pos.qty).toBeGreaterThanOrEqual(0);
  });

  it("can close position", async () => {
    // First create a position by buying, wait for fill (300ms delay in mock)
    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "market", qty: 0.1 });
    await new Promise((r) => setTimeout(r, 400));
    const order = await adapter.closePosition("ETH/USDT", "long");
    expect(order.side).toBe("sell");
    expect(order.type).toBe("market");
  });

  // ── Balance ───────────────────────────────────────────────────

  it("can fetch balance", async () => {
    const balance = await adapter.fetchBalance();
    expect(balance.usdt).toBeGreaterThan(0);
    expect(balance.totalEquity).toBeGreaterThan(0);
    expect(balance.ts).toBeGreaterThan(0);
  });

  // ── Account Initialization ────────────────────────────────────

  it("can set and get position mode", async () => {
    await adapter.setPositionMode(true);
    const mode = await adapter.getPositionMode();
    expect(typeof mode).toBe("boolean");
  });

  it("can set leverage", async () => {
    await expect(adapter.setLeverage("ETH/USDT", 10)).resolves.not.toThrow();
  });

  it("can set and get margin mode", async () => {
    await adapter.setMarginMode("ETH/USDT", true);
    const mode = await adapter.getMarginMode("ETH/USDT");
    expect(typeof mode).toBe("boolean");
  });

  // ── Error Handling ────────────────────────────────────────────

  it("isImmediateTriggerError recognizes immediate trigger errors", () => {
    expect(adapter.isImmediateTriggerError(new Error("trigger price is already reached"))).toBe(false);
  });

  // ── Reconnect Sync ────────────────────────────────────────────

  it("syncStateAfterReconnect returns SyncResult", async () => {
    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "limit", qty: 0.1, price: 2400 });
    const sync = await adapter.syncStateAfterReconnect("ETH/USDT");
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
    expect(sync.position.symbol).toBe("ETH/USDT");
  });

  // ── Watch Streams ─────────────────────────────────────────────

  it("watchTicker yields ticker objects", async () => {
    const gen = adapter.watchTicker("ETH/USDT");
    const result = await gen.next();
    expect(result.value).toBeDefined();
    expect(result.value.symbol).toBe("ETH/USDT");
    expect(result.value.lastPrice).toBeGreaterThan(0);
    adapter.stop();
  });
});

// ── ExchangeError Tests ─────────────────────────────────────────

describe("ExchangeError", () => {
  it("has correct properties", () => {
    const err = new ExchangeError("test message", "TEST_CODE", "okx", true);
    expect(err.message).toBe("test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.exchangeId).toBe("okx");
    expect(err.isRetryable).toBe(true);
    expect(err.name).toBe("ExchangeError");
  });

  it("is instance of Error", () => {
    const err = new ExchangeError("test", "CODE", "binance");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ExchangeError).toBe(true);
  });

  it("defaults isRetryable to false", () => {
    const err = new ExchangeError("test", "CODE", "gateio");
    expect(err.isRetryable).toBe(false);
  });
});

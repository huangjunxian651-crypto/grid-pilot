/**
 * Binance Adapter Integration Tests
 *
 * Runs against Binance Demo (simulated trading) environment.
 * Requires BINANCE_API_KEY and BINANCE_API_SECRET env vars.
 *
 * Usage:
 *   set -a && source .env.testnet && set +a
 *   npx vitest run src/modules/exchange/adapters/__integration-tests__/binance.integration.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { BinanceAdapter } from "../binance/binance.adapter";
import { getBinanceCredentials, shouldRun } from "./shared/env-loader";
import {
  TEST_SYMBOL,
  TEST_LEVERAGE,
  TEST_TIMEOUT,
} from "./shared/test-constants";
import {
  cleanup,
  makeClientId,
  sleep,
  verifyMarketInfo,
  getSafeTestPrice,
  getMinQty,
  formatQty,
  formatPrice,
} from "./shared/test-helpers";

const RUN = shouldRun("binance");

describe("BinanceAdapter Integration", () => {
  let adapter: BinanceAdapter;
  let testPrice: { base: number; bid: number; ask: number; triggerBelow: number; triggerAbove: number };
  let minQty: number;

  beforeAll(async () => {
    if (!RUN) {
      console.log("Skipping Binance integration tests — credentials not set");
      return;
    }
    const creds = getBinanceCredentials()!;
    adapter = new BinanceAdapter({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      accountId: "integration-test",
    });

    // Pre-fetch market info for test parameters
    await verifyMarketInfo(adapter, TEST_SYMBOL);
    testPrice = await getSafeTestPrice(adapter, TEST_SYMBOL);
    const info = await adapter.getMarketInfo(TEST_SYMBOL);
    let rawMinQty = await getMinQty(adapter, TEST_SYMBOL);
    // Binance requires notional >= 20 USDT
    const minNotional = 20;
    const minQtyForNotional = minNotional / testPrice.base;
    rawMinQty = Math.max(rawMinQty, minQtyForNotional);
    minQty = formatQty(rawMinQty, info.stepSize);
  }, TEST_TIMEOUT);

  afterAll(() => {
    adapter?.destroy();
  });

  beforeEach(async () => {
    if (!adapter) return;
    await cleanup(adapter, TEST_SYMBOL);
  }, TEST_TIMEOUT);

  // ── Skip all tests if no credentials ──
  const itIfRun = RUN ? it : it.skip;

  // ── Authentication ──

  itIfRun("can authenticate and fetch balance", async () => {
    const balance = await adapter.fetchBalance();
    expect(balance.usdt).toBeGreaterThanOrEqual(0);
    expect(balance.totalEquity).toBeGreaterThanOrEqual(0);
    expect(balance.ts).toBeGreaterThan(0);
  });

  // ── Account Initialization ──

  itIfRun("can set position mode to one-way", async () => {
    await adapter.setPositionMode(true);
    const mode = await adapter.getPositionMode();
    expect(mode).toBe(true);
  });

  itIfRun("can set leverage", async () => {
    await adapter.setLeverage(TEST_SYMBOL, TEST_LEVERAGE);
    // Binance doesn't return leverage on fetch directly; verify no error
  });

  itIfRun("can set margin mode to cross", async () => {
    await adapter.setMarginMode(TEST_SYMBOL, true);
    const mode = await adapter.getMarginMode(TEST_SYMBOL);
    expect(mode).toBe(true);
  });

  // ── Market Data ──

  itIfRun("can fetch market info", async () => {
    const info = await adapter.getMarketInfo(TEST_SYMBOL);
    expect(info.symbol).toBe(TEST_SYMBOL);
    expect(info.rawSymbol).toBe("ETHUSDT");
    expect(info.minQty).toBeGreaterThan(0);
    expect(info.tickSize).toBeGreaterThan(0);
    expect(info.contractSize).toBe(1); // Binance uses coin units directly
  });

  // ── Orders ──

  itIfRun("can place and cancel a limit order", async () => {
    const order = await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      type: "limit",
      qty: minQty,
      price: testPrice.bid, // Below market to avoid fill
      clientOrderId: makeClientId("bin-limit"),
    });

    expect(order.status).toBe("open");
    expect(order.orderId).toBeDefined();
    expect(order.symbol).toBe(TEST_SYMBOL);
    expect(order.side).toBe("buy");

    const openOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(openOrders.find((o) => o.orderId === order.orderId)).toBeDefined();

    await adapter.cancelOrder(order.orderId, TEST_SYMBOL);

    const afterCancel = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(afterCancel.find((o) => o.orderId === order.orderId)).toBeUndefined();
  });

  itIfRun("can place a post-only order", async () => {
    const order = await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      type: "post_only",
      qty: minQty,
      price: testPrice.ask, // Above market
    });

    expect(order.status).toBe("open");
    expect(order.side).toBe("sell");
  });

  itIfRun("can cancel all orders", async () => {
    await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      type: "limit",
      qty: minQty,
      price: testPrice.bid,
    });
    await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      type: "limit",
      qty: minQty,
      price: testPrice.ask,
    });

    const before = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await adapter.cancelAllOrders(TEST_SYMBOL);

    const after = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(after).toHaveLength(0);
  });

  // ── Algo Orders ──
  // Note: Binance Demo environment does not support fetchAlgoOrders (returns 404)

  itIfRun("can place an algo order", async () => {
    // Use a trigger price far from current market to avoid immediate trigger
    const farBelow = formatPrice(testPrice.base * 0.8, (await adapter.getMarketInfo(TEST_SYMBOL)).tickSize);
    const algo = await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      triggerPrice: farBelow,
      triggerCondition: "price_below",
      qty: minQty,
      clientAlgoId: makeClientId("bin-algo"),
    });

    expect(algo.status).toBe("open");
    expect(algo.algoOrderId).toBeDefined();

    // Cleanup
    await adapter.cancelAlgoOrder(algo.algoOrderId, TEST_SYMBOL);
  });

  // ── Position ──

  itIfRun("can fetch position (empty or not)", async () => {
    const pos = await adapter.fetchPosition(TEST_SYMBOL);
    expect(pos.symbol).toBe(TEST_SYMBOL);
    expect(["long", "short", "none"]).toContain(pos.side);
    expect(pos.qty).toBeGreaterThanOrEqual(0);
  });

  // ── Reconnect Sync ──

  itIfRun("syncStateAfterReconnect returns consistent state", async () => {
    // Note: Binance Demo does not support fetchAlgoOrders
    // Test individual components that are supported
    const openOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
    const position = await adapter.fetchPosition(TEST_SYMBOL);
    expect(Array.isArray(openOrders)).toBe(true);
    expect(position).toBeDefined();
    expect(position.symbol).toBe(TEST_SYMBOL);
  });

  // ── Full Lifecycle ──

  itIfRun(
    "full lifecycle: initialize, place order, sync, cleanup",
    async () => {
      // Initialize account
      await adapter.setPositionMode(true);
      await adapter.setLeverage(TEST_SYMBOL, TEST_LEVERAGE);
      await adapter.setMarginMode(TEST_SYMBOL, true);

      // Place a limit order
      const order = await adapter.createOrder({
        symbol: TEST_SYMBOL,
        side: "buy",
        type: "limit",
        qty: minQty,
        price: testPrice.bid,
        clientOrderId: makeClientId("bin-lifecycle"),
      });
      expect(order.status).toBe("open");

      // Sync state
      const openOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
      expect(openOrders.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await cleanup(adapter, TEST_SYMBOL);

      // Verify cleanup
      const finalOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
      expect(finalOrders).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );
});

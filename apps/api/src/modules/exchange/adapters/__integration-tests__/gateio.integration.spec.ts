/**
 * Gate.io Adapter Integration Tests
 *
 * Runs against Gate.io Testnet environment.
 * Requires GATEIO_API_KEY and GATEIO_API_SECRET env vars.
 *
 * Usage:
 *   set -a && source .env.testnet && set +a
 *   npx vitest run src/modules/exchange/adapters/__integration-tests__/gateio.integration.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { GateioAdapter } from "../gateio/gateio.adapter";
import { getGateioCredentials, shouldRun } from "./shared/env-loader";
import {
  TEST_SYMBOL,
  TEST_LEVERAGE,
  TEST_TIMEOUT,
} from "./shared/test-constants";
import {
  cleanup,
  makeClientId,
  verifyMarketInfo,
  getSafeTestPrice,
  getMinQty,
  formatQty,
} from "./shared/test-helpers";

const RUN = shouldRun("gateio");

describe("GateioAdapter Integration", () => {
  let adapter: GateioAdapter;
  let testPrice: { base: number; bid: number; ask: number; triggerBelow: number; triggerAbove: number };
  let minQty: number;

  beforeAll(async () => {
    if (!RUN) {
      console.log("Skipping Gate.io integration tests — credentials not set");
      return;
    }
    const creds = getGateioCredentials()!;
    adapter = new GateioAdapter({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      accountId: "integration-test",
    });

    await verifyMarketInfo(adapter, TEST_SYMBOL);
    testPrice = await getSafeTestPrice(adapter, TEST_SYMBOL);
    const info = await adapter.getMarketInfo(TEST_SYMBOL);
    const rawMinQty = await getMinQty(adapter, TEST_SYMBOL);
    minQty = formatQty(rawMinQty, info.stepSize);
  }, TEST_TIMEOUT);

  afterAll(() => {
    adapter?.destroy();
  });

  beforeEach(async () => {
    if (!adapter) return;
    await cleanup(adapter, TEST_SYMBOL);
  }, TEST_TIMEOUT);

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
    expect(info.rawSymbol).toBe("ETH_USDT");
    expect(info.contractSize).toBeGreaterThan(0);
    expect(info.tickSize).toBeGreaterThan(0);
  });

  // ── Orders ──

  itIfRun("can place and cancel a limit order", async () => {
    const order = await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      type: "limit",
      qty: minQty,
      price: testPrice.bid,
      clientOrderId: makeClientId("gate-limit"),
    });

    expect(order.status).toBe("open");
    expect(order.orderId).toBeDefined();

    const openOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(openOrders.find((o) => o.orderId === order.orderId)).toBeDefined();

    await adapter.cancelOrder(order.orderId, TEST_SYMBOL);

    const afterCancel = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(afterCancel.find((o) => o.orderId === order.orderId)).toBeUndefined();
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

  itIfRun("can place and cancel an algo order", async () => {
    const algo = await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      triggerPrice: testPrice.triggerBelow,
      triggerCondition: "price_below",
      qty: minQty,
      clientAlgoId: makeClientId("gate-algo"),
    });

    expect(algo.status).toBe("open");
    expect(algo.algoOrderId).toBeDefined();

    const algos = await adapter.fetchAlgoOrders(TEST_SYMBOL);
    expect(algos.find((a) => a.algoOrderId === algo.algoOrderId)).toBeDefined();

    await adapter.cancelAlgoOrder(algo.algoOrderId, TEST_SYMBOL);

    const afterCancel = await adapter.fetchAlgoOrders(TEST_SYMBOL);
    expect(afterCancel.find((a) => a.algoOrderId === algo.algoOrderId)).toBeUndefined();
  });

  itIfRun("can cancel all algo orders", async () => {
    await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      triggerPrice: testPrice.triggerBelow,
      triggerCondition: "price_below",
      qty: minQty,
      clientAlgoId: makeClientId("gate-algo1"),
    });
    await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      triggerPrice: testPrice.triggerAbove,
      triggerCondition: "price_above",
      qty: minQty,
      clientAlgoId: makeClientId("gate-algo2"),
    });

    await adapter.cancelAllAlgoOrders(TEST_SYMBOL);

    const algos = await adapter.fetchAlgoOrders(TEST_SYMBOL);
    expect(algos).toHaveLength(0);
  });

  // ── Position ──

  itIfRun("can fetch position", async () => {
    const pos = await adapter.fetchPosition(TEST_SYMBOL);
    expect(pos.symbol).toBe(TEST_SYMBOL);
    expect(["long", "short", "none"]).toContain(pos.side);
    expect(pos.qty).toBeGreaterThanOrEqual(0);
  });

  // ── Reconnect Sync ──

  itIfRun("syncStateAfterReconnect returns consistent state", async () => {
    const sync = await adapter.syncStateAfterReconnect(TEST_SYMBOL);
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
    expect(sync.position.symbol).toBe(TEST_SYMBOL);
  });

  // ── Full Lifecycle ──

  itIfRun(
    "full lifecycle: initialize, place order, sync, cleanup",
    async () => {
      await adapter.setPositionMode(true);
      await adapter.setLeverage(TEST_SYMBOL, TEST_LEVERAGE);
      await adapter.setMarginMode(TEST_SYMBOL, true);

      const order = await adapter.createOrder({
        symbol: TEST_SYMBOL,
        side: "buy",
        type: "limit",
        qty: minQty,
        price: testPrice.bid,
        clientOrderId: makeClientId("gate-lifecycle"),
      });
      expect(order.status).toBe("open");

      const algo = await adapter.createAlgoOrder({
        symbol: TEST_SYMBOL,
        side: "sell",
        triggerPrice: testPrice.triggerBelow,
        triggerCondition: "price_below",
        qty: minQty,
        clientAlgoId: makeClientId("gate-lifecycle-algo"),
      });
      expect(algo.status).toBe("open");

      const sync = await adapter.syncStateAfterReconnect(TEST_SYMBOL);
      expect(sync.openOrders.length).toBeGreaterThanOrEqual(1);
      expect(sync.openAlgoOrders.length).toBeGreaterThanOrEqual(1);

      await cleanup(adapter, TEST_SYMBOL);

      const finalOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
      const finalAlgos = await adapter.fetchAlgoOrders(TEST_SYMBOL);
      expect(finalOrders).toHaveLength(0);
      expect(finalAlgos).toHaveLength(0);
    },
    TEST_TIMEOUT,
  );
});

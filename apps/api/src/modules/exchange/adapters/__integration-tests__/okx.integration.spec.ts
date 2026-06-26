/**
 * OKX Adapter Integration Tests
 *
 * Runs against OKX Simulated Trading environment.
 * Requires OKX_API_KEY, OKX_API_SECRET, and OKX_PASSPHRASE env vars.
 *
 * Usage:
 *   set -a && source .env.testnet && set +a
 *   npx vitest run src/modules/exchange/adapters/__integration-tests__/okx.integration.spec.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { OkxAdapter } from "../okx/okx.adapter";
import { getOkxCredentials, shouldRun } from "./shared/env-loader";
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

const RUN = shouldRun("okx");

describe("OkxAdapter Integration", () => {
  let adapter: OkxAdapter;
  let testPrice: { base: number; bid: number; ask: number; triggerBelow: number; triggerAbove: number };
  let minQty: number;
  let canTrade = true; // Set to false if account is Lv1 (Simple mode)

  beforeAll(async () => {
    if (!RUN) {
      console.log("Skipping OKX integration tests — credentials not set");
      return;
    }
    const creds = getOkxCredentials()!;
    adapter = new OkxAdapter({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      passphrase: creds.passphrase!,
      accountId: "integration-test",
    });

    // Check account level — Lv1 (Simple mode) cannot trade contracts
    try {
      const configRes = await (adapter as any).rest.getAccountConfig();
      const acctLv = configRes.data?.[0]?.acctLv;
      if (acctLv === "1") {
        console.warn(
          "OKX account is in Simple mode (Lv1). Contract trading tests will be skipped. " +
          "Upgrade to Futures mode (Lv2) via https://www.okx.com/account/mode",
        );
        canTrade = false;
      }
    } catch {
      // Ignore config fetch errors
    }

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
  // Helper that checks canTrade at runtime (set in beforeAll)
  function itIfTrade(name: string, fn: () => Promise<void>, timeout?: number) {
    const testFn = async () => {
      if (!canTrade) {
        console.log(`  SKIP: ${name} — OKX account is in Simple mode (Lv1)`);
        return;
      }
      await fn();
    };
    if (timeout) {
      itIfRun(name, testFn, timeout);
    } else {
      itIfRun(name, testFn);
    }
  }

  // ── Authentication ──

  itIfRun("can authenticate and fetch balance", async () => {
    const balance = await adapter.fetchBalance();
    // OKX demo account may have 0 balance initially
    expect(balance.usdt).toBeGreaterThanOrEqual(0);
    expect(balance.ts).toBeGreaterThan(0);
  });

  // ── Account Initialization ──

  itIfRun("can set position mode to net mode", async () => {
    await adapter.setPositionMode(true);
    const mode = await adapter.getPositionMode();
    expect(mode).toBe(true);
  });

  itIfRun("can set leverage", async () => {
    await adapter.setLeverage(TEST_SYMBOL, TEST_LEVERAGE);
  });

  itIfRun("can get margin mode (cross by default)", async () => {
    const mode = await adapter.getMarginMode(TEST_SYMBOL);
    expect(typeof mode).toBe("boolean");
  });

  // ── Market Data ──

  itIfRun("can fetch market info", async () => {
    const info = await adapter.getMarketInfo(TEST_SYMBOL);
    expect(info.symbol).toBe(TEST_SYMBOL);
    expect(info.rawSymbol).toBe("ETH-USDT-SWAP");
    expect(info.contractSize).toBeGreaterThan(0);
    expect(info.tickSize).toBeGreaterThan(0);
  });

  // ── Orders ──

  itIfTrade("can place and cancel a limit order", async () => {
    const order = await adapter.createOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      type: "limit",
      qty: minQty,
      price: testPrice.bid,
      clientOrderId: makeClientId("okx-limit"),
    });

    expect(order.status).toBe("open");
    expect(order.orderId).toBeDefined();

    const openOrders = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(openOrders.find((o) => o.orderId === order.orderId)).toBeDefined();

    await adapter.cancelOrder(order.orderId, TEST_SYMBOL);

    const afterCancel = await adapter.fetchOpenOrders(TEST_SYMBOL);
    expect(afterCancel.find((o) => o.orderId === order.orderId)).toBeUndefined();
  });

  itIfTrade("can cancel all orders", async () => {
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

  itIfTrade("can place and cancel an algo order", async () => {
    const algo = await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      triggerPrice: testPrice.triggerBelow,
      triggerCondition: "price_below",
      qty: minQty,
      clientAlgoId: makeClientId("okx-algo"),
    });

    expect(algo.status).toBe("open");
    expect(algo.algoOrderId).toBeDefined();

    const algos = await adapter.fetchAlgoOrders(TEST_SYMBOL);
    expect(algos.find((a) => a.algoOrderId === algo.algoOrderId)).toBeDefined();

    await adapter.cancelAlgoOrder(algo.algoOrderId, TEST_SYMBOL);

    const afterCancel = await adapter.fetchAlgoOrders(TEST_SYMBOL);
    expect(afterCancel.find((a) => a.algoOrderId === algo.algoOrderId)).toBeUndefined();
  });

  itIfTrade("can cancel all algo orders", async () => {
    await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "buy",
      triggerPrice: testPrice.triggerBelow,
      triggerCondition: "price_below",
      qty: minQty,
      clientAlgoId: makeClientId("okx-algo1"),
    });
    await adapter.createAlgoOrder({
      symbol: TEST_SYMBOL,
      side: "sell",
      triggerPrice: testPrice.triggerAbove,
      triggerCondition: "price_above",
      qty: minQty,
      clientAlgoId: makeClientId("okx-algo2"),
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

  itIfTrade("syncStateAfterReconnect returns consistent state", async () => {
    const sync = await adapter.syncStateAfterReconnect(TEST_SYMBOL);
    expect(Array.isArray(sync.openOrders)).toBe(true);
    expect(Array.isArray(sync.openAlgoOrders)).toBe(true);
    expect(sync.position).toBeDefined();
    expect(sync.position.symbol).toBe(TEST_SYMBOL);
  });

  // ── Full Lifecycle ──

  itIfTrade(
    "full lifecycle: initialize, place order, sync, cleanup",
    async () => {
      await adapter.setPositionMode(true);
      await adapter.setLeverage(TEST_SYMBOL, TEST_LEVERAGE);
      // OKX setMarginMode is a no-op (margin mode set per order via tdMode)

      const order = await adapter.createOrder({
        symbol: TEST_SYMBOL,
        side: "buy",
        type: "limit",
        qty: minQty,
        price: testPrice.bid,
        clientOrderId: makeClientId("okx-lifecycle"),
      });
      expect(order.status).toBe("open");

      const algo = await adapter.createAlgoOrder({
        symbol: TEST_SYMBOL,
        side: "sell",
        triggerPrice: testPrice.triggerBelow,
        triggerCondition: "price_below",
        qty: minQty,
        clientAlgoId: makeClientId("okx-lifecycle-algo"),
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

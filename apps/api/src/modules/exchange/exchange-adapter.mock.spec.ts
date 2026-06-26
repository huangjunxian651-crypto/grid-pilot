import { describe, expect, it } from "vitest";
import { MockExchangeAdapter } from "./interfaces/exchange-adapter.mock";

describe("MockExchangeAdapter deterministic price", () => {
  it("allows tests to push a ticker price", async () => {
    const adapter = new MockExchangeAdapter();
    adapter.start(2400);
    adapter.setPrice(2390);

    const stream = adapter.watchTicker("ETH/USDT");
    const first = await stream.next();

    expect(first.value.lastPrice).toBe(2390);
    expect(first.value.bestBid).toBeLessThan(2390);
    expect(first.value.bestAsk).toBeGreaterThan(2390);
    adapter.stop();
  });

  it("updates position when a triggered algo order fills", async () => {
    const adapter = new MockExchangeAdapter();
    adapter.start(2400);
    await adapter.createOrder({ symbol: "ETH/USDT", side: "buy", type: "market", qty: 1 });
    await new Promise((resolve) => setTimeout(resolve, 350));

    await adapter.createAlgoOrder({
      symbol: "ETH/USDT",
      side: "sell",
      triggerPrice: 2390,
      triggerCondition: "price_below",
      qty: 0.4,
      closePosition: false,
      clientAlgoId: "algo-test",
    });

    adapter.setPrice(2389);
    const stream = adapter.watchTicker("ETH/USDT");
    await stream.next();

    const position = await adapter.fetchPosition("ETH/USDT");
    expect(position.qty).toBeCloseTo(0.6);
    adapter.stop();
  });

  it.each([
    ["binance", 0.001, 0.1],
    ["gateio", 0.001, 0.1],
    ["okx", 0.001, 0.1],
  ])("returns market info for %s", async (exchangeId, minQty, tickSize) => {
    const adapter = new MockExchangeAdapter({ exchangeId: exchangeId as "binance" | "gateio" | "okx" });
    const info = await adapter.getMarketInfo("ETH/USDT");
    expect(info.minQty).toBe(minQty);
    expect(info.tickSize).toBe(tickSize);
  });
});

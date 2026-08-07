import { describe, it, expect } from "vitest";
import { ExchangeAdapterFactory } from "./exchange-adapter.factory";
import { ExchangeRegistryService } from "./exchange-registry.service";
import { BinanceAdapter } from "./adapters/binance/binance.adapter";

describe("ExchangeAdapterFactory environment passthrough", () => {
  it("passes environment through to the created Binance adapter", () => {
    const factory = new ExchangeAdapterFactory(new ExchangeRegistryService());
    const adapter = factory.createAdapter({
      exchangeId: "binance",
      accountId: "acc",
      apiKey: "k",
      apiSecret: "s",
      environment: "live",
    });
    expect(adapter).toBeInstanceOf(BinanceAdapter);
    expect((adapter as unknown as { environment: string }).environment).toBe("live");
  });
});

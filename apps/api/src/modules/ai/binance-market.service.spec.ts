import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { BinanceMarketService } from "./binance-market.service";

vi.mock("axios");

describe("BinanceMarketService", () => {
  const svc = new BinanceMarketService();
  beforeEach(() => vi.clearAllMocks());

  it("归一化 symbol 并按 interval=1d limit=365 请求", async () => {
    (axios.get as any).mockResolvedValue({ data: [
      [0, "100", "110", "90", "105", "1000", 0, "0", 0, "0", "0", "0"],
    ] });
    const ks = await svc.fetchDailyKlines("ETH/USDT");
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/fapi/v1/klines"),
      expect.objectContaining({ params: expect.objectContaining({ symbol: "ETHUSDT", interval: "1d", limit: 365 }) }),
    );
    expect(ks[0]).toMatchObject({ open: 100, high: 110, low: 90, close: 105, volume: 1000 });
  });

  it("失败抛 AI_MARKET_FETCH_FAILED", async () => {
    (axios.get as any).mockRejectedValue(new Error("network"));
    await expect(svc.fetchDailyKlines("ETH/USDT")).rejects.toMatchObject({ response: { code: "AI_MARKET_FETCH_FAILED" } });
  });
});

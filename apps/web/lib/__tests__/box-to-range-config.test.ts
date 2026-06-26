import { describe, it, expect } from "vitest";
import { boxToRangeConfig } from "../../app/robots/[id]/_monitor";

const box = {
  id: "box-1", direction: "LONG", takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10,
  mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 9, stopLossGridStep: 5,
  activationPrice: 2300, trailingEntry: false, trailingCallbackRate: 0.002,
  excessProfitMultiplier: 2, reorderThreshold: 0.02, enabled: true,
};
const robot = { symbol: "ETH/USDT", direction: "LONG", exchangeId: "binance" } as any;

describe("boxToRangeConfig", () => {
  it("映射核心字段", () => {
    const rc = boxToRangeConfig(box as any, robot);
    expect(rc).toMatchObject({
      id: "box-1", symbol: "ETH/USDT", exchange: "binance", direction: "LONG",
      takeProfitPrice: 2500, mainGridCount: 60, mainGridStep: 10, mainGridPortionSize: 0.05,
      stopLossGridCount: 9, stopLossGridStep: 5, isolationStep: 5, leverage: 20,
      activationPrice: 2300,
    });
  });
  it("未知 exchange 回退 binance", () => {
    const rc = boxToRangeConfig(box as any, { ...robot, exchangeId: "weird" });
    expect(rc.exchange).toBe("binance");
  });
});

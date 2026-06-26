import { describe, it, expect, vi } from "vitest";
import { deriveLayout, fmt } from "../store";

// ── deriveLayout tests ─────────────────────────────────────────
describe("deriveLayout", () => {
  it("calculates correct layout for standard LONG config", () => {
    const result = deriveLayout({
      takeProfitPrice: 3000,
      direction: "LONG",
      mainGridCount: 10,
      mainGridStep: 94,
      stopLossGridCount: 4,
      stopLossGridStep: 10,
      isolationStep: 20,
    });

    // LONG: takeProfitPrice = 箱顶, liquidationPrice = 箱底
    // mainGridDepth = 10*94 = 940, isolationEndDepth = 940+20 = 960, boxDepth = 960+40 = 1000
    expect(result.mainGridDepth).toBe(940);
    expect(result.takeProfitPrice).toBe(3000);
    expect(result.fullPositionPrice).toBe(2060);  // 3000 - 940
    expect(result.stopLossStartPrice).toBe(2040); // 3000 - 960
    expect(result.liquidationPrice).toBe(2000);   // 3000 - 1000
    expect(result.boxHighPrice).toBe(3000);
    expect(result.boxLowPrice).toBe(2000);
    expect(result.gridStep).toBe(94);
  });

  it("calculates correct layout for SHORT config", () => {
    const result = deriveLayout({
      takeProfitPrice: 2000,
      direction: "SHORT",
      mainGridCount: 10,
      mainGridStep: 94,
      stopLossGridCount: 4,
      stopLossGridStep: 10,
      isolationStep: 20,
    });

    // SHORT: takeProfitPrice = 箱底止盈线, liquidationPrice = 箱顶
    // mainGridDepth = 940, isolationEndDepth = 960, boxDepth = 1000
    expect(result.mainGridDepth).toBe(940);
    expect(result.takeProfitPrice).toBe(2000);
    expect(result.fullPositionPrice).toBe(2940);  // 2000 + 940
    expect(result.stopLossStartPrice).toBe(2960); // 2000 + 960
    expect(result.liquidationPrice).toBe(3000);   // 2000 + 1000
    expect(result.boxHighPrice).toBe(3000);
    expect(result.boxLowPrice).toBe(2000);
    expect(result.gridStep).toBe(94);
  });

  it("handles zero isolation step", () => {
    const result = deriveLayout({
      takeProfitPrice: 2000,
      direction: "LONG",
      mainGridCount: 5,
      mainGridStep: 190,
      stopLossGridCount: 2,
      stopLossGridStep: 25,
      isolationStep: 0,
    });

    // mainGridDepth = 5*190 = 950, isolationEndDepth = 950, boxDepth = 950+50 = 1000
    expect(result.mainGridDepth).toBe(950);
    expect(result.fullPositionPrice).toBe(1050); // 2000 - 950
    expect(result.stopLossStartPrice).toBe(1050); // isolationEndDepth = mainGridDepth when isolationStep=0
    expect(result.liquidationPrice).toBe(1000);
    expect(result.gridStep).toBe(190);
  });

  it("handles fractional grid step", () => {
    const result = deriveLayout({
      takeProfitPrice: 2000,
      direction: "LONG",
      mainGridCount: 3,
      mainGridStep: 328.3333333333333,
      stopLossGridCount: 1,
      stopLossGridStep: 10,
      isolationStep: 5,
    });

    // mainGridDepth = 3*328.333... = 985, isolationEndDepth = 990, boxDepth = 1000
    expect(result.liquidationPrice).toBeCloseTo(1000, 5);
    expect(result.gridStep).toBe(328.3333333333333);
    // 默认激活价 = 主网格中点：toPrice(mainGridDepth/2) = 2000 − 985/2 = 1507.5（与后端一致）
    expect(result.activationPrice).toBeCloseTo(1507.5, 5);
  });
});

// ── fmt tests ──────────────────────────────────────────────────
describe("fmt", () => {
  it("fmt.usd formats with commas and 2 decimals", () => {
    expect(fmt.usd(1234.567)).toBe("1,234.57");
  });

  it("fmt.usd respects custom decimal places", () => {
    expect(fmt.usd(1234.5, 4)).toBe("1,234.5000");
  });

  it("fmt.coin formats with 4 decimals", () => {
    expect(fmt.coin(0.123456)).toBe("0.1235");
  });

  it("fmt.pct formats as percentage", () => {
    expect(fmt.pct(0.1234)).toBe("12.34%");
  });

  it("fmt.signed adds + for positive", () => {
    expect(fmt.signed(5.5)).toBe("+5.50");
  });

  it("fmt.signed keeps - for negative", () => {
    expect(fmt.signed(-5.5)).toBe("-5.50");
  });

  it("fmt.exchangeName maps known exchanges", () => {
    expect(fmt.exchangeName("binance")).toBe("Binance");
    expect(fmt.exchangeName("gateio")).toBe("Gate.io");
    expect(fmt.exchangeName("okx")).toBe("OKX");
  });

  it("fmt.exchangeName falls back to id for unknown", () => {
    expect(fmt.exchangeName("unknown")).toBe("unknown");
    expect(fmt.exchangeName("kraken")).toBe("kraken");
  });

  it("fmt.time formats timestamp to time string", () => {
    const ts = new Date("2024-01-15T09:30:45.000Z").getTime();
    const result = fmt.time(ts);
    expect(result).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
  });

  it("fmt.ago returns English relative time", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    expect(fmt.ago(now - 30 * 1000)).toBe("30s ago");
    expect(fmt.ago(now - 5 * 60 * 1000)).toBe("5m ago");
    expect(fmt.ago(now - 3 * 60 * 60 * 1000)).toBe("3h ago");
    expect(fmt.ago(now - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");

    vi.useRealTimers();
  });
});

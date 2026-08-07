import { describe, it, expect } from "vitest";
import { computeMarginRoi, formatMarginRoi, MIN_MARGIN_USDT } from "../margin-roi";

describe("computeMarginRoi", () => {
  it("多头正常场景：0.3 ETH × 1870 ÷ 20 杠杆 = 28.05 保证金，盈亏 +9 → +32.1%", () => {
    const roi = computeMarginRoi({ pnl: 9, positionQty: 0.3, price: 1870, leverage: 20 });
    expect(roi).toBeCloseTo(32.086, 2);
  });

  it("空头持仓（负 qty）取绝对值，与同等多头结果一致", () => {
    const short = computeMarginRoi({ pnl: 9, positionQty: -0.3, price: 1870, leverage: 20 });
    const long = computeMarginRoi({ pnl: 9, positionQty: 0.3, price: 1870, leverage: 20 });
    expect(short).toBe(long);
  });

  it("亏损时返回负百分比", () => {
    const roi = computeMarginRoi({ pnl: -9, positionQty: 0.3, price: 1870, leverage: 20 });
    expect(roi).toBeLessThan(0);
    expect(roi).toBeCloseTo(-32.086, 2);
  });

  // ── 分母不可用：统一返回 null ──
  it("空仓（qty=0）返回 null", () => {
    expect(computeMarginRoi({ pnl: 9, positionQty: 0, price: 1870, leverage: 20 })).toBeNull();
  });

  it("qty 为 null/undefined 返回 null", () => {
    expect(computeMarginRoi({ pnl: 9, positionQty: null, price: 1870, leverage: 20 })).toBeNull();
    expect(computeMarginRoi({ pnl: 9, positionQty: undefined, price: 1870, leverage: 20 })).toBeNull();
  });

  it("杠杆缺失或为 0 返回 null（避免除以 0）", () => {
    expect(computeMarginRoi({ pnl: 9, positionQty: 0.3, price: 1870, leverage: 0 })).toBeNull();
    expect(computeMarginRoi({ pnl: 9, positionQty: 0.3, price: 1870, leverage: null })).toBeNull();
  });

  it("价格缺失或为 0 返回 null", () => {
    expect(computeMarginRoi({ pnl: 9, positionQty: 0.3, price: 0, leverage: 20 })).toBeNull();
    expect(computeMarginRoi({ pnl: 9, positionQty: 0.3, price: null, leverage: 20 })).toBeNull();
  });

  // ── 阈值边界：挡住平仓趋近时的百分比爆炸 ──
  it("保证金低于 1 USDT 下限返回 null（0.001 ETH 会算出 +10000% 这类荒谬值）", () => {
    // 0.001 × 1870 ÷ 20 = 0.0935 USDT
    expect(computeMarginRoi({ pnl: 9, positionQty: 0.001, price: 1870, leverage: 20 })).toBeNull();
  });

  it("保证金恰好等于下限时仍显示（边界取等号侧）", () => {
    // qty × price ÷ leverage = 1 恰好：1 × 20 ÷ 20 = 1
    const roi = computeMarginRoi({ pnl: 9, positionQty: 1, price: 20, leverage: 20 });
    expect(roi).not.toBeNull();
    expect(roi).toBeCloseTo(900, 5);
  });

  it("MIN_MARGIN_USDT 导出为 1", () => {
    expect(MIN_MARGIN_USDT).toBe(1);
  });

  it("盈亏本身非有限值时返回 null（否则 NaN/Infinity 会渲染到界面上）", () => {
    expect(computeMarginRoi({ pnl: NaN, positionQty: 0.3, price: 1870, leverage: 20 })).toBeNull();
    expect(computeMarginRoi({ pnl: Infinity, positionQty: 0.3, price: 1870, leverage: 20 })).toBeNull();
  });
});

describe("formatMarginRoi", () => {
  it("null 显示占位符 —", () => {
    expect(formatMarginRoi(null)).toBe("—");
  });

  it("正数带 + 号，一位小数", () => {
    expect(formatMarginRoi(32.086)).toBe("+32.1%");
  });

  it("负数带 - 号，一位小数", () => {
    expect(formatMarginRoi(-12.44)).toBe("-12.4%");
  });

  it("零显示 +0.0%", () => {
    expect(formatMarginRoi(0)).toBe("+0.0%");
  });

  it("极小负值四舍五入到零时显示 +0.0% 而非 -0.0%（资金界面上 -0.0% 读作缺陷）", () => {
    expect(formatMarginRoi(-0.04)).toBe("+0.0%");
  });
});

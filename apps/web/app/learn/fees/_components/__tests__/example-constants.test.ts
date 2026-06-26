import { describe, it, expect } from "vitest";
import { FEE_EXAMPLE } from "../example-constants";

describe("FEE_EXAMPLE", () => {
  it("派生值自洽（开平仓口径）", () => {
    expect(FEE_EXAMPLE.notional).toBe(FEE_EXAMPLE.principal * FEE_EXAMPLE.leverage); // 20000
    expect(FEE_EXAMPLE.feePerFillTaker).toBe(10); // 名义×Taker费率 = 20000×0.0005
    expect(FEE_EXAMPLE.feePerFillMaker).toBe(4); // 名义×Maker费率
    expect(FEE_EXAMPLE.roundTripFeeTaker).toBe(20); // 一次开平仓=开+平=2笔
    expect(FEE_EXAMPLE.roundTripPctOfPrincipal).toBeCloseTo(0.02, 6); // 20/1000 = 2%
    expect(FEE_EXAMPLE.takerDaily).toBe(FEE_EXAMPLE.roundTripFeeTaker * FEE_EXAMPLE.roundTripsPerDay); // 1000
    expect(FEE_EXAMPLE.makerDaily).toBe(FEE_EXAMPLE.feePerFillMaker * 2 * FEE_EXAMPLE.roundTripsPerDay); // 400
  });
});

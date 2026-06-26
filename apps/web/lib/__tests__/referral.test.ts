import { describe, it, expect, beforeEach } from "vitest";
import {
  REBATE_RATES, estimateRebate, rebateRatePercent,
  isReferralMuted, setReferralMuted,
  MILESTONE_FEE_THRESHOLD, isMilestoneShown, markMilestoneShown,
} from "../referral";

beforeEach(() => localStorage.clear());

describe("estimateRebate", () => {
  it("binance/okx 返 20%，gate 返 40%", () => {
    expect(estimateRebate("binance", 100)).toBeCloseTo(20, 6);
    expect(estimateRebate("okx", 100)).toBeCloseTo(20, 6);
    expect(estimateRebate("gateio", 100)).toBeCloseTo(40, 6);
  });
  it("未知所或负/NaN 手续费归 0", () => {
    expect(estimateRebate("unknown", 100)).toBe(0);
    expect(estimateRebate("binance", -5)).toBe(0);
    expect(estimateRebate("binance", Number.NaN)).toBe(0);
  });
  it("rebateRatePercent 返回整数百分比", () => {
    expect(rebateRatePercent("gateio")).toBe(40);
    expect(rebateRatePercent("binance")).toBe(20);
    expect(rebateRatePercent("unknown")).toBe(0);
  });
});

describe("mute", () => {
  it("默认不静音；set 后静音", () => {
    expect(isReferralMuted()).toBe(false);
    setReferralMuted();
    expect(isReferralMuted()).toBe(true);
  });
});

describe("milestone", () => {
  it("阈值常量为 50", () => expect(MILESTONE_FEE_THRESHOLD).toBe(50));
  it("mark 后该 robot 视为已提示，互不影响", () => {
    expect(isMilestoneShown("r1")).toBe(false);
    markMilestoneShown("r1");
    expect(isMilestoneShown("r1")).toBe(true);
    expect(isMilestoneShown("r2")).toBe(false);
  });
});

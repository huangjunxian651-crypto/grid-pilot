import { describe, it, expect } from "vitest";
import { activeBoxRoiText } from "../margin-roi";

describe("activeBoxRoiText（详情页活跃箱回报率）", () => {
  const live = { positionQty: 0.3, price: 1870, leverage: 20 };

  it("活跃箱有持仓时返回百分比", () => {
    expect(activeBoxRoiText(9, true, live)).toBe("+32.1%");
  });

  it("非活跃箱一律返回 null（历史量，无当前持仓，调用方据此不渲染节点）", () => {
    expect(activeBoxRoiText(9, false, live)).toBeNull();
  });

  it("活跃但空仓时返回 null（调用方据此不渲染节点）", () => {
    expect(activeBoxRoiText(9, true, { positionQty: 0, price: 1870, leverage: 20 })).toBeNull();
  });

  it("liveStatus 缺失（未连上实时流）时返回 null（调用方据此不渲染节点）", () => {
    expect(activeBoxRoiText(9, true, null)).toBeNull();
  });
});

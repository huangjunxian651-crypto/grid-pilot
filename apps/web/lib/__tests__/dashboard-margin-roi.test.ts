import { describe, it, expect } from "vitest";
import { robotUnrealizedRoiText } from "../margin-roi";

describe("robotUnrealizedRoiText（仪表盘每机器人未实现回报率）", () => {
  it("有持仓时返回百分比串", () => {
    const text = robotUnrealizedRoiText({
      lastUnrealizedPnl: 2.805, lastPositionQty: 0.3, latestPrice: 1870, activeBoxLeverage: 20,
    });
    expect(text).toBe("+10.0%");
  });

  it("未实现盈亏为 null 时返回 null（调用方据此不渲染节点）", () => {
    const text = robotUnrealizedRoiText({
      lastUnrealizedPnl: null, lastPositionQty: 0.3, latestPrice: 1870, activeBoxLeverage: 20,
    });
    expect(text).toBeNull();
  });

  it("空仓时返回 null（调用方据此不渲染节点）", () => {
    const text = robotUnrealizedRoiText({
      lastUnrealizedPnl: 2.8, lastPositionQty: 0, latestPrice: 1870, activeBoxLeverage: 20,
    });
    expect(text).toBeNull();
  });

  it("无活跃箱（杠杆为 null）时返回 null（调用方据此不渲染节点）", () => {
    const text = robotUnrealizedRoiText({
      lastUnrealizedPnl: 2.8, lastPositionQty: 0.3, latestPrice: 1870, activeBoxLeverage: null,
    });
    expect(text).toBeNull();
  });
});

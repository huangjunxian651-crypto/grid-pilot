import { describe, it, expect } from "vitest";
import { boxGeometryError } from "../box-geometry-error";

// 镜像后端 validateBoxGeometry 的用户面几何校验（LONG/SHORT 通用）。
const base = { direction: "LONG" as const, takeProfitPrice: 2500, mainGridCount: 30, mainGridStep: 30, stopLossGridCount: 9, stopLossGridStep: 10 };

describe("boxGeometryError", () => {
  it("SHORT 方向合法配置返回 null（不再拒绝 SHORT）", () => {
    // SHORT takeProfitPrice=100, 30格×30步=900深度, boxLow=100>0
    expect(boxGeometryError({ ...base, direction: "SHORT", takeProfitPrice: 100 })).toBeNull();
  });

  it("合法 LONG 配置返回 null", () => {
    // mainGridDepth=900, isolationStep=10, stopLossRange=90, boxDepth=1000, 1/5=200, 90<200
    expect(boxGeometryError(base)).toBeNull();
  });

  it("止损区超过总幅 1/5 → 报错", () => {
    // mainGridStep=10: boxDepth=10*30+10+90=400, 1/5=80, slRange 90>80
    const err = boxGeometryError({ ...base, mainGridStep: 10 });
    expect(err?.key).toBe("robot.geo_sl_range_exceeds");
  });

  it("有止损但止损步长<=0 → 报错", () => {
    expect(boxGeometryError({ ...base, stopLossGridStep: 0 })?.key).toBe("robot.geo_sl_step_positive");
  });

  it("止盈价<=0 → 报错", () => {
    expect(boxGeometryError({ ...base, takeProfitPrice: 0 })?.key).toBe("robot.geo_take_profit_positive");
  });

  it("boxLowPrice<=0 → 报错（LONG 主网格步长过大）", () => {
    // mainGridStep=100: boxLow = 2500 - 100*30 - 10 - 90 = 2500-3100 < 0
    expect(boxGeometryError({ ...base, mainGridStep: 100, stopLossGridCount: 0, stopLossGridStep: 0 })?.key).toBe("robot.geo_box_low_positive");
  });

  it("无止损（count=0）不触发 1/5 规则", () => {
    expect(boxGeometryError({ ...base, stopLossGridCount: 0, stopLossGridStep: 0 })).toBeNull();
  });

  it("SHORT 配置止损区超过 1/5 → 报错", () => {
    // SHORT takeProfitPrice=2000, mainGridStep=10: boxDepth=10*30+10+90=400, slRange 90 > 80
    const err = boxGeometryError({ ...base, direction: "SHORT", takeProfitPrice: 2000, mainGridStep: 10 });
    expect(err?.key).toBe("robot.geo_sl_range_exceeds");
  });

  it("启用止损时 isolationStep<=0 返回隔离带错误 key", () => {
    const err = boxGeometryError({ ...base, isolationStep: 0 });
    expect(err?.key).toBe("robot.geo_isolation_positive");
  });
  it("启用止损且 isolationStep>0 不因隔离带报错", () => {
    const err = boxGeometryError({ ...base, isolationStep: 10 });
    expect(err).toBeNull();
  });
  it("未传 isolationStep 时回退 stopLossGridStep（向后兼容，不报隔离带错）", () => {
    const err = boxGeometryError({ ...base });
    expect(err).toBeNull();
  });
});

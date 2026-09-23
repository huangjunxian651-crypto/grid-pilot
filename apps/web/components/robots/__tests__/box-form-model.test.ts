import { describe, it, expect } from "vitest";
import {
  emptyBoxFormValue,
  boxFormValueFromBox,
  boxFormValueToAddBoxInput,
  boxFormPreviewLayout,
  boxFormErrors,
  boxFormValueFromRecommendation,
} from "../box-form-model";
import type { RobotBox } from "@/lib/api";

describe("box-form-model", () => {
  it("emptyBoxFormValue 给出默认值（leverage=20, slCount=4, 其余空）", () => {
    const v = emptyBoxFormValue();
    expect(v.leverage).toBe("20");
    expect(v.stopLossGridCount).toBe("4");
    expect(v.takeProfitPrice).toBe("");
    expect(v.activationPrice).toBe("");
  });

  it("boxFormValueFromBox 把箱体映射为字符串表单值", () => {
    const box = {
      id: "b1", direction: "LONG", takeProfitPrice: 2800, mainGridCount: 200,
      mainGridStep: 2, mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4,
      stopLossGridStep: 2, isolationStep: 3, activationPrice: 2750, trailingEntry: false,
      trailingCallbackRate: 0, excessProfitMultiplier: 0, reorderThreshold: 0, enabled: true,
    } as RobotBox;
    const v = boxFormValueFromBox(box);
    expect(v.takeProfitPrice).toBe("2800");
    expect(v.isolationStep).toBe("3");
    expect(v.activationPrice).toBe("2750");
  });

  it("activationPrice<=0 时 boxFormValueFromBox 映射为空串", () => {
    const box = { id: "b", direction: "LONG", takeProfitPrice: 100, mainGridCount: 10,
      mainGridStep: 1, mainGridPortionSize: 1, leverage: 20, stopLossGridCount: 0,
      stopLossGridStep: 0, isolationStep: undefined, activationPrice: 0, trailingEntry: false,
      trailingCallbackRate: 0, excessProfitMultiplier: 0, reorderThreshold: 0, enabled: true } as RobotBox;
    expect(boxFormValueFromBox(box).activationPrice).toBe("");
    expect(boxFormValueFromBox(box).isolationStep).toBe("");
  });

  it("boxFormValueToAddBoxInput 装配数字 payload，含 direction，省略空的 activation/isolation", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", mainGridPortionSize: "0.05", stopLossGridStep: "2" };
    const input = boxFormValueToAddBoxInput(v, "LONG");
    expect(input).toMatchObject({
      direction: "LONG", takeProfitPrice: 2800, mainGridCount: 200, mainGridStep: 2,
      mainGridPortionSize: 0.05, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 2,
    });
    expect("activationPrice" in input).toBe(false);
    expect("isolationStep" in input).toBe(false);
  });

  it("boxFormPreviewLayout 参数不全时返回 null", () => {
    expect(boxFormPreviewLayout(emptyBoxFormValue(), "LONG")).toBeNull();
  });

  it("boxFormPreviewLayout 参数齐全时返回布局", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "20",
      mainGridStep: "2", stopLossGridStep: "2" };
    const layout = boxFormPreviewLayout(v, "LONG");
    expect(layout).not.toBeNull();
    expect(layout!.takeProfitPrice).toBe(2800);
  });

  it("boxFormErrors 对非法几何返回 geometry 错误键", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "0", mainGridCount: "20", mainGridStep: "2" };
    const errs = boxFormErrors(v, "LONG");
    expect(errs.geometry?.key).toBe("robot.geo_take_profit_positive");
  });

  it("boxFormErrors 对越界激活价返回 activation 错误键", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "20",
      mainGridStep: "2", stopLossGridStep: "2", activationPrice: "9999" };
    const errs = boxFormErrors(v, "LONG");
    expect(errs.activation?.key).toBe("robot.activation_range_error");
  });

  it("boxFormErrors：每格量按箱体最低价折算名义价值不足 minNotional 时返回 orderSize 错误", () => {
    // takeProfitPrice=2800, count=200, step=2, isolation=2, slCount=4, slStep=2
    // → boxLowPrice = 2800 - 400 - 2 - 8 = 2390；0.005 × 2390 = 11.95 < 20
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", stopLossGridStep: "2", mainGridPortionSize: "0.005" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize?.key).toBe("robot.order_size_below_minimum");
  });

  it("boxFormErrors：每格量在箱体最低价上仍满足 minNotional 时不报 orderSize 错误", () => {
    // 每格投入 50 USDT，按最低价换算后仍高于交易所门槛。
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", stopLossGridStep: "2", mainGridPortionSize: "50" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize).toBeNull();
  });

  it("boxFormErrors：每格投入低于 USDT 最小名义价值时拒绝", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2200", mainGridCount: "200",
      mainGridStep: "2", stopLossGridCount: "0", stopLossGridStep: "0", mainGridPortionSize: "20" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize?.key).toBe("robot.order_size_below_minimum");
  });

  it("boxFormErrors：达到按最低价折算后的真实 USDT 下限时通过", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2200", mainGridCount: "200",
      mainGridStep: "2", stopLossGridCount: "0", stopLossGridStep: "0", mainGridPortionSize: "40" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize).toBeNull();
  });

  it("boxFormErrors：不传 marketConstraints（拉取失败降级）时不报 orderSize 错误", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", stopLossGridStep: "2", mainGridPortionSize: "0.0000001" };
    const errs = boxFormErrors(v, "LONG");
    expect(errs.orderSize).toBeNull();
  });

  it("boxFormErrors：USDT 投入不要求是基础币 stepSize 的整数倍", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", stopLossGridStep: "2", mainGridPortionSize: "30" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize).toBeNull();
  });

  it("boxFormErrors：较大的 USDT 投入正常通过", () => {
    const v = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200",
      mainGridStep: "2", stopLossGridStep: "2", mainGridPortionSize: "50" };
    const errs = boxFormErrors(v, "LONG", { minQty: 0.001, minNotional: 20, stepSize: 0.01 });
    expect(errs.orderSize).toBeNull();
  });

  it("boxFormValueFromRecommendation 把推荐参数映射为表单值字符串", () => {
    const v = boxFormValueFromRecommendation({
      takeProfitPrice: 2700, mainGridCount: 30, mainGridStep: 10, mainGridPortionSize: 0.05,
      leverage: 20, stopLossGridCount: 4, stopLossGridStep: 5, isolationStep: 5,
    });
    expect(v.takeProfitPrice).toBe("2700");
    expect(v.mainGridCount).toBe("30");
    expect(v.leverage).toBe("20");
    expect(v.isolationStep).toBe("5");
    expect(v.activationPrice).toBe("");
  });
});

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

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { BoxForm } from "../box-form";
import { emptyBoxFormValue } from "../box-form-model";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

// GridLadder 依赖 window.matchMedia（jsdom 无此 API），用轻量存根替代
vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => <div data-testid="grid-ladder" />,
}));

describe("BoxForm", () => {
  it("渲染止盈价字段，输入触发 onChange", () => {
    const onChange = vi.fn();
    render(<BoxForm value={emptyBoxFormValue()} onChange={onChange} direction="LONG" price={2700} />);
    const input = screen.getByPlaceholderText("2800");
    fireEvent.change(input, { target: { value: "2800" } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next.takeProfitPrice).toBe("2800");
  });

  it("参数不完整（出不了预览）时不显示几何错误（渐进式 UX，镜像详情页）", () => {
    const value = { ...emptyBoxFormValue(), takeProfitPrice: "0", mainGridCount: "20", mainGridStep: "2" };
    render(<BoxForm value={value} onChange={() => {}} direction="LONG" price={0} />);
    expect(screen.queryByText("robot.geo_take_profit_positive")).toBeNull();
  });

  it("参数可出预览但几何非法时显示几何错误", () => {
    // takeProfitPrice/count/step 齐全 → layout 非空；但止损区过大 → 几何非法
    const value = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "20", mainGridStep: "2", stopLossGridCount: "4", stopLossGridStep: "20" };
    render(<BoxForm value={value} onChange={() => {}} direction="LONG" price={2700} />);
    expect(screen.getByText(/robot\.geo_/)).toBeTruthy();
  });

  it("layout 非空且激活价越界时显示激活价错误", () => {
    // 几何合法 → layout 非空且无几何错误；激活价 9999 远高于止盈价 → 越界
    const value = { ...emptyBoxFormValue(), takeProfitPrice: "2800", mainGridCount: "200", mainGridStep: "2", stopLossGridStep: "2", activationPrice: "9999" };
    render(<BoxForm value={value} onChange={() => {}} direction="LONG" price={2700} />);
    expect(screen.getByText("robot.activation_range_error")).toBeTruthy();
  });
});

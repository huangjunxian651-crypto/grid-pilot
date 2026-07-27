import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { DateRangePicker, type DateRangeValue } from "../date-range-picker";

// react-day-picker 的 range-select 逻辑依据当前的 `selected` prop 判断"这是第一次点击(设 from)
// 还是第二次点击(补齐 to)"，因此必须像真实用法(page.tsx: value/onChange 受控)一样，用一个
// 持有 state 并把 onChange 结果回灌给 value 的宿主组件来驱动，否则两次点击都会被当成"重新开始"。
function ControlledHarness({ onChangeSpy }: { onChangeSpy: (v: DateRangeValue) => void }) {
  const [value, setValue] = React.useState<DateRangeValue>({ from: null, to: null });
  return (
    <DateRangePicker
      value={value}
      onChange={(v) => {
        onChangeSpy(v);
        setValue(v);
      }}
      testId="date-range"
    />
  );
}

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

describe("DateRangePicker", () => {
  it("默认(全部)时触发按钮显示'全部'文案", () => {
    render(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} testId="date-range" />);
    expect(screen.getByTestId("date-range-trigger").textContent).toContain("hist.range_all");
  });

  it("点击触发器展开弹窗，显示快捷预设按钮", () => {
    render(<DateRangePicker value={{ from: null, to: null }} onChange={() => {}} testId="date-range" />);
    fireEvent.click(screen.getByTestId("date-range-trigger"));
    expect(screen.getByTestId("date-range-preset-7d")).toBeTruthy();
    expect(screen.getByTestId("date-range-preset-30d")).toBeTruthy();
    expect(screen.getByTestId("date-range-preset-90d")).toBeTruthy();
    expect(screen.getByTestId("date-range-preset-all")).toBeTruthy();
  });

  it("点击'最近7天'预设，onChange 收到 from≈7天前、to≈现在，弹窗自动收起", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: null, to: null }} onChange={onChange} testId="date-range" />);
    fireEvent.click(screen.getByTestId("date-range-trigger"));
    fireEvent.click(screen.getByTestId("date-range-preset-7d"));

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0];
    expect(arg.to).toBeInstanceOf(Date);
    expect(arg.from).toBeInstanceOf(Date);
    // 用区间而非精确值断言：daysAgo(7) 清零到当天 0 点、to 取"现在"，实际跨度是
    // 7~8 天之间(取决于当前是几点)，精确断言 7 会因测试执行时刻不同而不稳定。
    const diffDays = (arg.to.getTime() - arg.from.getTime()) / 86400000;
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
    expect(screen.queryByTestId("date-range-preset-7d")).toBeNull(); // 弹窗已收起
  });

  it("点击'全部'预设，onChange 收到 {from:null, to:null}", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: new Date(), to: new Date() }} onChange={onChange} testId="date-range" />);
    fireEvent.click(screen.getByTestId("date-range-trigger"));
    fireEvent.click(screen.getByTestId("date-range-preset-all"));

    expect(onChange).toHaveBeenCalledWith({ from: null, to: null });
  });

  it("已选中具体区间时，触发按钮显示起止日期文字", () => {
    render(
      <DateRangePicker
        value={{ from: new Date("2026-06-01T00:00:00Z"), to: new Date("2026-06-20T00:00:00Z") }}
        onChange={() => {}}
        testId="date-range"
      />,
    );
    const text = screen.getByTestId("date-range-trigger").textContent ?? "";
    expect(text).toContain("2026-06-01");
    expect(text).toContain("2026-06-20");
  });

  it("手动在日历上连续点击两天(而非使用预设)，onChange 收到的 to 应为当天 23:59:59.999(而非午夜 00:00:00)——否则所选终止日当天发生的成交会被后端 filledAt<=until 静默排除", () => {
    const onChange = vi.fn();
    render(<ControlledHarness onChangeSpy={onChange} />);
    fireEvent.click(screen.getByTestId("date-range-trigger"));

    // react-day-picker@8 的日期格子渲染为 class="rdp-day"（月内真实日期，
    // 排除 rdp-day_outside 上/下月填充格），文本内容就是"几号"。
    const findDay = (day: number) => {
      const btn = Array.from(
        document.querySelectorAll<HTMLButtonElement>("button.rdp-day:not(.rdp-day_outside)"),
      ).find((b) => b.textContent?.trim() === String(day));
      if (!btn) throw new Error(`未找到日期格子: ${day}号`);
      return btn;
    };

    // 依次点击当月第 5 天(起点) → 第 20 天(终点)，模拟真实的两次点击选区间。
    // 不固定具体年月，直接用日历当前展示的月份，避免用例随时间推移变得脆弱。
    fireEvent.click(findDay(5));
    fireEvent.click(findDay(20));

    expect(onChange).toHaveBeenCalledTimes(2);
    const finalArg = onChange.mock.calls[1][0];
    expect(finalArg.from).toBeInstanceOf(Date);
    expect(finalArg.to).toBeInstanceOf(Date);
    expect(finalArg.from.getDate()).toBe(5);
    expect(finalArg.to.getDate()).toBe(20);
    // 核心断言：to 必须是选中当天的"日终"，而不是午夜 00:00:00
    expect(finalArg.to.getHours()).toBe(23);
    expect(finalArg.to.getMinutes()).toBe(59);
    expect(finalArg.to.getSeconds()).toBe(59);
    expect(finalArg.to.getMilliseconds()).toBe(999);
  });
});

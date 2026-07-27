import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { RobotSelect } from "../robot-select";
import type { Robot } from "@/lib/api";

const translations: Record<string, string> = {
  "hist.all_bots": "全部机器人",
  "hist.robot_running_now": "至今",
  "hist.robot_running_days": "已运行 {n} 天",
};

const mockTranslate = (k: string, params?: Record<string, any>) => {
  let result = translations[k] || k;
  if (params && params.n !== undefined) {
    result = result.replace("{n}", String(params.n));
  }
  return result;
};

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: mockTranslate, lang: "zh" }),
}));

function makeRobot(overrides: Partial<Robot> = {}): Robot {
  return {
    id: "r1", symbol: "ETH/USDT", direction: "LONG", status: "RUNNING",
    activeBoxId: null, activeSessionCode: null, managed: true, latestPrice: 2500,
    exchangeId: "binance", accountLabel: "demo", credentialId: "cred-1", boxCount: 1,
    realizedPnl: 0, totalFees: 0, totalFunding: 0, netPnl: 0, totalPnl: null,
    activeBoxHighPrice: null, activeBoxLowPrice: null, lastPositionQty: null,
    lastEntryPrice: null, lastUnrealizedPnl: null, lastSnapshotAt: null,
    stopStage: null, stopWarning: null,
    createdAt: "2026-06-01T00:00:00Z", endedAt: null,
    ...overrides,
  } as Robot;
}

describe("RobotSelect", () => {
  it("未选中时触发器显示'全部机器人'", () => {
    render(<RobotSelect robots={[makeRobot()]} value="" onChange={() => {}} testId="robot-select" />);
    expect(screen.getByTestId("robot-select-trigger").textContent).toContain("全部机器人");
  });

  it("点击触发器展开列表，每个机器人显示主行(交易对·账户·交易所)与副行(起止时间·运行天数)", () => {
    render(
      <RobotSelect
        robots={[makeRobot({ id: "r1", symbol: "BTC/USDT", accountLabel: "demo", exchangeId: "binance", createdAt: "2026-06-01T00:00:00Z", endedAt: null })]}
        value=""
        onChange={() => {}}
        testId="robot-select"
      />,
    );
    fireEvent.click(screen.getByTestId("robot-select-trigger"));
    const option = within(screen.getByTestId("robot-select-option-r1"));
    expect(option.getByText(/BTC\/USDT/)).toBeTruthy();
    expect(option.getByText(/demo/)).toBeTruthy();
    expect(option.getByText(/Binance/)).toBeTruthy();
    expect(option.getByText(/2026-06-01/)).toBeTruthy();
    expect(option.getByText(/至今/)).toBeTruthy();
  });

  it("已归档机器人(endedAt 非空)副行显示具体结束日期而非'至今'", () => {
    render(
      <RobotSelect
        robots={[makeRobot({ id: "r2", createdAt: "2026-05-10T00:00:00Z", endedAt: "2026-06-20T00:00:00Z" })]}
        value=""
        onChange={() => {}}
        testId="robot-select"
      />,
    );
    fireEvent.click(screen.getByTestId("robot-select-trigger"));
    const option = within(screen.getByTestId("robot-select-option-r2"));
    expect(option.getByText(/2026-06-20/)).toBeTruthy();
    expect(option.queryByText(/至今/)).toBeNull();
  });

  it("点击某个选项后 onChange(robotId) 且列表收起", () => {
    const onChange = vi.fn();
    render(<RobotSelect robots={[makeRobot({ id: "r1" })]} value="" onChange={onChange} testId="robot-select" />);
    fireEvent.click(screen.getByTestId("robot-select-trigger"));
    fireEvent.click(screen.getByTestId("robot-select-option-r1"));
    expect(onChange).toHaveBeenCalledWith("r1");
    expect(screen.queryByTestId("robot-select-option-r1")).toBeNull();
  });

  it("点击'全部机器人'选项后 onChange('')", () => {
    const onChange = vi.fn();
    render(<RobotSelect robots={[makeRobot({ id: "r1" })]} value="r1" onChange={onChange} testId="robot-select" />);
    fireEvent.click(screen.getByTestId("robot-select-trigger"));
    fireEvent.click(screen.getByTestId("robot-select-option-all"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});

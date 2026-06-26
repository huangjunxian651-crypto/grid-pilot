import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }), useRouter: () => ({ push: () => {} }) }));
vi.mock("@/lib/hooks/useCredentials", () => ({ useCredentials: () => ({ data: [{ id: "c1", exchangeId: "gateio", label: "g", accountId: "a" }] }) }));
vi.mock("@/lib/api", () => ({ robotApi: { get: vi.fn(), create: vi.fn(), addBox: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => React.createElement("div", { "data-testid": "grid-ladder-stub" }),
}));

import { RobotWizard } from "../robot-wizard";

describe("RobotWizard 第 1 步交易对", () => {
  it("渲染 SymbolPicker 的推荐 chip", () => {
    render(<RobotWizard />);
    expect(screen.getByTestId("symbol-chip-BTC/USDT")).toBeTruthy();
  });

  it("未选交易对时（空 symbol）下一步被阻断，仍停留第 1 步", () => {
    render(<RobotWizard />);
    // 先选一个账户
    fireEvent.change(screen.getByTestId("wizard-cred-select"), { target: { value: "c1" } });
    // 切到自定义模式并清空
    fireEvent.click(screen.getByTestId("symbol-tab-custom"));
    // 此时 symbol="" → 阻断
    fireEvent.click(screen.getByTestId("wizard-next"));
    // 仍停在第 1 步
    expect(screen.getByTestId("wizard-cred-select")).toBeTruthy();
  });

  it("山寨 symbol 未勾选确认时下一步被阻断", () => {
    render(<RobotWizard />);
    fireEvent.change(screen.getByTestId("wizard-cred-select"), { target: { value: "c1" } });
    fireEvent.click(screen.getByTestId("symbol-tab-custom"));
    fireEvent.change(screen.getByTestId("symbol-custom-input"), { target: { value: "PEPE/USDT" } });
    // alt 未确认 → blocked
    fireEvent.click(screen.getByTestId("wizard-next"));
    expect(screen.getByTestId("wizard-cred-select")).toBeTruthy();
  });

  it("推荐 chip 选中后下一步可通过", () => {
    render(<RobotWizard />);
    fireEvent.change(screen.getByTestId("wizard-cred-select"), { target: { value: "c1" } });
    fireEvent.click(screen.getByTestId("symbol-chip-BTC/USDT"));
    fireEvent.click(screen.getByTestId("wizard-next"));
    // 进入第 2 步：wizard-box-add 可见
    expect(screen.getByTestId("wizard-box-add")).toBeTruthy();
  });
});

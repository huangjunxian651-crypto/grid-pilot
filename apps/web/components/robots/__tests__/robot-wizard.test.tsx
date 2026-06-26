import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockPush = vi.fn();
let searchFrom: string | null = null;
let searchSeedBox: string | null = null;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: (k: string) => (k === "from" ? searchFrom : k === "seedBox" ? searchSeedBox : null) }),
}));

const robotGet = vi.fn();
const robotCreate = vi.fn();
const robotAddBox = vi.fn();
vi.mock("@/lib/api", () => ({
  robotApi: {
    get: (...a: unknown[]) => robotGet(...a),
    create: (...a: unknown[]) => robotCreate(...a),
    addBox: (...a: unknown[]) => robotAddBox(...a),
  },
}));

vi.mock("@/lib/hooks/useCredentials", () => ({
  useCredentials: () => ({ data: [
    { id: "cred-1", exchangeId: "binance", label: "demo", accountId: "uid-1" },
    { id: "cred-2", exchangeId: "okx", label: "main", accountId: "uid-2" },
  ] }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// GridLadder 依赖 window.matchMedia（jsdom 无此 API），用轻量存根替代
vi.mock("@/components/charts/grid-ladder", () => ({
  GridLadder: () => React.createElement("div", { "data-testid": "grid-ladder-stub" }),
}));

import { RobotWizard } from "../robot-wizard";

function wrap(ui: React.ReactNode) {
  return <>{ui}</>;
}

const SEED = {
  id: "src-1", symbol: "SOL/USDT", direction: "LONG", credentialId: "cred-2",
  boxes: [{
    id: "b1", direction: "LONG", takeProfitPrice: 200, mainGridCount: 20, mainGridStep: 1,
    mainGridPortionSize: 0.1, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 1,
    isolationStep: 1, activationPrice: 0, trailingEntry: false, trailingCallbackRate: 0,
    excessProfitMultiplier: 0, reorderThreshold: 0, enabled: true,
  }],
};

beforeEach(() => {
  mockPush.mockClear(); robotGet.mockReset(); robotCreate.mockReset(); robotAddBox.mockReset();
  searchFrom = null;
  searchSeedBox = null;
});

describe("RobotWizard", () => {
  it("无 from：第1步账户必选，未选不可进入第2步", async () => {
    render(wrap(<RobotWizard />));
    fireEvent.click(screen.getByTestId("wizard-next"));
    // 仍在第1步：账户选择框可见
    expect(screen.getByTestId("wizard-cred-select")).toBeTruthy();
  });

  it("有 from：用种子预填交易对/方向/账户/箱体", async () => {
    searchFrom = "src-1";
    robotGet.mockResolvedValue(SEED);
    render(wrap(<RobotWizard />));
    // 等种子账户加载：credentialId 变为 "cred-2"
    await waitFor(() => {
      expect((screen.getByTestId("wizard-cred-select") as HTMLSelectElement).value).toBe("cred-2");
    });
    // SOL/USDT 是推荐 chip，应在页面上
    expect(screen.getByTestId("symbol-chip-SOL/USDT")).toBeTruthy();
  });

  // 辅助：等种子加载完（credentialId 变为 cred-2），再走完三步到「创建」。
  // 必须等种子——否则箱体仍是空白默认，第2步校验会拦下。
  async function advanceToReview() {
    await waitFor(() =>
      expect((screen.getByTestId("wizard-cred-select") as HTMLSelectElement).value).toBe("cred-2"),
    );
    fireEvent.click(screen.getByTestId("wizard-next")); // 基础→箱体
    fireEvent.click(screen.getByTestId("wizard-next")); // 箱体→复核
  }

  it("提交：先 create 再逐箱 addBox，全部成功后跳详情页", async () => {
    searchFrom = "src-1";
    robotGet.mockResolvedValue(SEED);
    robotCreate.mockResolvedValue({ success: true, robotId: "new-1" });
    robotAddBox.mockResolvedValue({ success: true, boxId: "nb-1" });
    render(wrap(<RobotWizard />));
    await advanceToReview();
    fireEvent.click(screen.getByTestId("wizard-create"));
    await waitFor(() => expect(robotCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(robotAddBox).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/robots/new-1"));
  });

  it("约束冲突：create 抛错则停留第3步显示错误、不跳转", async () => {
    searchFrom = "src-1";
    robotGet.mockResolvedValue(SEED);
    robotCreate.mockRejectedValue(new Error("该账户+交易对已有活跃机器人"));
    render(wrap(<RobotWizard />));
    await advanceToReview();
    fireEvent.click(screen.getByTestId("wizard-create"));
    await waitFor(() => expect(screen.getByTestId("wizard-create-error")).toBeTruthy());
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("某箱失败：create 成功但 addBox 抛错 → 跳详情页", async () => {
    searchFrom = "src-1";
    robotGet.mockResolvedValue(SEED);
    robotCreate.mockResolvedValue({ success: true, robotId: "new-9" });
    robotAddBox.mockRejectedValue(new Error("箱体参数非法"));
    render(wrap(<RobotWizard />));
    await advanceToReview();
    fireEvent.click(screen.getByTestId("wizard-create"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/robots/new-9"));
  });

  it("有 seedBox：预填交易对/方向/箱体", async () => {
    searchSeedBox = JSON.stringify({
      symbol: "SOL/USDT", direction: "SHORT",
      box: { takeProfitPrice: 200, mainGridCount: 20, mainGridStep: 1, mainGridPortionSize: 0.1, leverage: 20, stopLossGridCount: 4, stopLossGridStep: 1, isolationStep: 1 },
    });
    render(wrap(<RobotWizard />));
    // SOL/USDT 方向 SHORT 已预填（同步 useEffect，可直接断言）
    await waitFor(() => expect((screen.getByTestId("wizard-dir-select") as HTMLSelectElement).value).toBe("SHORT"));
    // SOL/USDT 是推荐 chip，应渲染
    expect(screen.getByTestId("symbol-chip-SOL/USDT")).toBeTruthy();
  });

  it("seedBox 非法 JSON 静默回退默认", async () => {
    searchSeedBox = "not-json";
    render(wrap(<RobotWizard />));
    // 默认值 ETH/USDT 是推荐 chip，应渲染；方向为默认 LONG
    expect(screen.getByTestId("symbol-chip-ETH/USDT")).toBeTruthy();
    expect((screen.getByTestId("wizard-dir-select") as HTMLSelectElement).value).toBe("LONG");
  });
});

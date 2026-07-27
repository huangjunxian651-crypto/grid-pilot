import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string, params?: Record<string, string | number>) => {
    if (!params) return k;
    return `${k}:${JSON.stringify(params)}`;
  } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args), error: (...args: unknown[]) => toastError(...args) } }));

type ReconcileResult = { newFillsCount: number; dbPosition: number; exchangePosition: number; positionMatches: boolean };
const mutate = vi.fn<(robotId: string, opts?: { onSuccess?: (result: ReconcileResult) => void }) => void>();
vi.mock("@/lib/hooks/useBots", () => ({
  useReconcileRobot: () => ({ mutate, isPending: false }),
}));

import { ReconcileButton } from "../_reconcile-button";

describe("ReconcileButton", () => {
  beforeEach(() => {
    mutate.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("status=RUNNING 时渲染按钮；status=STOPPED 时不渲染", () => {
    const { rerender } = render(<ReconcileButton robotId="r1" status="RUNNING" />);
    expect(screen.getByTestId("reconcile-btn")).toBeInTheDocument();

    rerender(<ReconcileButton robotId="r1" status="STOPPED" />);
    expect(screen.queryByTestId("reconcile-btn")).not.toBeInTheDocument();
  });

  it("status=PAUSED 时也渲染按钮", () => {
    render(<ReconcileButton robotId="r1" status="PAUSED" />);
    expect(screen.getByTestId("reconcile-btn")).toBeInTheDocument();
  });

  it("点击后调用 reconcile 接口，成功后 toast 展示新增成交数与持仓对比", async () => {
    mutate.mockImplementation((_id, opts) => {
      opts?.onSuccess?.({ newFillsCount: 2, dbPosition: 0.55, exchangePosition: 0.55, positionMatches: true });
    });
    render(<ReconcileButton robotId="r1" status="RUNNING" />);
    fireEvent.click(screen.getByTestId("reconcile-btn"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith("r1", expect.objectContaining({ onSuccess: expect.any(Function) })));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("持仓仍不一致时 toast 文案走 reconcile_position_diff", async () => {
    mutate.mockImplementation((_id, opts) => {
      opts?.onSuccess?.({ newFillsCount: 0, dbPosition: 0.475, exchangePosition: 0.55, positionMatches: false });
    });
    render(<ReconcileButton robotId="r1" status="RUNNING" />);
    fireEvent.click(screen.getByTestId("reconcile-btn"));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("robot.reconcile_position_diff"),
      ),
    );
  });

  it("请求失败时不在本地弹 toast——交给全局 MutationCache.onError 统一处理（与 Pause/Start 按钮一致），避免重复提示且绕过 i18n", async () => {
    // mutate() 失败时只经由全局 MutationCache.onError 处理；组件没有传 onError，
    // 所以这里的 mock 不调用任何回调，模拟"失败且组件本身什么都不做"。
    mutate.mockImplementation(() => {});
    render(<ReconcileButton robotId="r1" status="RUNNING" />);
    fireEvent.click(screen.getByTestId("reconcile-btn"));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith("r1", expect.objectContaining({ onSuccess: expect.any(Function) })));
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

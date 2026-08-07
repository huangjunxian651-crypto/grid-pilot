import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useConfirmStore } from "@/lib/hooks/useConfirm";
import { Providers } from "../providers";

/**
 * 端到端验证 Providers 真实挂载了 ConfirmDialogHost（Finding 2）。
 *
 * 只 mock useAuth：Providers 内的 LanguageSync 依赖它发起 /auth/me 请求，
 * 在测试环境下会触发真实 fetch（相对路径在 Node 原生 fetch 下会抛错），
 * 与本测试要验证的“store → 真实 ConfirmDialogHost”这条链路无关，属于
 * 无关依赖，mock 掉以避免噪音/不稳定。QueryClientProvider、I18nProvider、
 * TickerProvider、ConfirmDialogHost 全部使用真实实现，未做任何替身。
 */
vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: null }),
}));

function Trigger() {
  const handleClick = () => {
    useConfirmStore.getState().request({
      tier: "simple",
      title: "标题",
      body: "内容",
    });
  };
  return <button onClick={handleClick}>trigger</button>;
}

describe("Providers 挂载 ConfirmDialogHost（端到端）", () => {
  it("通过真实 Providers 树请求确认时，真实 ConfirmDialogHost 会渲染弹窗", async () => {
    render(
      <Providers>
        <Trigger />
      </Providers>,
    );

    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("trigger"));

    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
  });
});

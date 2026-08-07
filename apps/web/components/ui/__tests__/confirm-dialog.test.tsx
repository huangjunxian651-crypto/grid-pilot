import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useConfirmStore } from "@/lib/hooks/useConfirm";
import { ConfirmDialogHost } from "../confirm-dialog";

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh" }),
}));

function Trigger({ onResult, ...options }: {
  onResult: (v: boolean) => void;
  tier: "simple" | "destructive";
  title: string;
  body: string;
  confirmWord?: string;
  confirmHint?: string;
}) {
  const handleClick = () => {
    useConfirmStore.getState().request(options).then(onResult);
  };
  return <button onClick={handleClick}>trigger</button>;
}

function renderHost(props: Omit<Parameters<typeof Trigger>[0], "onResult"> & { onResult: (v: boolean) => void }) {
  return render(
    <>
      <Trigger {...props} />
      <ConfirmDialogHost />
    </>,
  );
}

describe("ConfirmDialogHost", () => {
  it("未触发确认请求时不渲染任何内容", () => {
    render(<ConfirmDialogHost />);
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("simple tier：点击确认按钮 resolve(true)", async () => {
    const results: boolean[] = [];
    renderHost({ tier: "simple", title: "标题", body: "内容", onResult: (v) => results.push(v) });
    fireEvent.click(screen.getByText("trigger"));
    expect(await screen.findByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("内容")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("simple tier：点击取消按钮 resolve(false)", async () => {
    const results: boolean[] = [];
    renderHost({ tier: "simple", title: "标题", body: "内容", onResult: (v) => results.push(v) });
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-dialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(results).toEqual([false]));
  });

  it("simple tier：不渲染文字确认输入框", async () => {
    renderHost({ tier: "simple", title: "标题", body: "内容", onResult: () => {} });
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-dialog");
    expect(screen.queryByTestId("confirm-dialog-input")).not.toBeInTheDocument();
  });

  it("destructive tier：输入内容与 confirmWord 不一致时确认按钮禁用", async () => {
    renderHost({ tier: "destructive", title: "标题", body: "内容", confirmWord: "DELETE", onResult: () => {} });
    fireEvent.click(screen.getByText("trigger"));
    const confirmBtn = await screen.findByTestId("confirm-dialog-confirm");
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByTestId("confirm-dialog-input"), { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();
  });

  it("destructive tier：输入内容与 confirmWord 一致后可点击确认，resolve(true)", async () => {
    const results: boolean[] = [];
    renderHost({ tier: "destructive", title: "标题", body: "内容", confirmWord: "DELETE", onResult: (v) => results.push(v) });
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.change(await screen.findByTestId("confirm-dialog-input"), { target: { value: "DELETE" } });
    const confirmBtn = screen.getByTestId("confirm-dialog-confirm");
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(results).toEqual([true]));
  });

  it("destructive tier：新请求覆盖前一个未 resolve 的请求时，输入框不残留旧值", async () => {
    renderHost({ tier: "destructive", title: "第一次", body: "内容", confirmWord: "DELETE", onResult: () => {} });
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.change(await screen.findByTestId("confirm-dialog-input"), { target: { value: "leftover" } });
    expect(screen.getByTestId("confirm-dialog-input")).toHaveValue("leftover");

    // 模拟另一个调用点在第一次请求尚未 resolve 时直接发起新请求，
    // useConfirmStore.request() 会让 pending 从一个对象直接变为另一个对象，不经过 null。
    useConfirmStore.getState().request({ tier: "destructive", title: "第二次", body: "内容", confirmWord: "DELETE" });

    await waitFor(() => expect(screen.getByText("第二次")).toBeInTheDocument());
    expect(screen.getByTestId("confirm-dialog-input")).toHaveValue("");
  });

  it("destructive tier：传入 confirmHint 时，在输入框上方渲染指引文案并关联 htmlFor", async () => {
    renderHost({
      tier: "destructive",
      title: "标题",
      body: "内容",
      confirmWord: "CLEAR",
      confirmHint: '请输入 "CLEAR" 以确认',
      onResult: () => {},
    });
    fireEvent.click(screen.getByText("trigger"));
    const hint = await screen.findByTestId("confirm-dialog-hint");
    expect(hint).toHaveTextContent('请输入 "CLEAR" 以确认');
    expect(hint).toHaveAttribute("for", "confirm-dialog-input");
    expect(screen.getByTestId("confirm-dialog-input")).toHaveAttribute("id", "confirm-dialog-input");
  });

  it("destructive tier：未传入 confirmHint 时不渲染指引文案（占位符仍展示字面量）", async () => {
    renderHost({ tier: "destructive", title: "标题", body: "内容", confirmWord: "DELETE", onResult: () => {} });
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByTestId("confirm-dialog-input");
    expect(screen.queryByTestId("confirm-dialog-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-input")).toHaveAttribute("placeholder", "DELETE");
  });

  it("destructive tier：输入内容前后空格会被 trim 后比对", async () => {
    const results: boolean[] = [];
    renderHost({ tier: "destructive", title: "标题", body: "内容", confirmWord: "DELETE", onResult: (v) => results.push(v) });
    fireEvent.click(screen.getByText("trigger"));
    fireEvent.change(await screen.findByTestId("confirm-dialog-input"), { target: { value: "  DELETE  " } });
    const confirmBtn = screen.getByTestId("confirm-dialog-confirm");
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(results).toEqual([true]));
  });
});

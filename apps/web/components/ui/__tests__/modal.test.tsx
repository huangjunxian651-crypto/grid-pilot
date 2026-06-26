import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Modal } from "../modal";

describe("Modal", () => {
  it("open=false 不渲染", () => {
    render(<Modal open={false} title="详情" onClose={() => {}}>内容</Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("open=true 渲染标题+内容", () => {
    render(<Modal open title="成交详情" onClose={() => {}}><div>BODY</div></Modal>);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("成交详情")).toBeTruthy();
    expect(screen.getByText("BODY")).toBeTruthy();
  });

  it("点关闭按钮触发 onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="t" onClose={onClose}>x</Modal>);
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("按 Esc 触发 onClose", () => {
    const onClose = vi.fn();
    render(<Modal open title="t" onClose={onClose}>x</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点遮罩关闭，点内容区不关闭", () => {
    const onClose = vi.fn();
    render(<Modal open title="t" onClose={onClose}><div>BODY</div></Modal>);
    fireEvent.click(screen.getByTestId("modal-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("BODY"));
    expect(onClose).toHaveBeenCalledTimes(1); // 仍是 1，内容区点击不冒泡到遮罩
  });
});

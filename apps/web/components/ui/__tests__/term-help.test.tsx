import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }) }));
import { TermHelp } from "../term-help";

describe("TermHelp", () => {
  it("渲染 Info 触发器；点击弹出概念+提示", () => {
    render(<TermHelp term="fee" title="手续费" />);
    const trigger = screen.getByTestId("term-help-fee");
    expect(trigger).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(screen.getByText("help.fee.concept")).toBeTruthy();   // concept key (t 回显 key)
    expect(screen.getByText(/help.fee.note/)).toBeTruthy();       // note key
  });
  it("未知 term 安全降级（不渲染触发器）", () => {
    const { container } = render(<TermHelp term="nope" />);
    expect(container.querySelector('[data-testid^="term-help"]')).toBeNull();
  });

  it("默认向右展开（左侧有足够空间）", () => {
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 112, top: 0, bottom: 12, width: 12, height: 12, x: 100, y: 0, toJSON: () => ({}),
    } as DOMRect);
    (window as unknown as { innerWidth: number }).innerWidth = 1024;
    render(<TermHelp term="fee" title="手续费" />);
    fireEvent.click(screen.getByTestId("term-help-fee"));
    expect(screen.getByRole("tooltip").getAttribute("data-placement")).toBe("right");
    spy.mockRestore();
  });

  it("贴近右边缘时翻转到左侧展开，避免被遮住", () => {
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 980, right: 992, top: 0, bottom: 12, width: 12, height: 12, x: 980, y: 0, toJSON: () => ({}),
    } as DOMRect);
    (window as unknown as { innerWidth: number }).innerWidth = 1024;
    render(<TermHelp term="fee" title="手续费" />);
    fireEvent.click(screen.getByTestId("term-help-fee"));
    expect(screen.getByRole("tooltip").getAttribute("data-placement")).toBe("left");
    spy.mockRestore();
  });

  it("恰好放得下时保持向右（边界：left + 宽度 + 边距 == innerWidth）", () => {
    // 260(宽) + 8(边距) = 268；left=756 时正好抵满 1024，严格大于不成立 → 仍向右
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 756, right: 768, top: 0, bottom: 12, width: 12, height: 12, x: 756, y: 0, toJSON: () => ({}),
    } as DOMRect);
    (window as unknown as { innerWidth: number }).innerWidth = 1024;
    render(<TermHelp term="fee" title="手续费" />);
    fireEvent.click(screen.getByTestId("term-help-fee"));
    expect(screen.getByRole("tooltip").getAttribute("data-placement")).toBe("right");
    spy.mockRestore();
  });
});

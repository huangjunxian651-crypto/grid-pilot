import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { TableScroll } from "../table-scroll";

// jsdom 不跑真实布局引擎，scrollWidth/clientWidth 恒为 0——手动在真实 DOM 节点上
// 打桩这两个只读 getter，模拟"内容比容器宽"（溢出）与"内容能放下"（不溢出）两种场景。
function stubOverflow(el: Element, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
}

describe("TableScroll", () => {
  it("内容未溢出容器时不标记 data-overflowing，不应用淡出遮罩", () => {
    render(<TableScroll><table><tbody><tr><td>x</td></tr></tbody></table></TableScroll>);
    const el = screen.getByTestId("table-scroll");
    act(() => { stubOverflow(el, 300, 300); window.dispatchEvent(new Event("resize")); });
    expect(el).not.toHaveAttribute("data-overflowing");
  });

  it("内容溢出容器时标记 data-overflowing，供 CSS 只在真正需要滚动时应用淡出遮罩", () => {
    render(<TableScroll><table><tbody><tr><td>x</td></tr></tbody></table></TableScroll>);
    const el = screen.getByTestId("table-scroll");
    act(() => { stubOverflow(el, 900, 300); window.dispatchEvent(new Event("resize")); });
    expect(el).toHaveAttribute("data-overflowing", "true");
  });

  it("窗口从溢出变为不溢出（如放大窗口）时会撤销 data-overflowing 标记", () => {
    render(<TableScroll><table><tbody><tr><td>x</td></tr></tbody></table></TableScroll>);
    const el = screen.getByTestId("table-scroll");
    act(() => { stubOverflow(el, 900, 300); window.dispatchEvent(new Event("resize")); });
    expect(el).toHaveAttribute("data-overflowing", "true");
    act(() => { stubOverflow(el, 300, 300); window.dispatchEvent(new Event("resize")); });
    expect(el).not.toHaveAttribute("data-overflowing");
  });

  it("始终携带 gp-table-scroll 类名，保留 min-width:720px 等既有表格样式", () => {
    render(<TableScroll><table><tbody><tr><td>x</td></tr></tbody></table></TableScroll>);
    expect(screen.getByTestId("table-scroll")).toHaveClass("gp-table-scroll");
  });

  it("异步内容到达后重渲染即可感知新的溢出状态，不依赖 window resize 事件", () => {
    // 常见场景：首次渲染是窄的"加载中"占位行，异步数据到达后子节点变宽产生溢出——
    // 这个过程不会触发 window resize，只会触发一次 React 重渲染。
    const { rerender } = render(
      <TableScroll><table><tbody><tr><td>加载中</td></tr></tbody></table></TableScroll>,
    );
    const el = screen.getByTestId("table-scroll");
    stubOverflow(el, 300, 300);
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(el).not.toHaveAttribute("data-overflowing");

    stubOverflow(el, 900, 300);
    act(() => {
      rerender(<TableScroll><table><tbody><tr><td>真实数据到达，行变宽了</td></tr></tbody></table></TableScroll>);
    });
    expect(el).toHaveAttribute("data-overflowing", "true");
  });
});

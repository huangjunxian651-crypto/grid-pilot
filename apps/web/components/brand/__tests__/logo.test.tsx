import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { LogoMark, LogoWordmark } from "../logo";

describe("Logo 上升柱状图方案（对齐仪表盘设计稿）", () => {
  it("LogoMark 渲染带 aria-label 的 svg", () => {
    render(<LogoMark size={32} />);
    const img = screen.getByRole("img", { name: "GridPilot" });
    expect(img.tagName.toLowerCase()).toBe("svg");
    expect(img.getAttribute("width")).toBe("32");
  });

  it("含 9 根青色柱（1-2-3-3 上升，由 g 着色）", () => {
    const { container } = render(<LogoMark size={32} />);
    const accentGroup = Array.from(container.querySelectorAll("g")).find(
      (g) => (g.getAttribute("style") ?? "").includes("var(--accent)"),
    );
    expect(accentGroup).toBeTruthy();
    expect(accentGroup!.querySelectorAll("rect").length).toBe(9);
  });

  it("含顶部金色 Alpha 方块 (x=35,y=10)", () => {
    const { container } = render(<LogoMark size={32} />);
    const gold = container.querySelector("rect[x='35'][y='10']");
    expect(gold?.getAttribute("style") ?? "").toContain("var(--alpha)");
  });

  it("LogoWordmark 含字标 Grid/Pilot，宽度按 200:48 比例，display 字体", () => {
    const { container } = render(<LogoWordmark height={48} />);
    const img = screen.getByRole("img", { name: "GridPilot" });
    expect(img.getAttribute("width")).toBe("200");
    expect(img.textContent).toContain("Grid");
    expect(img.textContent).toContain("Pilot");
    const text = container.querySelector("text");
    expect(text?.getAttribute("font-family")).toContain("Space Grotesk");
  });

  it("同页多个实例无渐变 id 冲突（柱状方案不含渐变）", () => {
    const { container } = render(
      <>
        <LogoMark />
        <LogoMark />
      </>,
    );
    expect(container.querySelectorAll("linearGradient").length).toBe(0);
    // 两个实例各自含金色顶块
    expect(container.querySelectorAll("rect[x='35'][y='10']").length).toBe(2);
  });
});

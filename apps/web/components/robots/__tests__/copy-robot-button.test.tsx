import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { CopyRobotButton } from "../copy-robot-button";

// Mock next/link 以简化测试
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/i18n-context", () => ({ useLang: () => ({ t: (k: string) => k, lang: "zh" }) }));

describe("CopyRobotButton", () => {
  it("渲染为指向 /robots/new?from=<id> 的链接", () => {
    render(<CopyRobotButton robotId="r-123" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/robots/new?from=r-123");
  });

  it("显示「复制」文案", () => {
    render(<CopyRobotButton robotId="r-1" />);
    expect(screen.getByText("common.copy")).toBeTruthy();
  });
});

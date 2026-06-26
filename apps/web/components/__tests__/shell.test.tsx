import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/shell/shell";

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const mockLogout = vi.fn();
let mockAuthUser: { id: string; email: string; displayName: string; language: string } | null = { id: "u1", email: "alice@example.com", displayName: "Alice Wang", language: "en" };
let mockRunningBots: { sessionCode: string }[] = [];

vi.mock("next/navigation", () => ({
  usePathname: () => "/bots",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({
    t: (key: string) => key,
    lang: "en",
    setLang: () => {},
  }),
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
  useIsTablet: () => false,
}));

vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: mockAuthUser }),
  useLogout: () => ({ mutate: mockLogout }),
}));

vi.mock("@/lib/hooks/useNotifications", () => ({
  useNotifications: () => ({ unreadCount: 0, notifications: [], prefs: {}, togglePref: () => {} }),
}));

vi.mock("@/lib/hooks/useBots", () => ({
  useRunningBots: () => ({ data: mockRunningBots }),
}));

vi.mock("@/lib/hooks/useProfile", () => ({
  useUpdateProfile: () => ({ mutate: () => {} }),
}));

describe("Shell", () => {
  beforeEach(() => {
    mockAuthUser = { id: "u1", email: "alice@example.com", displayName: "Alice Wang", language: "en" };
    mockRunningBots = [];
    mockLogout.mockClear();
  });

  it("renders all navigation items", () => {
    render(wrap(<Shell><div>Page Content</div></Shell>));
    const nav = document.querySelector("nav");
    expect(nav).toBeInTheDocument();
    if (nav) {
      const navScope = within(nav as HTMLElement);
      expect(navScope.getByText("nav.dashboard")).toBeInTheDocument();
      expect(navScope.getByText("nav.robots")).toBeInTheDocument();
      expect(navScope.getByText("nav.history")).toBeInTheDocument();
      expect(navScope.getByText("nav.ai")).toBeInTheDocument();
      expect(navScope.getByText("nav.keys")).toBeInTheDocument();
      expect(navScope.getByText("nav.notifications")).toBeInTheDocument();
      expect(navScope.getByText("nav.settings")).toBeInTheDocument();
    }
  });

  it("navigation links have correct hrefs", () => {
    render(wrap(<Shell><div>Page Content</div></Shell>));
    const nav = document.querySelector("nav");
    expect(nav).toBeInTheDocument();
    if (nav) {
      const navScope = within(nav as HTMLElement);
      expect(navScope.getByText("nav.dashboard").closest("a")).toHaveAttribute("href", "/dashboard");
      expect(navScope.getByText("nav.robots").closest("a")).toHaveAttribute("href", "/robots");
      expect(navScope.getByText("nav.history").closest("a")).toHaveAttribute("href", "/history");
      expect(navScope.getByText("nav.ai").closest("a")).toHaveAttribute("href", "/ai");
      expect(navScope.getByText("nav.keys").closest("a")).toHaveAttribute("href", "/keys");
      expect(navScope.getByText("nav.notifications").closest("a")).toHaveAttribute("href", "/notifications");
      expect(navScope.getByText("nav.settings").closest("a")).toHaveAttribute("href", "/settings");
    }
  });

  it("renders children content", () => {
    render(wrap(<Shell><div data-testid="child-content">Hello from child</div></Shell>));
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("Hello from child")).toBeInTheDocument();
  });

  it("shows avatar with initials from displayName", () => {
    render(wrap(<Shell><div>Content</div></Shell>));
    expect(screen.getByText("AW")).toBeInTheDocument();
  });

  it("falls back to email initial when displayName is empty", () => {
    mockAuthUser = { id: "u1", email: "bob@example.com", displayName: "", language: "en" };
    render(wrap(<Shell><div>Content</div></Shell>));
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("opens user menu on avatar click and shows email + logout", () => {
    render(wrap(<Shell><div>Content</div></Shell>));
    const avatar = screen.getByText("AW");
    fireEvent.click(avatar);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    const logoutBtn = screen.getByText("top.user_menu.logout");
    fireEvent.click(logoutBtn);
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  it("user menu contains link to settings", () => {
    render(wrap(<Shell><div>Content</div></Shell>));
    const avatar = screen.getByText("AW");
    fireEvent.click(avatar);
    const settingsLink = screen.getByText("top.user_menu.settings");
    expect(settingsLink.closest("a")).toHaveAttribute("href", "/settings");
  });

  // 旧 bots 侧边栏 badge 用例已移除：导航统一为单一"机器人"(/robots)项，不再有运行计数 badge。

  it("帮助区含手续费文档入口链接到 /learn/fees", () => {
    render(wrap(<Shell><div>Content</div></Shell>));
    const link = screen.getByText("learn.fees.nav").closest("a") as HTMLAnchorElement;
    expect(link).toBeInTheDocument();
    expect(link.getAttribute("href")).toBe("/learn/fees");
  });

  it("激活导航项含左侧青色指示条", () => {
    render(wrap(<Shell><div>Content</div></Shell>));
    // usePathname mock 返回 /bots → getActive 回退到 dashboard（默认）
    const nav = document.querySelector("nav");
    const dashLink = within(nav as HTMLElement).getByText("nav.dashboard").closest("a");
    const indicator = dashLink?.querySelector("[data-testid='nav-active-indicator']");
    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute("style") ?? "").toContain("var(--accent)");
  });
});

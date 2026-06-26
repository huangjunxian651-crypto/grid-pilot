import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LoginPage from "@/app/login/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/i18n-context", () => ({
  useLang: () => ({ t: (k: string) => k, lang: "zh", setLang: () => {} }),
}));
vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: () => ({ data: null, isLoading: false }),
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRegister: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/store", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store")>("@/lib/store");
  return { ...actual, useThemeStore: () => ({ theme: "dark", toggleTheme: vi.fn() }) };
});

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("登录页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("默认渲染 login 模式与邮箱表单", () => {
    render(wrap(<LoginPage />));
    expect(screen.getByText("login.welcome_back")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/login\.email_placeholder|^you@/)).toBeInTheDocument();
  });

  it("切换到 register 模式", () => {
    render(wrap(<LoginPage />));
    fireEvent.click(screen.getByText("login.create_ws"));
    expect(screen.getByText("login.create_account")).toBeInTheDocument();
  });

  it("forgot 模式可切换并展示重置标题与提示", () => {
    render(wrap(<LoginPage />));
    fireEvent.click(screen.getByText("login.forgot_link"));
    expect(screen.getByText("login.forgot_title")).toBeInTheDocument();
    expect(screen.getByText("login.forgot_hint")).toBeInTheDocument();
  });

  it("渲染三所静态信任条", () => {
    const { container } = render(wrap(<LoginPage />));
    expect(screen.getByText("login.trust_exchanges")).toBeInTheDocument();
    // ExchangeMark 渲染 svg（logo + 三所 + 特性图标等，>3）
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(3);
  });

  it("存在主题切换与语言切换控件", () => {
    render(wrap(<LoginPage />));
    expect(screen.getByTestId("login-theme-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("login-lang-toggle")).toBeInTheDocument();
  });
});

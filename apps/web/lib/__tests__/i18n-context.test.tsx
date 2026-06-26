import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { I18nProvider, useLang } from "@/lib/i18n-context";
import { LanguageSync } from "@/components/shell/language-sync";
import type { Lang } from "@/lib/i18n";

// Mock useAuth at module level (required by vitest)
vi.mock("@/lib/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// Helper to mock navigator.language
function mockNavigatorLanguage(lang: string) {
  Object.defineProperty(global, "navigator", {
    value: { language: lang },
    writable: true,
    configurable: true,
  });
}

// Test component that exposes lang state and setLang for testing
function TestConsumer({ onLangChange }: { onLangChange?: (lang: string) => void }) {
  const { lang, setLang, t } = useLang();
  return (
    <div>
      <span data-testid="current-lang">{lang}</span>
      <span data-testid="translated">{t("common.save")}</span>
      <button
        data-testid="set-zh"
        onClick={() => {
          setLang("zh");
          onLangChange?.("zh");
        }}
      >
        Set Chinese
      </button>
      <button
        data-testid="set-en"
        onClick={() => {
          setLang("en");
          onLangChange?.("en");
        }}
      >
        Set English
      </button>
      <button
        data-testid="set-ja"
        onClick={() => {
          setLang("ja");
          onLangChange?.("ja");
        }}
      >
        Set Japanese
      </button>
    </div>
  );
}

describe("I18nProvider", () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    localStorage.clear();
    // Clear all cookies in jsdom
    document.cookie.split(";").forEach((c) => {
      const [name] = c.split("=");
      if (name) document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
    mockNavigatorLanguage("zh-CN");
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("初始化为 zh（无 localStorage 时回退到浏览器检测）", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    expect(screen.getByTestId("current-lang").textContent).toBe("zh");
    expect(document.documentElement.getAttribute("lang")).toBe("zh-CN");
  });

  it("从 localStorage 读取已保存的语言", async () => {
    localStorage.setItem("gp.lang", "en");
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("current-lang").textContent).toBe("en");
    });
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("setLang 更新状态并写入 localStorage", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId("set-en").click();
    });

    expect(screen.getByTestId("current-lang").textContent).toBe("en");
    expect(localStorage.getItem("gp.lang")).toBe("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("setLang 更新 HTML dir 属性（LTR 语言）", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId("set-ja").click();
    });

    expect(document.documentElement.getAttribute("dir")).toBe("ltr");
  });

  it("setLang 更新 HTML dir 属性（RTL 语言 ar）", () => {
    function RtlConsumer() {
      const { setLang } = useLang();
      return (
        <button data-testid="set-ar" onClick={() => setLang("ar")}>
          Set Arabic
        </button>
      );
    }

    render(
      <I18nProvider>
        <RtlConsumer />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId("set-ar").click();
    });

    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("翻译函数随语言变化返回正确的文本", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );

    // Default is zh
    expect(screen.getByTestId("translated").textContent).toBe("保存");

    act(() => {
      screen.getByTestId("set-en").click();
    });

    expect(screen.getByTestId("translated").textContent).toBe("Save");
  });

  it("多个消费者同时响应语言变化", () => {
    function SecondConsumer() {
      const { lang, t } = useLang();
      return (
        <div data-testid="second-consumer">
          <span data-testid="second-lang">{lang}</span>
          <span data-testid="second-text">{t("common.save")}</span>
        </div>
      );
    }

    render(
      <I18nProvider>
        <TestConsumer />
        <SecondConsumer />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId("set-en").click();
    });

    // Both consumers should update
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
    expect(screen.getByTestId("second-lang").textContent).toBe("en");
    expect(screen.getByTestId("second-text").textContent).toBe("Save");
  });

  it("忽略 localStorage 中的无效语言代码", () => {
    localStorage.setItem("gp.lang", "invalid_lang_code");
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    const currentLang = screen.getByTestId("current-lang").textContent;
    expect(currentLang).not.toBe("invalid_lang_code");
    expect(["zh", "en", "ja", "zh-TW", "es", "ar", "fr", "pt", "it", "ko", "th", "vi"]).toContain(currentLang);
  });

  it("无 initialLang 且无 localStorage 时默认使用 zh", () => {
    mockNavigatorLanguage("en-US");
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    // Provider no longer calls detectBrowserLang; default is "zh"
    expect(screen.getByTestId("current-lang").textContent).toBe("zh");
  });

  it("使用 initialLang prop 作为初始语言", () => {
    render(
      <I18nProvider initialLang="en">
        <TestConsumer />
      </I18nProvider>
    );
    expect(screen.getByTestId("current-lang").textContent).toBe("en");
    expect(document.documentElement.getAttribute("lang")).toBe("en");
  });

  it("当 localStorage 与 initialLang 相同时不触发额外状态更新", () => {
    localStorage.setItem("gp.lang", "en");
    const renderCount = { value: 0 };

    function CountRenders() {
      const { lang } = useLang();
      renderCount.value++;
      return <span data-testid="lang">{lang}</span>;
    }

    render(
      <I18nProvider initialLang="en">
        <CountRenders />
      </I18nProvider>
    );

    expect(renderCount.value).toBe(1);
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("setLang 同时写入 localStorage 和 cookie", () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );

    act(() => {
      screen.getByTestId("set-en").click();
    });

    expect(localStorage.getItem("gp.lang")).toBe("en");
    expect(document.cookie).toContain("gp.lang=en");
  });
});

describe("LanguageSync 反馈循环保护", () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigatorLanguage("zh-CN");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("BUG 复现：当 useEffect 依赖包含 lang 时，手动切换语言会被回退", async () => {
    // 这个测试复现了 bug 的根本原因：
    // LanguageSync 的 useEffect 依赖了 [authUser?.language, lang, setLang]，
    // 当用户手动切换语言时，lang 变化触发 effect，effect 发现 authUser.language
    // 仍然是旧值，于是调用 setLang(旧值)，将语言回退。

    const setLangCalls: string[] = [];

    // 模拟旧版有 bug 的 LanguageSync（依赖包含 lang）
    function BuggyLanguageSync({ authLanguage }: { authLanguage: Lang }) {
      const { lang, setLang } = useLang();

      React.useEffect(() => {
        if (authLanguage && authLanguage !== lang) {
          setLangCalls.push(`sync-to-${authLanguage}`);
          setLang(authLanguage);
        }
      }, [authLanguage, lang, setLang]);

      return null;
    }

    render(
      <I18nProvider>
        <BuggyLanguageSync authLanguage="zh" />
        <TestConsumer />
      </I18nProvider>
    );

    // 初始状态：authLanguage "zh" 会同步到 context
    await waitFor(() => {
      expect(screen.getByTestId("current-lang").textContent).toBe("zh");
    });

    // 用户手动切换到 Japanese
    act(() => {
      screen.getByTestId("set-ja").click();
    });

    // 由于 BuggyLanguageSync 的 useEffect 依赖了 lang，
    // setLang("ja") 改变 lang → effect 重新运行 → 发现 authLanguage "zh" !== lang "ja"
    // → 调用 setLang("zh") → 语言被回退
    await waitFor(() => {
      const finalLang = screen.getByTestId("current-lang").textContent;
      expect(finalLang).toBe("zh"); // BUG：被回退了
    });

    // 验证确实发生了多次 setLang 调用
    expect(setLangCalls).toContain("sync-to-zh");
  });

  it("FIX 验证：实际 LanguageSync 组件保持手动切换的语言", async () => {
    // 直接测试提取后的 LanguageSync 组件，避免测试漂移
    const setLangCalls: string[] = [];

    const { useAuth } = await import("@/lib/hooks/useAuth");

    // Start with no auth user (loading state)
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined });

    const { rerender } = render(
      <I18nProvider>
        <LanguageSync />
        <TestConsumer
          onLangChange={(l) => {
            setLangCalls.push(`manual-${l}`);
          }}
        />
      </I18nProvider>
    );

    // Wait for I18nProvider initialization (from localStorage or browser detection)
    await waitFor(() => {
      expect(screen.getByTestId("current-lang").textContent).toBeTruthy();
    });

    // Simulate authUser loading with language "zh"
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { id: "1", email: "test@example.com", language: "zh" },
    });

    // Re-render to trigger effect with new authUser
    rerender(
      <I18nProvider>
        <LanguageSync />
        <TestConsumer
          onLangChange={(l) => {
            setLangCalls.push(`manual-${l}`);
          }}
        />
      </I18nProvider>
    );

    // Wait for sync to "zh"
    await waitFor(() => {
      expect(screen.getByTestId("current-lang").textContent).toBe("zh");
    });

    // User manually switches to Japanese
    act(() => {
      screen.getByTestId("set-ja").click();
    });

    // Actual LanguageSync should NOT revert the change
    await waitFor(() => {
      const finalLang = screen.getByTestId("current-lang").textContent;
      expect(finalLang).toBe("ja"); // FIX：保持用户选择
    });

    // Verify manual change was recorded
    expect(setLangCalls).toContain("manual-ja");
  });
});

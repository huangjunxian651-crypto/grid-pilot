import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore, readInitialTheme } from "@/lib/store";

describe("useThemeStore 持久化", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggleTheme 切换并写 localStorage + documentElement", () => {
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("gp-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("再次切回 dark 并持久化", () => {
    useThemeStore.getState().toggleTheme();
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(localStorage.getItem("gp-theme")).toBe("dark");
  });

  it("readInitialTheme 读取已存 light 偏好", () => {
    localStorage.setItem("gp-theme", "light");
    expect(readInitialTheme()).toBe("light");
  });

  it("readInitialTheme 无偏好时默认 dark", () => {
    expect(readInitialTheme()).toBe("dark");
  });
});

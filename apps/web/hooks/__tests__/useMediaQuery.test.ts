import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery, useIsMobile, useIsDesktop } from "../useMediaQuery";

describe("useMediaQuery", () => {
  let listeners: Array<(e: MediaQueryListEvent) => void> = [];
  let currentMatches = false;

  beforeEach(() => {
    listeners = [];
    currentMatches = false;

    const mockMatchMedia = vi.fn((query: string) => ({
      matches: currentMatches,
      media: query,
      addEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn((event: string, handler: (e: MediaQueryListEvent) => void) => {
        listeners = listeners.filter((l) => l !== handler);
      }),
      dispatchEvent: vi.fn(),
    }));

    vi.stubGlobal("matchMedia", mockMatchMedia);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false for non-matching query", () => {
    currentMatches = false;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);
  });

  it("returns true for matching query", () => {
    currentMatches = true;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(true);
  });

  it("updates when media query changes (simulate change event)", () => {
    currentMatches = false;
    const { result } = renderHook(() => useMediaQuery("(min-width: 1024px)"));
    expect(result.current).toBe(false);

    act(() => {
      currentMatches = true;
      listeners.forEach((handler) =>
        handler({ matches: true } as MediaQueryListEvent)
      );
    });

    expect(result.current).toBe(true);

    act(() => {
      currentMatches = false;
      listeners.forEach((handler) =>
        handler({ matches: false } as MediaQueryListEvent)
      );
    });

    expect(result.current).toBe(false);
  });

  it("useIsMobile returns correct value", () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("useIsDesktop returns correct value", () => {
    currentMatches = true;
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });
});

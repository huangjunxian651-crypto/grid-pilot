"use client";

import { useSyncExternalStore, useCallback } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    useCallback(
      (callback: () => void) => {
        const mql = window.matchMedia(query);
        mql.addEventListener("change", callback);
        return () => mql.removeEventListener("change", callback);
      },
      [query]
    ),
    useCallback(() => window.matchMedia(query).matches, [query]),
    useCallback(() => false, [])
  );
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

export function useIsTablet(): boolean {
  return useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
}

export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}

"use client";

import { useState, useEffect } from "react";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n-context";
import { LanguageSync } from "./language-sync";
import { TickerProvider } from "./shell";
import { useThemeStore, readInitialTheme } from "@/lib/store";
import { Toaster } from "sonner";
import type { Lang } from "@/lib/i18n-shared";
import {
  handleQueryError,
  handleMutationError,
} from "@/lib/query-error-handler";

export function Providers({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => handleQueryError(error, query),
        }),
        mutationCache: new MutationCache({
          onError: (error, mutation) => handleMutationError(error, mutation, undefined),
        }),
        defaultOptions: {
          mutations: { retry: false },
        },
      }),
  );

  // 挂载后同步持久化的主题偏好到 store（SSR 初值固定 dark 以避免 hydration mismatch）；
  // CSS 已由 layout 内联 script 预置 data-theme，此处仅同步 React 状态（如切换图标）。
  useEffect(() => {
    const persisted = readInitialTheme();
    if (persisted !== useThemeStore.getState().theme) {
      useThemeStore.setState({ theme: persisted });
    }
    document.documentElement.setAttribute("data-theme", persisted);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLang={initialLang}>
        <LanguageSync />
        <TickerProvider>
          {children}
          <Toaster position="top-right" richColors />
        </TickerProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

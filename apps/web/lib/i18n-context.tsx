"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { translate, detectBrowserLang } from "./i18n";
import { type Lang, HTML_LANG, getTextDir, isValidLang } from "./i18n-shared";

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  lang: "zh",
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({
  children,
  initialLang,
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang ?? "zh");

  // Client-side initialization: read localStorage if it differs from server-provided value
  useEffect(() => {
    const stored = localStorage.getItem("gp.lang");
    if (stored && isValidLang(stored) && stored !== (initialLang ?? "zh")) {
      setLangState(stored);
    }
  }, []);

  // Sync document attributes when lang changes
  useEffect(() => {
    document.documentElement.setAttribute("lang", HTML_LANG[lang]);
    document.documentElement.setAttribute("dir", getTextDir(lang));
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("gp.lang", l);
    // Also set cookie so server can read it on next request
    document.cookie = `gp.lang=${l};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
    document.documentElement.setAttribute("lang", HTML_LANG[l]);
    document.documentElement.setAttribute("dir", getTextDir(l));
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(key, lang, params),
    [lang]
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useLang() {
  return useContext(I18nContext);
}

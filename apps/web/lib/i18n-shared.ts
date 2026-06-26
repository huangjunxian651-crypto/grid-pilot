// apps/web/lib/i18n-shared.ts
// Shared i18n utilities usable by both server and client code.
// NO "use client" — safe to import in layout.tsx (server component).

export type Lang =
  | "zh"
  | "zh-TW"
  | "en"
  | "ja"
  | "es"
  | "ar"
  | "fr"
  | "pt"
  | "it"
  | "ko"
  | "th"
  | "vi";

export const SUPPORTED_LANGS: { code: Lang; label: string }[] = [
  { code: "zh", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "ar", label: "العربية" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ko", label: "한국어" },
  { code: "th", label: "ภาษาไทย" },
  { code: "vi", label: "Tiếng Việt" },
];

export const HTML_LANG: Record<Lang, string> = {
  zh: "zh-CN",
  "zh-TW": "zh-TW",
  en: "en",
  ja: "ja",
  es: "es",
  ar: "ar",
  fr: "fr",
  pt: "pt",
  it: "it",
  ko: "ko",
  th: "th",
  vi: "vi",
};

export const VALID_LANG_CODES = new Set<string>(
  SUPPORTED_LANGS.map((l) => l.code)
);

export function isValidLang(code: string): code is Lang {
  return VALID_LANG_CODES.has(code);
}

export function getTextDir(lang: Lang): "ltr" | "rtl" {
  return lang === "ar" ? "rtl" : "ltr";
}

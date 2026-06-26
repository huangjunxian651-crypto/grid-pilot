"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/hooks/useAuth";
import { useLang } from "@/lib/i18n-context";
import type { Lang } from "@/lib/i18n";

/**
 * Syncs the UI language with the user's backend language preference.
 *
 * Only runs when authUser.language changes (e.g. on initial load or after
 * profile update). Intentionally does NOT react to local lang changes to
 * avoid a feedback loop where user-initiated language switches get reverted.
 *
 * Uses a ref to read the latest lang value without adding lang to the
 * effect dependencies (which would recreate the feedback loop).
 */
export function LanguageSync() {
  const { data: authUser } = useAuth();
  const { lang, setLang } = useLang();
  const langRef = useRef(lang);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    if (authUser?.language && authUser.language !== langRef.current) {
      setLang(authUser.language as Lang);
    }
  }, [authUser?.language, setLang]);

  return null;
}

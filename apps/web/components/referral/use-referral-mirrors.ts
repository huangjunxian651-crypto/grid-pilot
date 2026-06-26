"use client";
import { useEffect, useState } from "react";
import {
  FANGEIWO_MIRROR_URL,
  OFFICIAL_REGISTER_URL,
  normalizeReferralPlatform,
  type ReferralExchange,
} from "@/lib/referral";

interface RemoteEntry {
  platform: string;
  invite_code?: string;
  invite_link?: string;
  inner_invite_link?: string;
  international_invite_link?: string;
}

/**
 * 拉取大陆备用镜像注册链接（远端 JSON）。失败/超时静默兜底为空——
 * 调用方仍可用 OFFICIAL_REGISTER_URL 注册。全站返佣注册位共享此逻辑（DRY）。
 */
export function useReferralMirrors(): Partial<Record<ReferralExchange, string>> {
  const [mirrors, setMirrors] = useState<Partial<Record<ReferralExchange, string>>>({});

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 6000);
    (async () => {
      try {
        const res = await fetch(FANGEIWO_MIRROR_URL, { signal: abortController.signal });
        if (!res.ok) return;
        const data = (await res.json()) as RemoteEntry[];
        if (cancelled || !Array.isArray(data)) return;
        const next: Partial<Record<ReferralExchange, string>> = {};
        for (const e of data) {
          const exchange = normalizeReferralPlatform(e.platform);
          const mirror = e.invite_link || e.inner_invite_link;
          if (exchange && mirror && mirror !== OFFICIAL_REGISTER_URL[exchange]) next[exchange] = mirror;
        }
        if (!cancelled) setMirrors(next);
      } catch {
        /* 静默兜底：仅官网链接 */
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      abortController.abort();
      clearTimeout(timer);
    };
  }, []);

  return mirrors;
}

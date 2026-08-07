"use client";

import type { ReactNode } from "react";
import { create } from "zustand";

export type ConfirmOptions = {
  tier: "simple" | "destructive";
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  /** tier === "destructive" 时必填：用户需输入与此完全一致（trim 后、大小写敏感）才能确认 */
  confirmWord?: string;
  /** tier === "destructive" 时展示在输入框上方的操作说明，例如「请输入 "CLEAR" 以确认」 */
  confirmHint?: string;
};

/**
 * requestId：每次 request() 调用递增的唯一标识。
 * 用途：UI 层（confirm-dialog.tsx）以此作为 React key 强制内容重新挂载，
 * 从而在新请求覆盖旧请求（包括未经过 null 的“无缝覆盖”场景）时重置本地输入状态，
 * 避免用 useEffect + setState 做派生状态重置（该模式会触发级联渲染，见
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes）。
 */
export type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void; requestId: number };

interface ConfirmState {
  pending: PendingConfirm | null;
  request: (options: ConfirmOptions) => Promise<boolean>;
  resolvePending: (ok: boolean) => void;
}

let nextRequestId = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request: (options) => {
    return new Promise<boolean>((resolve) => {
      const current = get().pending;
      if (current) current.resolve(false);
      nextRequestId += 1;
      set({ pending: { ...options, resolve, requestId: nextRequestId } });
    });
  },
  resolvePending: (ok) => {
    const current = get().pending;
    if (!current) return;
    current.resolve(ok);
    set({ pending: null });
  },
}));

/** 组件里用这个：`const confirm = useConfirm(); const ok = await confirm({ ... });` */
export function useConfirm() {
  return useConfirmStore((s) => s.request);
}

"use client";

import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/primitives";
import { useConfirmStore, type PendingConfirm } from "@/lib/hooks/useConfirm";
import { useLang } from "@/lib/i18n-context";

export function ConfirmDialogHost() {
  const pending = useConfirmStore((s) => s.pending);
  const resolvePending = useConfirmStore((s) => s.resolvePending);
  const { t } = useLang();

  if (!pending) return null;

  return (
    <Modal open title={pending.title} onClose={() => resolvePending(false)}>
      {/*
        key={pending.requestId}：新请求（哪怕是在旧请求未 resolve 时直接覆盖，
        即 pending 引用变化但从未经过 null）也会强制 ConfirmDialogBody 重新挂载，
        从而让 inputValue 自然重置为初始值，而不是用 useEffect + setState 手动重置。
      */}
      <ConfirmDialogBody key={pending.requestId} pending={pending} resolvePending={resolvePending} t={t} />
    </Modal>
  );
}

function ConfirmDialogBody({
  pending,
  resolvePending,
  t,
}: {
  pending: PendingConfirm;
  resolvePending: (ok: boolean) => void;
  t: (key: string) => string;
}) {
  const [inputValue, setInputValue] = useState("");
  const isDestructive = pending.tier === "destructive";
  const canConfirm = !isDestructive || inputValue.trim() === pending.confirmWord;

  return (
    <div data-testid="confirm-dialog">
      <div data-testid="confirm-dialog-body" style={{ fontSize: 13, color: "var(--fg-1)", marginBottom: 16, lineHeight: 1.6 }}>
        {pending.body}
      </div>
      {isDestructive && (
        <>
          {pending.confirmHint && (
            <label
              htmlFor="confirm-dialog-input"
              data-testid="confirm-dialog-hint"
              style={{ display: "block", fontSize: 12, color: "var(--fg-1)", marginBottom: 8 }}
            >
              {pending.confirmHint}
            </label>
          )}
          <input
            id="confirm-dialog-input"
            data-testid="confirm-dialog-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={pending.confirmWord}
            style={{
              width: "100%", height: 36, background: "var(--bg-2)",
              border: "1px solid var(--border-default)", borderRadius: 8,
              padding: "0 11px", fontSize: 13, color: "var(--fg-0)",
              marginBottom: 16, boxSizing: "border-box",
            }}
          />
        </>
      )}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Button variant="ghost" data-testid="confirm-dialog-cancel" onClick={() => resolvePending(false)}>
          {t("common.cancel")}
        </Button>
        <Button
          danger
          data-testid="confirm-dialog-confirm"
          disabled={!canConfirm}
          onClick={() => resolvePending(true)}
        >
          {pending.confirmLabel ?? t("common.confirm")}
        </Button>
      </div>
    </div>
  );
}

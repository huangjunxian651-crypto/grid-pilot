"use client";
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Icons } from "@/components/ui/icons";

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      data-testid="modal-overlay"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 100%)", maxHeight: "85vh", overflowY: "auto",
          background: "var(--bg-2)", border: "1px solid var(--border-subtle)",
          borderRadius: 10, boxShadow: "var(--shadow-md)", color: "var(--fg-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <button type="button" aria-label="关闭" onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-3)", display: "inline-flex", alignItems: "center", padding: 2 }}>
            <Icons.X size={16} />
          </button>
        </div>
        <div style={{ padding: 14 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

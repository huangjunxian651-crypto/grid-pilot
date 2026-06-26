"use client";
import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n-context";
import { Icons } from "@/components/ui/icons";
import { TERM_GLOSSARY } from "@/lib/term-glossary";

const TOOLTIP_WIDTH = 260;
const EDGE_MARGIN = 8;
const GAP = 6;

/**
 * 术语帮助。提示气泡经 React Portal 渲染到 document.body 并用 fixed 定位，
 * 彻底脱离父级 overflow:hidden / 圆角 / 层叠上下文的裁切（之前会被卡片边框框住）。
 * 默认向下展开；贴近视口右缘改右对齐、贴近下缘翻到上方，始终完整可见。
 */
export function TermHelp({ term, title }: { term: string; title?: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"right" | "left">("right");
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entry = TERM_GLOSSARY[term];

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // 水平：左缘对齐图标；右侧放不下整张提示时改为右对齐（与旧 data-placement 语义一致）。
    const pl: "right" | "left" = r.left + TOOLTIP_WIDTH + EDGE_MARGIN > window.innerWidth ? "left" : "right";
    const left = pl === "right" ? r.left : Math.max(EDGE_MARGIN, r.right - TOOLTIP_WIDTH);
    // 垂直：默认在下方；下方放不下且上方放得下时翻到上方（用气泡真实高度，渲染后校正）。
    let top = r.bottom + GAP;
    const popH = popRef.current?.offsetHeight ?? 0;
    if (popH > 0 && top + popH + EDGE_MARGIN > window.innerHeight && r.top - GAP - popH >= EDGE_MARGIN) {
      top = r.top - GAP - popH;
    }
    setPlacement(pl);
    setPos({ top, left });
  };

  // open 时定位一次（渲染后 useLayoutEffect 用真实高度校正），并跟随滚动/缩放重定位。
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onMove = () => reposition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); };
  useLayoutEffect(() => () => cancelClose(), []);

  if (!entry) return null;

  return (
    <span
      style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={btnRef}
        type="button"
        data-testid={`term-help-${term}`}
        aria-label={title ?? term}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ background: "none", border: "none", padding: 0, marginLeft: 3, cursor: "help", color: "var(--fg-3)", display: "inline-flex", alignItems: "center" }}
      >
        <Icons.Info size={12} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          role="tooltip"
          data-placement={placement}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, width: TOOLTIP_WIDTH, maxWidth: "80vw", padding: "10px 12px", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 8, boxShadow: "var(--shadow-md)", fontSize: 12, lineHeight: 1.5, color: "var(--fg-1)", whiteSpace: "normal", textAlign: "left", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}
        >
          {title && <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>}
          <div style={{ color: "var(--fg-2)" }}>{t(entry.conceptKey)}</div>
          {entry.noteKey && <div style={{ marginTop: 6, color: "var(--alpha)" }}>💡 {t(entry.noteKey)}</div>}
          {entry.ctaKey && entry.ctaHref && (
            <a
              href={entry.ctaHref}
              data-testid={`term-help-cta-${term}`}
              onClick={(e) => e.stopPropagation()}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 12, fontWeight: 500, color: "var(--accent)", textDecoration: "none" }}
            >
              {t(entry.ctaKey)}
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 3l5 5-5 5" /></svg>
            </a>
          )}
        </div>,
        document.body,
      )}
    </span>
  );
}

"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang } from "@/lib/i18n-context";
import { fmt } from "@/lib/store";
import type { Robot } from "@/lib/api";

const PANEL_WIDTH = 280;
const EDGE_MARGIN = 8;
const GAP = 6;

function runningDays(createdAt: string, endedAt: string | null): number {
  const start = new Date(createdAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, Math.ceil((end - start) / 86400000));
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function RobotSelect({
  robots,
  value,
  onChange,
  testId = "robot-select",
}: {
  robots: Robot[];
  value: string;
  onChange: (robotId: string) => void;
  testId?: string;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - PANEL_WIDTH - EDGE_MARGIN);
    setPos({ top: r.bottom + GAP, left: Math.max(EDGE_MARGIN, left) });
  };

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

  const selected = robots.find((r) => r.id === value);
  const label = selected ? `${selected.symbol} · ${selected.accountLabel}` : t("hist.all_bots");

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid={`${testId}-trigger`}
        onClick={() => setOpen((o) => !o)}
        className="gp-hide-mobile"
        style={{
          height: 36, padding: "0 13px", background: "var(--bg-1)", border: "1px solid var(--border-default)",
          borderRadius: 9, fontSize: 12, color: "var(--fg-0)", whiteSpace: "nowrap", cursor: "pointer", maxWidth: 220,
          overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {label}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div data-testid={`${testId}-backdrop`} onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 999 }} />
          <div
            style={{
              position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, width: PANEL_WIDTH, maxHeight: 320,
              overflowY: "auto", background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10,
              boxShadow: "var(--shadow-md)", padding: 4,
            }}
          >
            <div
              data-testid={`${testId}-option-all`}
              onClick={() => select("")}
              style={{ padding: "8px 10px", borderRadius: 7, cursor: "pointer", fontSize: 12.5 }}
            >
              {t("hist.all_bots")}
            </div>
            {robots.map((r) => (
              <div
                key={r.id}
                data-testid={`${testId}-option-${r.id}`}
                onClick={() => select(r.id)}
                style={{ padding: "8px 10px", borderRadius: 7, cursor: "pointer" }}
              >
                <div style={{ fontSize: 12.5, color: "var(--fg-0)" }}>
                  {r.symbol} · {r.accountLabel} · {fmt.exchangeName(r.exchangeId)}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>
                  {r.createdAt ? dateOnly(r.createdAt) : "—"} ~ {r.endedAt ? dateOnly(r.endedAt) : t("hist.robot_running_now")}
                  {r.createdAt ? ` · ${t("hist.robot_running_days", { n: runningDays(r.createdAt, r.endedAt) })}` : ""}
                </div>
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

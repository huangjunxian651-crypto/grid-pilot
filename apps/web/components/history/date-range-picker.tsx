"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker, type DateRange } from "react-day-picker";
import { useLang } from "@/lib/i18n-context";
import "react-day-picker/dist/style.css";
import "./date-range-picker.css";

export type DateRangeValue = { from: Date | null; to: Date | null };

const PANEL_WIDTH = 320;
const EDGE_MARGIN = 8;
const GAP = 6;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function endOfDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

// 导出供页面复用：按本地时区拼 YYYY-MM-DD，避免用 toISOString()(UTC)在大偏移
// 时区(UTC+12/+13)下把日期label错读成前一天/后一天。
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker({
  value,
  onChange,
  testId = "date-range",
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  testId?: string;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const applyPreset = (days: number | null) => {
    if (days == null) {
      onChange({ from: null, to: null });
    } else {
      onChange({ from: daysAgo(days), to: new Date() });
    }
    setOpen(false);
  };

  const handleRangeSelect = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      // react-day-picker 的日期落在本地午夜(00:00:00.000)，作为"选到哪天"的终点
      // 语义应是"含当天全天"，故补到日终 23:59:59.999，否则该天发生的成交会被
      // 下游 filledAt<=until 的比较静默漏掉。
      onChange({ from: range.from, to: endOfDay(range.to) });
      setOpen(false);
    } else if (range?.from) {
      // 只选了起点，先不关闭，等用户点第二个日期
      onChange({ from: range.from, to: null });
    }
  };

  const label =
    value.from && value.to
      ? `${formatLocalDate(value.from)} ~ ${formatLocalDate(value.to)}`
      : t("hist.range_all");

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid={`${testId}-trigger`}
        onClick={() => setOpen((o) => !o)}
        style={{
          height: 36, padding: "0 13px", background: "var(--bg-1)", border: "1px solid var(--border-default)",
          borderRadius: 9, fontSize: 12, color: "var(--fg-0)", whiteSpace: "nowrap", cursor: "pointer",
        }}
      >
        {label}
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <>
          <div
            data-testid={`${testId}-backdrop`}
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 999 }}
          />
          <div
            ref={panelRef}
            style={{
              position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, width: PANEL_WIDTH,
              background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10,
              boxShadow: "var(--shadow-md)", padding: 12,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <button data-testid={`${testId}-preset-7d`} onClick={() => applyPreset(7)} style={presetBtnStyle}>{t("hist.range_preset_7d")}</button>
              <button data-testid={`${testId}-preset-30d`} onClick={() => applyPreset(30)} style={presetBtnStyle}>{t("hist.range_preset_30d")}</button>
              <button data-testid={`${testId}-preset-90d`} onClick={() => applyPreset(90)} style={presetBtnStyle}>{t("hist.range_preset_90d")}</button>
              <button data-testid={`${testId}-preset-all`} onClick={() => applyPreset(null)} style={presetBtnStyle}>{t("hist.range_all")}</button>
            </div>
            <DayPicker
              mode="range"
              selected={value.from ? { from: value.from, to: value.to ?? undefined } : undefined}
              onSelect={handleRangeSelect}
              defaultMonth={value.from ?? undefined}
            />
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const presetBtnStyle: React.CSSProperties = {
  padding: "5px 10px", fontSize: 11.5, borderRadius: 7, border: "1px solid var(--border-default)",
  background: "transparent", color: "var(--fg-1)", cursor: "pointer",
};

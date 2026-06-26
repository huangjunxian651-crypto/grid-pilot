"use client";

import React, { CSSProperties } from "react";
import { Icons } from "./icons";
import { useLang } from "@/lib/i18n-context";
import { TermHelp } from "./term-help";

// ── Badge ─────────────────────────────────────────────────────
type BadgeTone = "neutral" | "accent" | "alpha" | "up" | "down" | "maker" | "taker" | "warn";

const BADGE_STYLES: Record<BadgeTone, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "var(--bg-3)", fg: "var(--fg-1)", bd: "var(--border-default)" },
  accent: { bg: "var(--accent-tint)", fg: "var(--accent)", bd: "transparent" },
  alpha: { bg: "var(--alpha-tint)", fg: "var(--alpha)", bd: "transparent" },
  up: { bg: "var(--up-tint)", fg: "var(--up)", bd: "transparent" },
  down: { bg: "var(--down-tint)", fg: "var(--down)", bd: "transparent" },
  maker: { bg: "var(--maker-tint)", fg: "var(--maker)", bd: "transparent" },
  taker: { bg: "var(--taker-tint)", fg: "var(--taker)", bd: "transparent" },
  warn: { bg: "var(--alpha-tint)", fg: "var(--warn)", bd: "transparent" },
};

export function Badge({
  tone = "neutral",
  children,
  dot,
  glow,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  dot?: boolean;
  glow?: boolean;
}) {
  const s = BADGE_STYLES[tone];
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 7px", fontSize: 11, fontWeight: 500,
        borderRadius: 4, background: s.bg, color: s.fg,
        border: `1px solid ${s.bd}`, lineHeight: 1.4, letterSpacing: 0.2,
        boxShadow: glow ? "var(--alpha-glow)" : "none",
      }}
    >
      {dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.fg }} />}
      {children}
    </span>
  );
}

// ── Button ────────────────────────────────────────────────────
type BtnVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type BtnSize = "sm" | "md" | "lg";

const BTN_SIZE: Record<BtnSize, { p: string; fs: number; h: number }> = {
  sm: { p: "4px 10px", fs: 12, h: 26 },
  md: { p: "7px 14px", fs: 13, h: 32 },
  lg: { p: "9px 18px", fs: 14, h: 38 },
};

const BTN_VARIANT: Record<BtnVariant, { bg: string; fg: string; bd: string; hover: string }> = {
  primary: { bg: "var(--accent)", fg: "var(--btn-fg)", bd: "transparent", hover: "var(--accent-hi)" },
  secondary: { bg: "var(--bg-3)", fg: "var(--fg-0)", bd: "var(--border-default)", hover: "var(--bg-4)" },
  ghost: { bg: "transparent", fg: "var(--fg-1)", bd: "transparent", hover: "var(--bg-3)" },
  outline: { bg: "transparent", fg: "var(--fg-0)", bd: "var(--border-strong)", hover: "var(--bg-3)" },
  danger: { bg: "var(--down-tint)", fg: "var(--down)", bd: "transparent", hover: "var(--down)" },
};

export function Button({
  variant = "secondary",
  size = "md",
  children,
  icon,
  onClick,
  disabled,
  full,
  danger,
  style,
  "data-testid": testId,
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  full?: boolean;
  danger?: boolean;
  style?: CSSProperties;
  "data-testid"?: string;
}) {
  const sz = BTN_SIZE[size];
  const v = danger ? BTN_VARIANT.danger : BTN_VARIANT[variant];
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: sz.p, fontSize: sz.fs, height: sz.h,
        background: hovered ? v.hover : v.bg,
        color: hovered && danger ? "#fff" : v.fg,
        border: `1px solid ${v.bd}`,
        borderRadius: 8, fontWeight: 500, transition: "all .12s",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        width: full ? "100%" : "auto",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon}{children}
    </button>
  );
}

// ── Card ──────────────────────────────────────────────────────
export function Card({
  children,
  style,
  pad = 16,
  title,
  action,
  glow,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
  pad?: number;
  title?: string;
  action?: React.ReactNode;
  glow?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--bg-1)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 12,
        padding: pad,
        boxShadow: glow ? "var(--alpha-glow)" : "var(--shadow-sm)",
        ...style,
      }}
    >
      {title && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── KPI Tile ──────────────────────────────────────────────────
type Tone = "up" | "down" | "alpha" | "default";

export function KPI({
  label,
  value,
  sub,
  tone = "default",
  icon,
  big,
  alphaGlow,
  help,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  icon?: React.ReactNode;
  big?: boolean;
  alphaGlow?: boolean;
  help?: string;
}) {
  const fg = tone === "up" ? "var(--up)" : tone === "down" ? "var(--down)" : tone === "alpha" ? "var(--alpha)" : "var(--fg-0)";
  return (
    <div
      style={{
        background: alphaGlow ? "var(--alpha-tint)" : "var(--bg-1)",
        border: `1px solid ${alphaGlow ? "var(--alpha-tint-strong)" : "var(--border-subtle)"}`,
        borderRadius: 12, padding: "14px 16px",
        display: "flex", flexDirection: "column", gap: 6,
        position: "relative", overflow: "hidden",
      }}
    >
      {alphaGlow && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.08, pointerEvents: "none" }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-2)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 500 }}>
        {icon} {label}{help ? <TermHelp term={help} title={label} /> : null}
      </div>
      <div className="num" style={{ fontSize: big ? 28 : 22, fontWeight: 500, color: fg, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--fg-2)" }}>{sub}</div>}
    </div>
  );
}

// ── Pulse dot ─────────────────────────────────────────────────
export function Pulse({ color = "var(--up)", size = 8 }: { color?: string; size?: number }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.4, animation: "gp-ping 1.8s cubic-bezier(0,0,.2,1) infinite" }} />
      <span style={{ position: "relative", borderRadius: "50%", background: color, width: "100%", height: "100%" }} />
    </span>
  );
}

// ── FSM State Pill ────────────────────────────────────────────
const FSM_CONFIG: Record<string, { color: string; bg: string; dot: boolean }> = {
  TRAILING_ENTRY: { color: "var(--alpha)", bg: "var(--alpha-tint)", dot: true },
  RUNNING: { color: "var(--up)", bg: "var(--up-tint)", dot: true },
  LIQUIDATING: { color: "var(--down)", bg: "var(--down-tint)", dot: true },
  LIQUIDATED: { color: "var(--down)", bg: "var(--down-tint)", dot: false },
  TAKE_PROFIT: { color: "var(--up)", bg: "var(--up-tint)", dot: false },
  PAUSED: { color: "var(--warn)", bg: "var(--alpha-tint)", dot: false },
  CANCELLED: { color: "var(--fg-2)", bg: "var(--bg-3)", dot: false },
  HOLD: { color: "var(--fg-2)", bg: "var(--bg-3)", dot: false },
};

export function FsmPill({ state, size = "md", t }: { state: string; size?: "sm" | "md"; t: (k: string) => string }) {
  const config = FSM_CONFIG[state] ?? { color: "var(--fg-2)", bg: "var(--bg-3)", dot: false };
  const dim = size === "sm" ? { p: "2px 8px", fs: 11 } : { p: "4px 10px", fs: 12 };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: dim.p, fontSize: dim.fs, fontWeight: 500, color: config.color, background: config.bg, borderRadius: 999 }}>
      {config.dot && <Pulse color={config.color} size={6} />}
      {t(`fsm.${state}`)}
    </span>
  );
}

// ── PriceTicker ───────────────────────────────────────────────
export function PriceTicker({ price, prev, decimals = 2, size = 22, weight = 500 }: { price: number; prev?: number; decimals?: number; size?: number; weight?: number }) {
  const trend = prev != null ? (price > prev ? 1 : price < prev ? -1 : 0) : 0;
  const color = trend > 0 ? "var(--up)" : trend < 0 ? "var(--down)" : "var(--fg-0)";
  return (
    <span className="num" style={{ fontSize: size, fontWeight: weight, color, transition: "color .3s", letterSpacing: -0.5 }}>
      {price.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}

// ── AlphaBadge ────────────────────────────────────────────────
export function AlphaBadge({ alpha, big }: { alpha: number; big?: boolean }) {
  if (alpha < 0.001) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: big ? "3px 8px" : "1px 6px", fontSize: big ? 12 : 10.5, fontWeight: 600, color: "var(--alpha)", background: "var(--alpha-tint)", border: "1px solid var(--alpha-tint-strong)", borderRadius: 4, fontFamily: "var(--font-mono)" }}>
      <Icons.Sparkles size={big ? 11 : 9} />
      +${alpha.toFixed(3)}
    </span>
  );
}

// ── AlphaMeter ────────────────────────────────────────────────
export function AlphaMeter({ baseProfit, makerSavings, gtcExcess }: { baseProfit: number; makerSavings: number; gtcExcess: number }) {
  const { t } = useLang();
  return (
    <div style={{ background: "linear-gradient(135deg, var(--alpha-tint) 0%, transparent 70%)", border: "1px solid var(--alpha-tint-strong)", borderRadius: 12, padding: 18, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -20, right: -20, width: 140, height: 140, background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.13, pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "var(--alpha)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 500 }}>
        <Icons.Sparkles size={12} /> {t("alpha_meter.title")}
      </div>
      <div className="num" style={{ fontSize: 36, fontWeight: 500, color: "var(--alpha)", letterSpacing: -1, marginBottom: 4 }}>
        +${(makerSavings + gtcExcess).toFixed(2)}
      </div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", marginBottom: 14 }}>
        {t("alpha_meter.desc")}
      </div>
      <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8, background: "var(--bg-3)" }}>
        <div style={{ flex: baseProfit, background: "var(--fg-3)" }} />
        <div style={{ flex: makerSavings, background: "var(--maker)" }} />
        <div style={{ flex: gtcExcess, background: "var(--alpha)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--fg-2)" }}>
        <span>{t("alpha_meter.base_pnl")} <span className="num">${baseProfit.toFixed(2)}</span></span>
        <span>{t("alpha_meter.maker_label")} <span className="num" style={{ color: "var(--maker)" }}>${makerSavings.toFixed(2)}</span></span>
        <span>{t("alpha_meter.gtc_label")} <span className="num" style={{ color: "var(--alpha)" }}>${gtcExcess.toFixed(2)}</span></span>
      </div>
    </div>
  );
}

// ── Exchange Mark ─────────────────────────────────────────────
const EXCHANGE_COLORS: Record<string, { bg: string; letter: string }> = {
  binance: { bg: "#F0B90B", letter: "B" },
  gateio: { bg: "#2354e6", letter: "G" },
  okx: { bg: "#000", letter: "O" },
};

export function ExchangeMark({ exchange, size = 28 }: { exchange: string; size?: number }) {
  const r = size * 0.22;
  const darkBg = "var(--bg-2)";

  if (exchange === "binance") {
    return (
      <div style={{ width: size, height: size, borderRadius: r, background: darkBg, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 2500 2500" width={size * 0.72} height={size * 0.72}>
          <path fill="#F0B90B" d="M563.4 1250l-280.4 280.7L0 1250l283-283.2L563.4 1250zM1248.8 564l482.9 483.3 283.1-283.1L1248.8 0 482.9 766.7l283.1 283.1L1248.8 564zM2214.6 966.8L1934.2 1250l282.9 283.2L2500 1250zM1248.8 1936l-482.9-485.8-283.1 283.2 765.9 766.6 765.9-766.7-283.1-283.1zM1248.8 1530.8l283-283.3-283-280.6-283 283.1z" />
        </svg>
      </div>
    );
  }

  if (exchange === "okx") {
    return (
      <div className="exmark-okx" style={{ width: size, height: size, borderRadius: r, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 2500 2500" width={size * 0.88} height={size * 0.88}>
          <path d="M1464.3 1015.3h-405.2c-17.2 0-31.3 14.1-31.3 31.3v405.2c0 17.2 14.1 31.3 31.3 31.3h405.2c17.2 0 31.3-14.1 31.3-31.3v-405.2c0-17.2-14.1-31.3-31.3-31.3z" />
          <path d="M996.6 549.1H591.4c-17.2 0-31.3 14.1-31.3 31.3v405.2c0 17.2 14.1 31.3 31.3 31.3h405.2c17.2 0 31.3-14.1 31.3-31.3V580.4c0-17.2-14.1-31.3-31.3-31.3z" />
          <path d="M1930.5 549.1h-405.2c-17.2 0-31.3 14.1-31.3 31.3v405.2c0 17.2 14.1 31.3 31.3 31.3h405.2c17.2 0 31.3-14.1 31.3-31.3V580.4c0-17.2-14.1-31.3-31.3-31.3z" />
          <path d="M996.6 1481.5H591.4c-17.2 0-31.3 14.1-31.3 31.3V1918c0 17.2 14.1 31.3 31.3 31.3h405.2c17.2 0 31.3-14.1 31.3-31.3v-405.2c0-17.2-14.1-31.3-31.3-31.3z" />
          <path d="M1930.5 1481.5h-405.2c-17.2 0-31.3 14.1-31.3 31.3V1918c0 17.2 14.1 31.3 31.3 31.3h405.2c17.2 0 31.3-14.1 31.3-31.3v-405.2c0-17.2-14.1-31.3-31.3-31.3z" />
        </svg>
      </div>
    );
  }

  if (exchange === "gateio") {
    return (
      <div style={{ width: size, height: size, borderRadius: r, background: darkBg, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 2500 2500" width={size * 0.72} height={size * 0.72}>
          <path d="M1250 1937.5c-379.7 0-687.5-307.8-687.5-687.5 0-379.7 307.8-687.5 687.5-687.5V0C559.6 0 0 559.6 0 1250c0 690.3 559.6 1250 1250 1250 690.3 0 1250-559.6 1250-1250h-562.5c0 379.7-307.8 687.5-687.5 687.5z" fill="#2354E6" />
          <polygon points="1250 1250 1937.5 1250 1937.5 562.5 1250 562.5" fill="#17E6A1" />
        </svg>
      </div>
    );
  }

  const cfg = EXCHANGE_COLORS[exchange] ?? { bg: "var(--bg-3)", letter: "?" };
  return (
    <div style={{ width: size, height: size, borderRadius: r, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.44, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
      {cfg.letter}
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.5, fontFamily: "var(--font-display)" }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

// ── Field (form input) ────────────────────────────────────────
export function Field({
  label,
  value,
  placeholder,
  type = "text",
  suffix,
  hint,
  prefix,
  w,
  onChange,
}: {
  label?: string;
  value?: string;
  placeholder?: string;
  type?: string;
  suffix?: string;
  hint?: string;
  prefix?: React.ReactNode;
  w?: number;
  onChange?: (v: string) => void;
}) {
  return (
    <div style={{ width: w }}>
      {label && <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 5, fontWeight: 500 }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", height: 34, background: "var(--bg-2)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "0 10px", gap: 6 }}>
        {prefix && <span style={{ color: "var(--fg-3)" }}>{prefix}</span>}
        <input
          type={type}
          value={value ?? ""}
          placeholder={placeholder}
          onChange={e => onChange?.(e.target.value)}
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--fg-0)", fontFamily: "var(--font-mono)" }}
        />
        {suffix && <span style={{ fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────
export function Sparkline({ data, w = 80, h = 24, color = "var(--accent)", fill }: { data: number[]; w?: number; h?: number; color?: string; fill?: boolean }) {
  if (!data?.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1 || 1);
  const pts = data.map((d, i) => `${i * stepX},${h - ((d - min) / range) * (h - 2) - 1}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fill && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity="0.12" />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

"use client";
import React, { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n-context";
import { classifySymbol, RECOMMENDED_SYMBOLS, SYMBOL_TOKEN_LIMIT_BY_EXCHANGE } from "@gridpilot/shared-types";

const chip = (active: boolean): React.CSSProperties => ({
  padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13,
  border: `1px solid ${active ? "var(--accent)" : "var(--border-subtle)"}`,
  background: active ? "var(--accent-tint)" : "var(--bg-2)",
  color: active ? "var(--accent)" : "var(--fg-1)",
});

export function SymbolPicker({ value, exchangeId, onChange, onBlockedChange }: {
  value: string;
  exchangeId?: string;
  onChange: (symbol: string) => void;
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const { t } = useLang();
  const recommendedSet = new Set(RECOMMENDED_SYMBOLS.map((r) => r.symbol));
  const [explicitCustom, setExplicitCustom] = useState(false);
  const customMode = explicitCustom || (!!value && !recommendedSet.has(value));
  const [altAck, setAltAck] = useState(false);

  const tier = classifySymbol(value);
  const limit = exchangeId ? SYMBOL_TOKEN_LIMIT_BY_EXCHANGE[exchangeId] : undefined;
  const token = value.replace(/[/\\]/g, "");
  const tooLong = !!limit && token.length > limit;
  const isAltCustom = customMode && value.trim() !== "" && tier === "alt";
  const blocked = value.trim() === "" || tooLong || (isAltCustom && !altAck);

  useEffect(() => { onBlockedChange?.(blocked); }, [blocked, onBlockedChange]);
  // 切到非 alt 或清空时复位勾选状态
  useEffect(() => { if (!isAltCustom) { setAltAck(false); } }, [isAltCustom]);

  const pickRecommended = (s: string) => { setExplicitCustom(false); onChange(s); };

  const best = RECOMMENDED_SYMBOLS.filter((r) => r.tier === "best");
  const major = RECOMMENDED_SYMBOLS.filter((r) => r.tier === "major");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 4 }}>{t("symbol.tier_best_label")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {best.map((r) => (
            <button key={r.symbol} type="button" data-testid={`symbol-chip-${r.symbol}`} style={chip(!customMode && value === r.symbol)} onClick={() => pickRecommended(r.symbol)}>
              {r.symbol} · {t("symbol.recommended_badge")}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 4 }}>{t("symbol.tier_major_label")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {major.map((r) => (
            <button key={r.symbol} type="button" data-testid={`symbol-chip-${r.symbol}`} style={chip(!customMode && value === r.symbol)} onClick={() => pickRecommended(r.symbol)}>
              {r.symbol}
            </button>
          ))}
          <button type="button" data-testid="symbol-tab-custom" style={chip(customMode)} onClick={() => { setExplicitCustom(true); onChange(""); }}>
            {t("symbol.tier_other_label")}
          </button>
        </div>
      </div>

      {!customMode && tier === "major" && (
        <div style={{ fontSize: 12, color: "var(--fg-2)" }}>{t("symbol.major_caution")}</div>
      )}

      {customMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            data-testid="symbol-custom-input"
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            placeholder={t("symbol.custom_placeholder")}
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-2)", color: "var(--fg-1)", fontSize: 13 }}
          />
          {tooLong && <div style={{ fontSize: 12, color: "var(--down)" }}>{t("errors.SYMBOL_TOO_LONG_FOR_EXCHANGE")}</div>}
          {isAltCustom && (
            <div style={{ border: "1px solid var(--down)", borderRadius: 8, padding: 10, background: "rgba(239,68,68,0.06)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--down)", marginBottom: 4 }}>{t("symbol.alt_warning_title")}</div>
              <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 8 }}>{t("symbol.alt_warning_body")}</div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" data-testid="symbol-alt-ack" checked={altAck} onChange={(e) => setAltAck(e.target.checked)} />
                {t("symbol.alt_warning_ack")}
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

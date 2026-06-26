"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { Card, Button, SectionHeader, Badge } from "@/components/ui/primitives";
import { TermHelp } from "@/components/ui/term-help";
import { Icons } from "@/components/ui/icons";
import { useGridRecommendations, useAiSettings, useLatestRecommendations } from "@/lib/hooks/useAi";
import { AiSettingsForm } from "@/components/ai/ai-settings-form";
import { RECOMMENDED_SYMBOLS } from "@gridpilot/shared-types";
import type { GridRecommendation, GridRecommendationsResponse, LatestRecommendation, ApiError } from "@/lib/api";

export default function AiInsightsPage() {
  const { t } = useLang();
  const [symbol, setSymbol] = useState("ETH/USDT");
  const [direction, setDirection] = useState("LONG");
  const rec = useGridRecommendations();

  // 大模型是否已配置：按当前 provider 判断对应 key 是否存在。AI 推荐依赖 LLM 接口，
  // 首次打开（未配置）就地展示配置表单，无需跳转设置页。
  const { data: aiSettings } = useAiSettings();
  const notConfigured = !!aiSettings && (aiSettings.provider === "openai" ? !aiSettings.hasOpenaiKey : !aiSettings.hasAnthropicKey);
  const [showConfig, setShowConfig] = useState(false);
  const configOpen = notConfigured || showConfig;

  // 每个交易对最近一次后台分析结果：打开页面即展示，无需手动触发。
  const latest = useLatestRecommendations();

  // 查询栏右侧的现价 / 最近分析时间：优先按需结果，回退当前交易对最近一次后台分析。
  const marketStatus = useMemo(() => {
    const src = rec.data ?? latest.data?.find((it) => it.symbol === symbol) ?? latest.data?.[0];
    if (!src) return null;
    const ts = (src as LatestRecommendation).updatedAt ?? src.asOf;
    return {
      price: src.currentPrice ?? null,
      asOf: ts ? String(ts).slice(0, 10) : "",
    };
  }, [rec.data, latest.data, symbol]);

  return (
    <Shell
      breadcrumb={[t("nav.ai"), t("ai.title")]}
      topbarRight={
        <Button
          variant="primary"
          size="md"
          data-testid="ai-generate"
          icon={<Icons.Sparkles size={13} />}
          onClick={() => rec.mutate({ symbol, direction }, {})}
          disabled={rec.isPending}
          style={{ background: "var(--alpha)", color: "var(--btn-fg)", boxShadow: "0 6px 18px var(--alpha-tint-strong)" }}
        >
          {rec.isPending ? t("ai.generating") : t("ai.generate")}
        </Button>
      }
    >
      <SectionHeader title={t("ai.title")} subtitle={t("ai.subtitle")} />

      {/* 查询参数栏 */}
      <Card pad={14} style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--fg-2)", whiteSpace: "nowrap" }}>{t("ai.symbol")}</label>
          <select
            value={symbol}
            data-testid="ai-symbol-select"
            onChange={(e) => setSymbol(e.target.value)}
            style={{
              height: 32, padding: "0 12px", fontSize: 13, borderRadius: 7,
              border: "1px solid var(--border-default)", background: "var(--bg-2)",
              color: "var(--fg-0)", minWidth: 120, fontFamily: "var(--font-mono)",
            }}
          >
            {RECOMMENDED_SYMBOLS.map((r) => (
              <option key={r.symbol} value={r.symbol}>{r.symbol}</option>
            ))}
          </select>
          <select
            value={direction}
            data-testid="ai-direction-select"
            onChange={(e) => setDirection(e.target.value)}
            style={{
              height: 32, padding: "0 12px", fontSize: 13, borderRadius: 7,
              border: "1px solid var(--border-default)", background: "var(--bg-2)",
              color: "var(--fg-0)",
            }}
          >
            <option value="LONG">{t("dir.LONG")}</option>
            <option value="SHORT">{t("dir.SHORT")}</option>
          </select>
          <span style={{ flex: 1 }} />
          {/* 现价 / 最近分析时间：接真实数据（优先按需结果，回退最近分析） */}
          {marketStatus && (
            <span style={{ fontSize: 11.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
              {marketStatus.asOf && <>{t("ai.last_analysis")} <span className="num" style={{ color: "var(--fg-1)" }}>{marketStatus.asOf}</span>{" · "}</>}
              {marketStatus.price != null && <>{t("ai.current_price")} <span className="num" style={{ color: "var(--fg-1)" }}>${marketStatus.price}</span></>}
            </span>
          )}
          {/* 未配置时表单已强制展开，toggle 无意义故隐藏；已配置才提供展开/收起入口 */}
          {!notConfigured && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="ai-config-toggle"
              icon={<Icons.Settings size={12} />}
              onClick={() => setShowConfig((v) => !v)}
            >
              {t("ai.configure_model")}
            </Button>
          )}
        </div>
      </Card>

      {/* 大模型配置：未配置时（首次打开）默认展开，已配置可手动展开编辑 */}
      {configOpen && (
        <Card pad={18} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>{t("ai.configure_model")}</div>
          <AiSettingsForm onSaved={() => setShowConfig(false)} />
        </Card>
      )}

      {/* 加载态 */}
      {rec.isPending && (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--fg-2)", fontSize: 14 }}>
          <Icons.Sparkles size={18} style={{ color: "var(--alpha)", marginBottom: 8, display: "block", margin: "0 auto 8px" }} />
          {t("ai.generating")}
        </div>
      )}

      {/* 错误态 */}
      {rec.error && (
        <div
          data-testid="ai-error"
          style={{
            padding: "14px 18px", borderRadius: 8, background: "var(--down-tint)",
            border: "1px solid var(--down-tint)", color: "var(--down)",
            fontSize: 13, marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.Info size={13} />
            {/* 后端编码异常：优先按 error.code 译 errors.<code>，回退原始 message */}
            {(rec.error as ApiError).code ? t(`errors.${(rec.error as ApiError).code}`) : rec.error.message}
          </div>
        </div>
      )}

      {/* 按需生成有结果时渲染 */}
      {rec.data && <RecommendationsView data={rec.data} t={t} />}

      {/* 无按需结果时：优先展示后台最近一次分析（每交易对），否则给内联生成入口 */}
      {!rec.data && !rec.isPending && (latest.data && latest.data.length > 0) && (
        <LatestView items={latest.data} t={t} />
      )}

      {/* 初始提示（无按需结果、无最近分析）：给出明确的内联生成入口，避免页面一片空白 */}
      {!rec.data && !rec.error && !rec.isPending && !(latest.data && latest.data.length > 0) && (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
          <Icons.Sparkles size={28} style={{ color: "var(--alpha)", display: "block", margin: "0 auto 14px", opacity: 0.6 }} />
          <div style={{ marginBottom: 18 }}>{t("ai.subtitle")}</div>
          <Button
            variant="primary"
            size="md"
            data-testid="ai-generate-empty"
            icon={<Icons.Sparkles size={13} />}
            onClick={() => rec.mutate({ symbol, direction }, {})}
          >
            {t("ai.generate")}
          </Button>
        </div>
      )}
    </Shell>
  );
}

function LatestView({ items, t }: { items: LatestRecommendation[]; t: (k: string) => string }) {
  return (
    <>
      <SectionHeader title={t("ai.latest_title")} subtitle={t("ai.subtitle")} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {items.filter((it) => it.recommendations && it.recommendations.length > 0).map((it) => (
          <div key={`${it.symbol}-${it.direction}`}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{it.symbol}</span>
              <Badge tone="neutral">{t(`dir.${it.direction}`)}</Badge>
              {it.updatedAt && <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{String(it.updatedAt).slice(0, 10)}</span>}
            </div>
            <RecommendationCard rec={it.recommendations[0]} index={1} symbol={it.symbol} t={t} />
          </div>
        ))}
      </div>
    </>
  );
}

function RecommendationsView({ data, t }: { data: GridRecommendationsResponse; t: (k: string) => string }) {
  return (
    <>
      {/* 行情窗口 */}
      <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: -0.3, marginBottom: 14 }}>
        {t("ai.windows_title")}
      </div>
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5"
        style={{ marginBottom: 18 }}
      >
        {Object.entries(data.windows).map(([key, w]) => {
          const rows: { label: string; value: string; color?: string }[] = [
            { label: t("ai.metric.range_pct"), value: `$${w.low} – $${w.high}` },
            { label: t("ai.realized_vol_ann"), value: `${w.realizedVol.toFixed(0)}%` },
            { label: t("ai.metric.atr"), value: `$${w.atr.toFixed(1)}` },
            { label: t("ai.metric.max_drawdown"), value: `${w.maxDrawdownPct.toFixed(1)}%`, color: "var(--down)" },
            { label: t("ai.metric.trend"), value: `${w.trendPct > 0 ? "+" : ""}${w.trendPct.toFixed(1)}%`, color: w.trendPct >= 0 ? "var(--up)" : "var(--down)" },
          ];
          return (
            <Card key={key} pad={16}>
              <div style={{ fontSize: 11, color: "var(--fg-2)", marginBottom: 10, fontWeight: 600 }}>
                {t("ai.window_label").replace("{d}", String(w.days))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
                {rows.map((r) => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--fg-2)" }}>{r.label}</span>
                    <span className="num" style={{ color: r.color ?? "var(--fg-1)", fontWeight: 500 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      {/* VPVR 图表 */}
      <Card pad={0} style={{ marginBottom: 18, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "14px 17px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 10 }}>
          <Icons.Sparkles size={14} style={{ color: "var(--alpha)" }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{data.symbol} · {t("ai.vpvr_title")}</span>
          <Badge tone="neutral">{data.asOf ? data.asOf.slice(0, 10) : "latest"}</Badge>
          <span style={{ flex: 1 }} />
          <span className="num" style={{ fontSize: 11, color: "var(--fg-2)" }}>${data.currentPrice}</span>
        </div>
        <div style={{ padding: "14px 0" }}>
          <VPVRChart
            vpvr={data.vpvr}
            recommendations={data.recommendations}
            currentPrice={data.currentPrice}
          />
        </div>
      </Card>

      {/* 推荐配置卡 */}
      <SectionHeader title={t("ai.candidates")} subtitle={t("ai.candidates_sub")} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {data.recommendations.map((r, i) => (
          <RecommendationCard key={i} rec={r} index={i} symbol={data.symbol} t={t} />
        ))}
      </div>

      <div style={{ marginTop: 18, padding: 14, background: "var(--bg-2)", borderRadius: 8, fontSize: 12, color: "var(--fg-1)", lineHeight: 1.6 }}>
        <div style={{ display: "flex", gap: 8, color: "var(--info)", fontWeight: 500, marginBottom: 6 }}>
          <Icons.Info size={13} /> {t("ai.note_title")}
        </div>
        {t("ai.note_body")}
      </div>
    </>
  );
}

const RISK_TONE: Record<string, "up" | "warn" | "down"> = { low: "up", mid: "warn", high: "down" };
// 证据指标 key → glossary 术语 key（用于 TermHelp）。
const METRIC_TERM: Record<string, string> = {
  realized_vol: "realizedVolatility", range_pct: "rangePct", atr: "atr",
  max_drawdown: "maxDrawdown", trend: "trend", vpvr_node: "vpvrNode",
};

function RiskBadge({ tier, t }: { tier?: "low" | "mid" | "high"; t: (k: string) => string }) {
  if (!tier) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <Badge tone={RISK_TONE[tier]}>{t(`ai.risk.${tier}`)}</Badge>
      <TermHelp term="riskTier" title={t(`ai.risk.${tier}`)} />
    </span>
  );
}

function RecommendationCard({
  rec, index, symbol, t,
}: {
  rec: GridRecommendation; index: number; symbol: string; t: (k: string) => string;
}) {
  // 后端合成的稳健变体 label/rationale 为空 → 用固定 i18n 文案。
  const isSynth = !rec.label;
  const cardLabel = isSynth ? t("ai.synth_conservative_label") : rec.label;
  const cardRationale = rec.rationale || (isSynth ? t("ai.synth_conservative_rationale") : "");
  const seedBox = {
    symbol,
    direction: rec.direction,
    box: {
      takeProfitPrice: rec.takeProfitPrice,
      mainGridCount: rec.mainGridCount,
      mainGridStep: rec.mainGridStep,
      mainGridPortionSize: rec.mainGridPortionSize,
      leverage: rec.leverage,
      stopLossGridCount: rec.stopLossGridCount,
      stopLossGridStep: rec.stopLossGridStep,
      isolationStep: rec.isolationStep,
    },
  };
  const href = `/robots/new?seedBox=${encodeURIComponent(JSON.stringify(seedBox))}`;

  return (
    <Card
      pad={18}
      style={
        index === 0
          ? { borderRadius: 14, border: "1.5px solid var(--alpha-tint-strong)", background: "linear-gradient(150deg, var(--alpha-tint) 0%, var(--bg-1) 50%)", position: "relative", overflow: "hidden" }
          : { borderRadius: 14 }
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{cardLabel}</div>
          <RiskBadge tier={rec.riskTierFinal} t={t} />
        </div>
        {index === 0 && <Badge tone="alpha" glow><Icons.Sparkles size={9} />{t("ai.recommended")}</Badge>}
      </div>
      <div className="num" style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.5, marginBottom: 5 }}>
        ${rec.boxLowPrice} — ${rec.boxHighPrice}
      </div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", marginBottom: 10 }}>
        {t("ai.conf")}<TermHelp term="confidence" title={t("ai.conf")} />{" "}
        <span className="num" style={{ color: rec.confidence > 0.7 ? "var(--up)" : "var(--warn)" }}>
          {(rec.confidence * 100).toFixed(0)}%
        </span>
        {" · "}TP <span className="num">${rec.takeProfitPrice}</span>
        {" · "}×{rec.leverage}<TermHelp term="leverage" />
      </div>
      {cardRationale && (
        <div style={{ fontSize: 11.5, color: "var(--fg-2)", marginBottom: 10, lineHeight: 1.5 }}>
          {cardRationale}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
        {(rec.evidence ?? []).map((e, j) => (
          <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "5px 8px", background: "var(--bg-2)", borderRadius: 5 }}>
            <span style={{ color: "var(--fg-2)", display: "inline-flex", alignItems: "center" }}>
              {t(`ai.metric.${e.metricKey}`)}
              {METRIC_TERM[e.metricKey] && <TermHelp term={METRIC_TERM[e.metricKey]} title={t(`ai.metric.${e.metricKey}`)} />}
            </span>
            <span className="num" style={{ color: "var(--fg-1)", fontWeight: 500 }}>{e.value}</span>
          </div>
        ))}
      </div>
      <Link data-testid={`ai-use-config-${index}`} href={href} style={{ display: "block" }}>
        <Button variant={index === 0 ? "primary" : "secondary"} size="md" full icon={<Icons.Plus size={12} />}>
          {t("ai.use_config")}
        </Button>
      </Link>
    </Card>
  );
}

function VPVRChart({
  vpvr, recommendations, currentPrice,
}: {
  vpvr: GridRecommendationsResponse["vpvr"];
  recommendations: GridRecommendation[];
  currentPrice: number;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = React.useState(1000);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(Math.max(320, entry.contentRect.width));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = containerWidth;
  const h = Math.min(280, Math.max(180, w * 0.28));
  const padL = Math.min(100, w * 0.1);
  const padR = Math.min(30, w * 0.03);
  const padY = 16;
  const innerW = w - padL - padR;
  const innerH = h - padY * 2;

  const { bins, priceLow, priceHigh } = vpvr;
  const priceMin = priceLow;
  const priceMax = priceHigh;

  const maxBin = useMemo(() => Math.max(...bins, 1), [bins]);
  const binCount = bins.length;

  const yFor = (p: number) => padY + (1 - (p - priceMin) / (priceMax - priceMin)) * innerH;

  const labelPrices = useMemo(() => {
    const step = (priceMax - priceMin) / 5;
    return Array.from({ length: 6 }, (_, i) => Math.round(priceMin + i * step));
  }, [priceMin, priceMax]);

  return (
    <div ref={containerRef} style={{ width: "100%", overflow: "hidden" }}>
      <svg width={w} height={h} style={{ display: "block" }}>
        {/* VPVR bins（横向柱，从左轴向左伸） */}
        {bins.map((v, i) => {
          const binHeight = innerH / binCount;
          const binLow = priceMin + (i / binCount) * (priceMax - priceMin);
          const binHigh = priceMin + ((i + 1) / binCount) * (priceMax - priceMin);
          const yTop = yFor(binHigh);
          const barWidth = (v / maxBin) * (padL - 20);
          return (
            <rect
              key={i}
              x={padL - barWidth}
              y={yTop + 1}
              width={barWidth}
              height={Math.max(1, binHeight - 2)}
              fill="var(--accent)"
              opacity={0.15 + (v / maxBin) * 0.4}
            />
          );
        })}
        {/* Y 轴 */}
        <line x1={padL} y1={padY} x2={padL} y2={padY + innerH} stroke="var(--border-default)" />
        {/* 推荐区间标注 */}
        {recommendations.map((r, i) => {
          const yHi = yFor(r.boxHighPrice);
          const yLo = yFor(r.boxLowPrice);
          const color = ["var(--alpha)", "var(--accent)", "var(--fg-3)"][i] ?? "var(--fg-3)";
          return (
            <g key={i}>
              <rect
                x={padL + i * 4}
                y={yHi}
                width={innerW - i * 8}
                height={Math.max(2, yLo - yHi)}
                fill="none"
                stroke={color}
                strokeOpacity={0.4}
                strokeDasharray={i === 0 ? "" : "4 3"}
                strokeWidth="1.2"
              />
              <text
                x={padL + 8 + i * 4}
                y={yHi + 12}
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill={color}
                fontWeight="600"
              >
                {r.label} · {r.boxLowPrice}–{r.boxHighPrice}
              </text>
            </g>
          );
        })}
        {/* 当前价格线 */}
        {(() => {
          const y = yFor(currentPrice);
          return (
            <g>
              <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="var(--accent)" strokeDasharray="3 3" opacity="0.5" />
              <rect x={w - padR - 60} y={y - 10} width="55" height="20" rx="3" fill="var(--accent)" />
              <text x={w - padR - 32} y={y + 4} fontSize="11" fontFamily="var(--font-mono)" fontWeight="600" fill="var(--btn-fg)" textAnchor="middle">
                {currentPrice.toFixed(0)}
              </text>
            </g>
          );
        })()}
        {/* Y 轴价格标签 */}
        {labelPrices.map((p) => (
          <text key={p} x={padL - 8} y={yFor(p) + 3} fontSize="10" fill="var(--fg-3)" fontFamily="var(--font-mono)" textAnchor="end">
            {p}
          </text>
        ))}
        <text x={20} y={padY + 12} fontSize="10" fill="var(--fg-3)">← VPVR</text>
      </svg>
    </div>
  );
}

"use client";

import React from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { useRobots, useArchivedRobots, useEvents } from "@/lib/hooks/useBots";
import { Card } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { TermHelp } from "@/components/ui/term-help";
import { estimateRebate, isReferralMuted } from "@/lib/referral";
import { eventsApi } from "@/lib/api";
import { DateRangePicker, type DateRangeValue, formatLocalDate } from "@/components/history/date-range-picker";
import { RobotSelect } from "@/components/history/robot-select";

type RouteKey = "ALL" | "POC" | "GTC" | "UNKNOWN";
type SortBy = "time" | "notional" | "realizedPnl" | "fee";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

// ── 内联 SVG（设计稿专属，icons.tsx 无对应项）────────────────
function CaretRight({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <Icons.ChevronDown size={10} style={{ color: "var(--fg-3)", opacity: 0.4 }} />;
  return dir === "asc"
    ? <Icons.ChevronUp size={10} style={{ color: "var(--accent)" }} />
    : <Icons.ChevronDown size={10} style={{ color: "var(--accent)" }} />;
}

// ── KPI 瓦片（对齐设计稿：10px uppercase 标签 / 22px mono 数字）──
function KpiTile({
  label,
  labelHelp,
  value,
  sub,
  subNode,
  tone = "default",
  highlight,
  onClick,
  testId,
}: {
  label: string;
  labelHelp?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subNode?: React.ReactNode;
  tone?: "default" | "up" | "down" | "alpha" | "maker";
  highlight?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const valueColor =
    tone === "up" ? "var(--up)" :
    tone === "down" ? "var(--down)" :
    tone === "alpha" ? "var(--alpha)" :
    tone === "maker" ? "var(--maker)" :
    "var(--fg-0)";
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      style={{
        position: "relative",
        overflow: "hidden",
        background: highlight ? "var(--alpha-tint)" : "var(--bg-1)",
        border: `1px solid ${highlight ? "var(--alpha-tint-strong)" : "var(--border-subtle)"}`,
        borderRadius: 12,
        padding: "14px 15px",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {highlight && (
        <div style={{ position: "absolute", top: 0, right: 0, width: 80, height: 80, background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.1, pointerEvents: "none" }} />
      )}
      <div style={{ fontSize: 10, color: highlight ? "var(--alpha)" : "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, display: "inline-flex", alignItems: "center" }}>{label}{labelHelp && <TermHelp term={labelHelp} title={label} />}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 6, color: valueColor, letterSpacing: -0.5 }}>{value}</div>
      {subNode
        ? <div style={{ marginTop: 2 }}>{subNode}</div>
        : sub != null && <div style={{ fontSize: 10.5, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SortableHeader({ label, help, sortKey, sort, setSort, testId }: {
  label: string; help?: string; sortKey: SortBy;
  sort: { by: SortBy; dir: SortDir }; setSort: (s: { by: SortBy; dir: SortDir }) => void; testId: string;
}) {
  const active = sort.by === sortKey;
  return (
    <th
      data-testid={testId}
      onClick={() => setSort({ by: sortKey, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
      style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}{help && <TermHelp term={help} title={label} />}
        <SortIcon active={active} dir={sort.dir} />
      </span>
    </th>
  );
}

type FillData = {
  orderId?: string;
  clientOrderId?: string;
  fillQty?: number;
  fillPrice?: number;
  side?: string;
  gridIndex?: number;
  fee?: number;
  savings?: number;
  realizedPnlDelta?: number;
};

export default function TradeHistoryPage() {
  const { t } = useLang();
  const { data: robots } = useRobots();
  const { data: archivedRobots } = useArchivedRobots();
  const allRobots = React.useMemo(() => [...(robots ?? []), ...(archivedRobots ?? [])], [robots, archivedRobots]);

  const [dateRange, setDateRange] = React.useState<DateRangeValue>(() => ({
    from: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 7); return d; })(),
    to: new Date(),
  })); // 默认最近 7 天(与 DateRangePicker 的"最近7天"预设定义一致：daysAgo(7) ~ 现在)，与原来的默认值保持一致
  const [robotId, setRobotId] = React.useState<string>("");
  const [route, setRoute] = React.useState<RouteKey>("ALL");
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ by: SortBy; dir: SortDir }>({ by: "time", dir: "desc" });
  const [page, setPage] = React.useState(0);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  React.useEffect(() => { setPage(0); }, [dateRange, robotId, route, search, sort]);

  const since = dateRange.from ? dateRange.from.toISOString() : undefined;
  const until = dateRange.to ? dateRange.to.toISOString() : undefined;
  const queryParams = {
    type: "FILL",
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    robotId: robotId || undefined,
    route: route === "ALL" ? undefined : route,
    search: search || undefined,
    since,
    until,
    sortBy: sort.by,
    sortDir: sort.dir,
  } as const;

  const { data: events } = useEvents(queryParams);
  const fills = events?.data ?? [];
  const total = events?.total ?? 0;

  // KPI 走后端对完整过滤结果(不只当前页)的聚合，不能对 fills(当前页 50 条)做 reduce——
  // 否则翻页/切路由筛选时这几个数字会跟着页面波动，而不是反映"当前筛选范围"的真实汇总。
  const aggregates = events?.aggregates;
  const totalFee = aggregates?.totalFee ?? 0;
  const totalSavings = aggregates?.totalSavings ?? 0;
  const totalRealizedPnl = aggregates?.totalRealizedPnl ?? 0;
  const makerFills = aggregates?.makerCount ?? 0;
  const gtcCaptures = aggregates?.gtcCount ?? 0;
  const knownRouteCount = makerFills + gtcCaptures;
  const makerPct = knownRouteCount > 0 ? Math.round((makerFills / knownRouteCount) * 100) : 0;
  const botCount = allRobots.length;

  // ── 返佣引导（已付手续费 KPI 内）──────────────────────────
  // 按各机器人所在交易所比例汇总可返金额（与 dashboard 一致）。
  const rebateEstimate = allRobots.reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);
  const showRebateNudge = !isReferralMuted() && rebateEstimate > 0.01;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportHref = eventsApi.exportUrl({
    robotId: robotId || undefined,
    route: route === "ALL" ? undefined : route,
    search: search || undefined,
    since,
    until,
    sortBy: sort.by,
    sortDir: sort.dir,
  });

  return (
    <Shell breadcrumb={[t("nav.history")]}>
      {/* 页头 */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 23, fontWeight: 600, letterSpacing: -0.6, marginBottom: 4 }}>{t("hist.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--fg-2)" }}>{t("hist.subtitle")}</p>
        </div>
        <a
          data-testid="hist-export-csv"
          href={exportHref}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", fontSize: 13, color: "var(--fg-0)", textDecoration: "none" }}
        >
          <Icons.Download size={14} />{t("common.export_csv")}
        </a>
      </div>

      {/* 6 KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6" style={{ gap: 12, marginBottom: 18 }}>
        <KpiTile
          label={t("hist.total_fills_range", {
            range: dateRange.from && dateRange.to
              ? `${formatLocalDate(dateRange.from)}~${formatLocalDate(dateRange.to)}`
              : t("hist.range_all"),
          })}
          value={total.toLocaleString("en-US")}
          sub={t("hist.across_bots", { n: botCount })}
          testId="kpi-total-fills"
        />
        <KpiTile
          label={t("hist.maker_fills")}
          value={makerFills.toLocaleString("en-US")}
          sub={t("hist.poc_route_pct", { pct: makerPct })}
          tone="maker"
          testId="kpi-maker-fills"
        />
        <KpiTile
          label={t("hist.gtc_captures")}
          value={gtcCaptures.toLocaleString("en-US")}
          sub={t("hist.excess_triggers")}
          tone="alpha"
          testId="kpi-gtc"
        />
        <KpiTile
          label={t("hist.total_alpha")}
          value={`$${totalSavings.toFixed(2)}`}
          sub={t("hist.alpha_breakdown")}
          tone="alpha"
          highlight
          testId="kpi-alpha"
        />
        <KpiTile
          label={t("hist.fees_paid")}
          labelHelp="fee"
          value={`$${totalFee.toFixed(2)}`}
          testId="kpi-fees"
          subNode={
            showRebateNudge ? (
              <div data-testid="hist-rebate-nudge" style={{ fontSize: 10.5, color: "var(--alpha)", display: "flex", alignItems: "center", gap: 3 }}>
                {t("hist.rebate_nudge", { rebate: rebateEstimate.toFixed(0) })}
                <CaretRight size={9} />
              </div>
            ) : (
              <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>{t("hist.fees_period")}</span>
            )
          }
        />
        <KpiTile
          label={t("hist.total_realized_pnl")}
          value={`${totalRealizedPnl >= 0 ? "+" : ""}$${totalRealizedPnl.toFixed(2)}`}
          sub={t("hist.fees_period")}
          tone={totalRealizedPnl >= 0 ? "up" : "down"}
          testId="kpi-realized-pnl"
        />
      </div>

      {/* 过滤器：搜索 + 下拉 + 范围分段 */}
      <div style={{ display: "flex", gap: 9, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, flex: 1, minWidth: 160 }}>
          <Icons.Search size={13} style={{ color: "var(--fg-3)" }} />
          <input
            data-testid="hist-search-input"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("hist.placeholder")}
            style={{ border: "none", outline: "none", background: "transparent", fontSize: 12, color: "var(--fg-0)", flex: 1 }}
          />
        </div>
        <RobotSelect
          robots={allRobots}
          value={robotId}
          onChange={setRobotId}
          testId="hist-bot-select"
        />
        <select
          data-testid="hist-route-select"
          value={route}
          onChange={(e) => setRoute(e.target.value as RouteKey)}
          className="gp-hide-mobile"
          style={{ height: 36, padding: "0 13px", background: "var(--bg-1)", border: "1px solid var(--border-default)", borderRadius: 9, fontSize: 12 }}
        >
          <option value="ALL">{t("hist.all_routes")}</option>
          <option value="POC">POC</option>
          <option value="GTC">GTC</option>
          <option value="UNKNOWN">{t("hist.route_unknown")}</option>
        </select>
        <DateRangePicker value={dateRange} onChange={setDateRange} testId="hist-range" />
      </div>

      {/* 成交流水表 */}
      <Card pad={0} style={{ borderRadius: 14 }}>
        <div className="gp-table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--fg-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
                <th
                  data-testid="hist-sort-time"
                  onClick={() => setSort({ by: "time", dir: sort.by === "time" && sort.dir === "desc" ? "asc" : "desc" })}
                  style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{t("hist.col_time")}<SortIcon active={sort.by === "time"} dir={sort.dir} /></span>
                </th>
                <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600 }}>{t("hist.col_bot")}</th>
                <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600 }}>{t("hist.col_side")}</th>
                <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>{t("hist.col_grid")}</th>
                <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>{t("hist.col_price")}</th>
                <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}>{t("hist.col_qty")}</th>
                <SortableHeader label={t("hist.col_notional")} sortKey="notional" sort={sort} setSort={setSort} testId="hist-sort-notional" />
                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>{t("hist.col_route")}</th>
                <SortableHeader label={t("hist.col_fee")} help="fee" sortKey="fee" sort={sort} setSort={setSort} testId="hist-sort-fee" />
                <th style={{ padding: "10px 8px", textAlign: "right", fontWeight: 600 }}><span style={{ display: "inline-flex", alignItems: "center" }}>{t("hist.col_alpha")}<TermHelp term="alpha" title={t("hist.col_alpha")} /></span></th>
                <SortableHeader label={t("hist.col_realized_pnl")} sortKey="realizedPnl" sort={sort} setSort={setSort} testId="hist-sort-realized-pnl" />
              </tr>
            </thead>
            <tbody style={{ fontSize: 12 }}>
              {fills.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: "40px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
                    {t("hist.no_data")}
                  </td>
                </tr>
              )}
              {fills.map((ev) => {
                const d = ev.eventData as FillData;
                const ts = new Date(ev.createdAt).toLocaleString();
                const symbol = ev.symbol ?? "—";
                const isBuy = (d.side ?? "").toUpperCase() === "BUY";
                const sideColor = isBuy ? "var(--up)" : "var(--down)";
                const notional = d.fillQty && d.fillPrice ? d.fillQty * d.fillPrice : null;
                const route = ev.route;
                const isMaker = route === "POC";
                const isKnownRoute = route != null;
                const pnl = d.realizedPnlDelta;
                const expanded = expandedId === ev.id;
                return (
                  <React.Fragment key={ev.id}>
                    <tr
                      data-testid="hist-row"
                      onClick={() => setExpandedId(expanded ? null : ev.id)}
                      style={{ borderTop: "1px solid var(--border-subtle)", cursor: "pointer" }}
                    >
                      <td style={{ padding: "10px 16px", whiteSpace: "nowrap", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{ts}</td>
                      <td style={{ padding: "10px 8px", fontWeight: 500 }}>{symbol}</td>
                      <td style={{ padding: "10px 8px" }}><span style={{ color: sideColor, fontWeight: 600 }}>{d.side ?? "—"}</span></td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-3)" }}>{typeof d.gridIndex === "number" && d.gridIndex >= 0 ? `G${d.gridIndex}` : "—"}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: sideColor }}>{d.fillPrice?.toFixed(2) ?? "—"}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right" }}>{d.fillQty?.toFixed(4) ?? "—"}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-2)" }}>{notional?.toFixed(2) ?? "—"}</td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        {isKnownRoute ? (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, color: isMaker ? "var(--maker)" : "var(--taker)", background: isMaker ? "var(--maker-tint)" : "var(--taker-tint)" }}>{route}</span>
                        ) : (
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, color: "var(--fg-3)", background: "var(--bg-2)" }}>{t("hist.route_unknown")}</span>
                        )}
                      </td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--fg-3)" }}>${(d.fee ?? 0).toFixed(4)}</td>
                      <td className="num" style={{ padding: "10px 8px", textAlign: "right", color: "var(--alpha)" }}>${(d.savings ?? 0).toFixed(4)}</td>
                      <td className="num" style={{ padding: "10px 16px", textAlign: "right", color: pnl != null && pnl >= 0 ? "var(--up)" : pnl != null ? "var(--down)" : "var(--fg-3)" }}>
                        {pnl != null ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)}` : "—"}
                      </td>
                    </tr>
                    {expanded && (
                      <tr data-testid="hist-row-detail">
                        <td colSpan={11} style={{ padding: "10px 16px", background: "var(--bg-2)", fontSize: 11, color: "var(--fg-2)" }}>
                          <span style={{ marginRight: 20 }}>{t("hist.detail_order_id")}: {d.orderId ?? "—"}</span>
                          <span style={{ marginRight: 20 }}>{t("hist.detail_client_order_id")}: {d.clientOrderId ?? "—"}</span>
                          <span>{t("hist.detail_account")}: {ev.accountLabel ?? "—"}</span>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderTop: "1px solid var(--border-subtle)" }}>
          <span data-testid="hist-page-total" style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{t("hist.pagination_total", { n: total })}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              data-testid="hist-page-prev"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ padding: "5px 12px", fontSize: 12, borderRadius: 7, border: "1px solid var(--border-default)", background: "transparent", color: page === 0 ? "var(--fg-3)" : "var(--fg-0)", cursor: page === 0 ? "default" : "pointer" }}
            >
              {t("hist.pagination_prev")}
            </button>
            <button
              data-testid="hist-page-next"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              style={{ padding: "5px 12px", fontSize: 12, borderRadius: 7, border: "1px solid var(--border-default)", background: "transparent", color: page >= totalPages - 1 ? "var(--fg-3)" : "var(--fg-0)", cursor: page >= totalPages - 1 ? "default" : "pointer" }}
            >
              {t("hist.pagination_next")}
            </button>
          </div>
        </div>
      </Card>
    </Shell>
  );
}

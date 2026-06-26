"use client";

import React, { use } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell/shell";
import { useBoxPnl, useBoxFills } from "@/lib/hooks/useBots";
import { SectionHeader } from "@/components/ui/primitives";
import { useLang } from "@/lib/i18n-context";

export default function BoxHistoryPage({ params }: { params: Promise<{ id: string; boxId: string }> }) {
  const { id, boxId } = use(params);
  const { t } = useLang();
  const { data: pnl } = useBoxPnl(boxId);
  const { data: fillsData } = useBoxFills(boxId);
  const fills = fillsData?.data ?? [];
  const realized = pnl?.realizedPnl ?? 0;

  return (
    <Shell breadcrumb={[t("robot.page_title"), t("box.history_title")]}>
      <SectionHeader title={t("box.history_title")} subtitle={t("box.history_subtitle")} action={
        <Link href={`/robots/${id}`} style={{ fontSize: 13, color: "var(--accent)" }}>{t("box.back_to_robot")}</Link>
      } />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-0" style={{ marginBottom: 16, marginTop: 12, background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" }}>{t("box.cumulative_realized")}</div>
          <div className="num" data-testid="box-realized-pnl" style={{ fontSize: 20, color: realized >= 0 ? "var(--up)" : "var(--down)", marginTop: 4 }}>
            {realized >= 0 ? "+" : ""}{realized.toFixed(2)}
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase" }}>{t("box.fill_count")}</div>
          <div className="num" style={{ fontSize: 20, marginTop: 4 }}>{pnl?.fillCount ?? 0}</div>
        </div>
      </div>

      <SectionHeader title={t("box.fills_title")} subtitle={t("box.fills_count", { n: fills.length })} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {fills.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)" }}>{t("box.no_fills")}</div>
        ) : (
          fills.map((f) => {
            const d = f.eventData;
            const side = (d.side ?? "").toUpperCase();
            return (
              <div key={f.id} data-testid="fill-row" style={{ display: "flex", justifyContent: "space-between", padding: 12, background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 13 }}>
                <span style={{ color: side === "BUY" ? "var(--up)" : "var(--down)", fontWeight: 500 }}>{t(side === "BUY" ? "side.BUY" : "side.SELL")}</span>
                <span className="num">{Number(d.fillQty ?? 0)} @ {Number(d.fillPrice ?? 0).toFixed(2)}</span>
                <span style={{ color: "var(--fg-3)" }} suppressHydrationWarning>{new Date(f.createdAt).toLocaleString()}</span>
              </div>
            );
          })
        )}
      </div>
    </Shell>
  );
}

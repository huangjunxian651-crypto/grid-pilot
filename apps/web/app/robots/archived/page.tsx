"use client";

import React from "react";
import Link from "next/link";
import { Shell } from "@/components/shell/shell";
import { useArchivedRobots } from "@/lib/hooks/useBots";
import { SectionHeader, ExchangeMark, Button } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { CopyRobotButton } from "@/components/robots/copy-robot-button";
import { PnlCell } from "@/components/robots/pnl-cell";
import { fmt } from "@/lib/store";
import { useLang } from "@/lib/i18n-context";

export default function ArchivedRobotsPage() {
  const { t } = useLang();
  const { data: robots, isLoading } = useArchivedRobots();
  const list = robots ?? [];

  return (
    <Shell breadcrumb={[t("robot.nav"), t("robot.nav_archived")]}>
      <SectionHeader
        title={t("robot.archived_title")}
        subtitle={t("robot.archived_subtitle")}
        action={<Link href="/robots"><Button variant="ghost" size="sm" icon={<Icons.History size={13} />}>{t("robot.back_to_active")}</Button></Link>}
      />
      {isLoading ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>{t("common.loading")}</div>
      ) : list.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>{t("robot.archived_empty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {list.map((r) => (
            <div key={r.id} data-testid="archived-robot-card" style={{ display: "flex", alignItems: "center", gap: 14, padding: 16, background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 10 }}>
              <ExchangeMark exchange={(r.exchangeId === "binance" || r.exchangeId === "gateio" || r.exchangeId === "okx") ? r.exchangeId : "gateio"} size={32} />
              <Link href={`/robots/${r.id}`} style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {r.symbol}
                  <span style={{ fontSize: 11, color: "var(--fg-3)", marginLeft: 8, fontWeight: 400 }}>{fmt.exchangeName(r.exchangeId)} · {r.accountLabel}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>
                  {r.direction} · <span style={{ color: "var(--fg-3)" }}>{r.status}</span>
                  {r.lastPositionQty != null && r.lastPositionQty !== 0
                    ? " · " + t("robot.stopped_position", { qty: r.lastPositionQty.toFixed(4), pnl: (r.lastUnrealizedPnl ?? 0).toFixed(2) })
                    : ""}
                  <span> · {t("robot.manage_boxes", { n: r.boxCount })}</span>
                </div>
              </Link>
              <div style={{ marginRight: 8 }}>
                <PnlCell realizedPnl={r.realizedPnl} totalFees={r.totalFees} netPnl={r.netPnl} totalPnl={r.totalPnl} lastUnrealizedPnl={r.lastUnrealizedPnl} />
              </div>
              <CopyRobotButton robotId={r.id} />
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { Button, SectionHeader } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { resolveNotificationBody } from "@/lib/notification-body";
import { RebateReminderCard } from "@/components/referral/rebate-reminder-card";

// 类型 → 着色：alert=红 / alpha=金 / warn=金(警告) / info=蓝(maker)，与设计稿一致
const TYPE_STYLE: Record<string, { icon: React.ReactNode; color: string; tint: string }> = {
  alert: { icon: <Icons.Alert size={15} />, color: "var(--down)", tint: "var(--down-tint)" },
  alpha: { icon: <Icons.Sparkles size={15} />, color: "var(--alpha)", tint: "var(--alpha-tint)" },
  warn: { icon: <Icons.Alert size={15} />, color: "var(--warn)", tint: "var(--alpha-tint)" },
  info: { icon: <Icons.Info size={15} />, color: "var(--maker)", tint: "var(--maker-tint)" },
};

export default function NotificationsPage() {
  const { t } = useLang();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { notifications, isLoading, unreadCount, markAllRead, markRead, deleteAll } = useNotifications();

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const visible = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  const handleMarkAllRead = () => markAllRead.mutate();
  const handleMarkRead = (id: string) => {
    if (!markRead.isPending) markRead.mutate(id);
  };
  const handleClearAll = () => {
    deleteAll.mutate();
    setShowClearConfirm(false);
  };

  return (
    <Shell breadcrumb={[t("nav.notifications")]}>
      <SectionHeader
        title={t("noti.title")}
        subtitle={t("noti.subtitle")}
        action={
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 3, padding: 3, background: "var(--bg-2)", borderRadius: 9 }}>
              {(["all", "unread"] as const).map((f) => {
                const active = filter === f;
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    data-testid={`noti-filter-${f}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "6px 13px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      background: active ? "var(--bg-1)" : "transparent",
                      color: active ? "var(--fg-0)" : "var(--fg-2)",
                      border: active ? "1px solid var(--border-subtle)" : "1px solid transparent",
                      cursor: "pointer",
                    }}
                  >
                    {f === "all" ? t("noti.all") : t("noti.unread")}
                    {f === "unread" && unreadCount > 0 && (
                      <span
                        className="num"
                        style={{
                          marginLeft: 5,
                          fontSize: 10,
                          padding: "0 5px",
                          background: "var(--alpha)",
                          color: "var(--btn-fg)",
                          borderRadius: 4,
                        }}
                      >
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <Button variant="ghost" size="md" onClick={handleMarkAllRead} data-testid="noti-mark-all-read">
              {t("noti.mark_all_read")}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setShowClearConfirm(true)} data-testid="noti-clear-all">
              {t("noti.clear_all")}
            </Button>
          </div>
        }
      />

      {showClearConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            data-testid="noti-clear-confirm"
            style={{
              background: "var(--bg-1)",
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: "90%",
              border: "1px solid var(--border-subtle)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, fontFamily: "var(--font-display)", letterSpacing: -0.3 }}>
              {t("noti.clear_all")}
            </h3>
            <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 20 }}>{t("noti.clear_all_confirm")}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="ghost" size="md" onClick={() => setShowClearConfirm(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" size="md" onClick={handleClearAll} disabled={deleteAll.isPending} data-testid="noti-clear-confirm-btn">
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {filter === "all" && <RebateReminderCard />}
        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 14 }}>{t("common.loading")}</div>
        ) : visible.length === 0 ? (
          <div data-testid="noti-empty" style={{ padding: 40, textAlign: "center", color: "var(--fg-3)", fontSize: 14 }}>
            {t("noti.empty")}
          </div>
        ) : (
          visible.map((n) => {
            const ts = TYPE_STYLE[n.type] ?? TYPE_STYLE.info;
            const timeMs = new Date(n.createdAt).getTime();
            const minutesAgo = Math.floor((now - timeMs) / 60000);
            const hoursAgo = Math.floor((now - timeMs) / 3600000);
            return (
              <div
                key={n.id}
                data-testid={`noti-card-${n.id}`}
                data-read={n.read ? "true" : "false"}
                onClick={() => !n.read && handleMarkRead(n.id)}
                style={{
                  display: "flex",
                  gap: 14,
                  padding: 16,
                  background: "var(--bg-1)",
                  border: `1px solid ${n.read ? "var(--border-subtle)" : "var(--border-default)"}`,
                  borderRadius: 12,
                  opacity: n.read ? 0.66 : 1,
                  cursor: n.read ? "default" : "pointer",
                }}
              >
                {!n.read && (
                  <div
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--alpha)", flexShrink: 0, marginTop: 6 }}
                  />
                )}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: ts.tint,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: ts.color,
                    flexShrink: 0,
                    // 已读卡无未读点，图标左移 20 与未读卡正文对齐（设计稿一致）
                    marginLeft: n.read ? 20 : 0,
                  }}
                >
                  {ts.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{n.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      {n.rangeId && (
                        <span
                          className="num"
                          style={{
                            fontSize: 10,
                            color: "var(--fg-2)",
                            background: "var(--bg-3)",
                            padding: "1px 7px",
                            borderRadius: 5,
                          }}
                        >
                          {n.rangeId}
                        </span>
                      )}
                      <span className="num" style={{ fontSize: 11, color: "var(--fg-3)" }} suppressHydrationWarning>
                        {minutesAgo < 60 ? t("noti.time_m", { n: minutesAgo }) : t("noti.time_h", { n: hoursAgo })}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 4 }}>{resolveNotificationBody(n, t)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Shell>
  );
}

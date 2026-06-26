"use client";

import React, { useState, useEffect, useRef } from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { Card, Button, SectionHeader, Field } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { useThemeStore } from "@/lib/store";
import { SUPPORTED_LANGS, type Lang } from "@/lib/i18n";
import { useCredentials, useDeleteCredential } from "@/lib/hooks/useCredentials";
import { useRobots, useStopRobot } from "@/lib/hooks/useBots";
import { useProfile, useUpdateProfile, useDeleteAccount } from "@/lib/hooks/useProfile";
import { useChangePassword } from "@/lib/hooks/useAuth";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { ReferralRegisterCards } from "@/components/referral/referral-register-cards";
import { ReferralTips } from "@/components/referral/referral-cta";
import { estimateRebate } from "@/lib/referral";
import { avatarInitials } from "@/app/settings/avatar-initials";
import { toast } from "sonner";

// ── Section title (font-display, 设计稿 1369/1404 标题) ─────────────
function PanelTitle({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <h3 style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-display)", letterSpacing: -0.2, marginBottom: 18, color }}>
      {children}
    </h3>
  );
}

// ── 外观小节标签（设计稿 1405/1410：12.5px / 500 / fg-1）──────────
function FieldGroupLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 11, color: "var(--fg-1)" }}>{children}</div>;
}

function NotificationPrefRow({ item }: { item: { key: string; label: string; desc: string } }) {
  const { prefs, togglePref } = useNotifications();
  const enabled = prefs[item.key] !== false;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 500 }}>{item.label}</div>
        <div style={{ fontSize: 12, color: "var(--fg-2)" }}>{item.desc}</div>
      </div>
      <button
        onClick={() => togglePref(item.key)}
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          background: enabled ? "var(--accent)" : "var(--bg-4)",
          cursor: "pointer",
          position: "relative",
          border: "none",
          transition: "background 0.2s",
        }}
        aria-pressed={enabled}
      >
        <div style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--btn-fg)",
          position: "absolute",
          top: 2,
          left: enabled ? "auto" : 2,
          right: enabled ? 2 : "auto",
          transition: "left 0.2s, right 0.2s",
        }} />
      </button>
    </div>
  );
}

const TABS = ["profile", "referral", "notifications", "defaults", "security", "appearance", "danger"] as const;

const TAB_ICON: Partial<Record<typeof TABS[number], React.ReactNode>> = {
  referral: <Icons.Sparkles size={13} style={{ color: "var(--alpha)" }} />,
  danger: <Icons.Alert size={13} style={{ color: "var(--down)" }} />,
};

export default function SettingsPage() {
  const { t, lang, setLang } = useLang();
  const { theme, toggleTheme } = useThemeStore();
  const { data: credentials } = useCredentials();
  const { data: robots } = useRobots();
  const deleteCredential = useDeleteCredential();
  const stopRobot = useStopRobot();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const deleteAccount = useDeleteAccount();
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>("profile");

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showStopAllConfirm, setShowStopAllConfirm] = useState(false);
  const [stopAllClosePosition, setStopAllClosePosition] = useState(true);
  const changePassword = useChangePassword();
  const profileInitialized = useRef(false);

  useEffect(() => {
    if (!profile || profileInitialized.current) return;
    profileInitialized.current = true;
    const timer = setTimeout(() => {
      setDisplayName(profile.displayName);
      setEmail(profile.email);
    }, 0);
    return () => clearTimeout(timer);
  }, [profile]);

  const tabLabels: Record<typeof TABS[number], string> = {
    profile: t("settings.profile"),
    referral: t("fees.title"),
    notifications: t("settings.notifications"),
    defaults: t("settings.defaults"),
    security: t("settings.security"),
    appearance: t("settings.appearance"),
    danger: t("settings.danger"),
  };

  const handleSaveProfile = () => {
    updateProfile.mutate(
      { displayName, email },
      {
        onSuccess: () => {
          toast.success(t("common.synced"));
        },
      }
    );
  };

  const handleUpdatePassword = () => {
    if (newPassword.length < 8) {
      toast.error(t("login.password_min"));
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error(t("login.password_mismatch"));
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast.success(t("settings.password_updated"));
          setCurrentPassword("");
          setNewPassword("");
          setConfirmNewPassword("");
        },
      }
    );
  };

  const handleSetLang = (l: Lang) => {
    setLang(l);
    if (profile?.id) {
      updateProfile.mutate({ language: l });
    }
  };

  const handleStopAllBots = () => {
    (robots ?? []).forEach((robot) => {
      if (robot.status === "RUNNING") {
        stopRobot.mutate({ id: robot.id, closePosition: stopAllClosePosition });
      }
    });
    toast.success(t("common.synced"));
    setShowStopAllConfirm(false);
    setStopAllClosePosition(true);
  };

  const handleClearAllCredentials = () => {
    if (credentials) {
      credentials.forEach((cred) => {
        deleteCredential.mutate(cred.id);
      });
    }
    toast.success(t("common.synced"));
  };

  const handleDeleteAccount = () => {
    if (deleteConfirmText !== "DELETE") {
      toast.error(t("settings.delete_wrong_confirm"));
      return;
    }
    deleteAccount.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("common.synced"));
      },
    });
  };

  const initials = avatarInitials(displayName || profile?.displayName || profile?.email || "");

  return (
    <Shell breadcrumb={[t("settings.title")]}>
      <SectionHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className="settings-grid" style={{ alignItems: "start" }}>
        {/* Tab sidebar — 设计稿 1356-1364 */}
        <div className="settings-tabs" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {TABS.map((tab) => {
            const active = activeTab === tab;
            const isDanger = tab === "danger";
            return (
              <button
                key={tab}
                data-testid={`settings-tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{
                  position: "relative",
                  padding: "9px 13px",
                  borderRadius: 8,
                  fontSize: 13,
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-sans)",
                  color: active ? "var(--accent)" : isDanger ? "var(--down)" : "var(--fg-2)",
                  background: active ? "var(--accent-tint)" : "transparent",
                  fontWeight: active ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                {active && (
                  <span style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: "var(--accent)" }} />
                )}
                {TAB_ICON[tab]}
                {tabLabels[tab]}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {activeTab === "profile" && (
            <>
              <Card pad={22} style={{ borderRadius: 14 }}>
                <PanelTitle>{t("settings.profile")}</PanelTitle>
                {/* avatar 行 — 设计稿 1370-1377 */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid var(--border-subtle)" }}>
                  <div style={{ width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-hi) 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, color: "var(--btn-fg)", flexShrink: 0 }}>
                    {initials}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{profile?.displayName || displayName || "—"}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{profile?.email ?? "—"}</div>
                  </div>
                </div>
                <div className="settings-profile-fields" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <Field label={t("settings.display_name")} value={displayName} onChange={setDisplayName} />
                  <Field label={t("settings.email_field")} value={email} type="email" onChange={setEmail} />
                </div>
                <div style={{ marginTop: 20 }}>
                  <Button variant="primary" size="md" onClick={handleSaveProfile} disabled={updateProfile.isPending || profileLoading}>
                    {updateProfile.isPending ? t("common.saving") : t("common.save")}
                  </Button>
                </div>
              </Card>
            </>
          )}

          {activeTab === "appearance" && (
            <Card pad={22} style={{ borderRadius: 14 }}>
              <PanelTitle>{t("settings.appearance")}</PanelTitle>

              {/* 主题卡片选择 — 设计稿 1405-1409 */}
              <FieldGroupLabel>{t("settings.theme")}</FieldGroupLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11, marginBottom: 22 }}>
                {([
                  { value: "dark", label: t("settings.theme_dark"), icon: <Icons.Moon size={15} /> },
                  { value: "light", label: t("settings.theme_light"), icon: <Icons.Sun size={15} /> },
                ] as const).map((opt) => {
                  const selected = theme === opt.value;
                  return (
                    <button
                      key={opt.value}
                      data-testid={`settings-theme-${opt.value}`}
                      onClick={() => { if (!selected) toggleTheme(); }}
                      style={{
                        padding: 14,
                        border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
                        borderRadius: 10,
                        background: selected ? "var(--accent-tint)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                        color: selected ? "var(--fg-0)" : "var(--fg-2)",
                      }}
                    >
                      <span style={{ color: selected ? "var(--accent)" : "currentColor", display: "inline-flex" }}>{opt.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: selected ? 600 : 500 }}>{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 语言列表选择 — 设计稿 1410-1414 */}
              <FieldGroupLabel>{t("settings.language")}</FieldGroupLabel>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {SUPPORTED_LANGS.map((l) => {
                  const selected = lang === l.code;
                  return (
                    <button
                      key={l.code}
                      data-testid={`settings-lang-${l.code}`}
                      onClick={() => handleSetLang(l.code as Lang)}
                      style={{
                        padding: "11px 14px",
                        border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
                        borderRadius: 10,
                        background: selected ? "var(--accent-tint)" : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                        color: selected ? "var(--fg-0)" : "var(--fg-2)",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: selected ? 600 : 400 }}>{l.label}</span>
                      {selected && <Icons.Check size={14} sw={2} style={{ color: "var(--accent)" }} />}
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {activeTab === "security" && (
            <Card pad={22} style={{ borderRadius: 14 }}>
              <PanelTitle>{t("settings.security")}</PanelTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label={t("settings.current_password")} type="password" value={currentPassword} onChange={setCurrentPassword} />
                <Field label={t("settings.new_password")} type="password" value={newPassword} onChange={setNewPassword} />
                <Field label={t("settings.confirm_password")} type="password" value={confirmNewPassword} onChange={setConfirmNewPassword} />
              </div>
              <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
                <Button variant="primary" size="md" onClick={handleUpdatePassword} disabled={changePassword.isPending}>
                  {changePassword.isPending ? t("common.submitting") : t("settings.update_password")}
                </Button>
              </div>
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{t("settings.reset_password_title")}</div>
                <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 8 }}>{t("settings.reset_password_desc")}</div>
                <div style={{ fontSize: 11, color: "var(--fg-3)", fontFamily: "var(--font-mono)", background: "var(--bg-2)", padding: "8px 12px", borderRadius: 6 }}>
                  {t("settings.reset_password_script")}
                </div>
              </div>
            </Card>
          )}

          {activeTab === "danger" && (
            <Card pad={22} style={{ borderRadius: 14, border: "1px solid var(--down-tint)" }}>
              <PanelTitle color="var(--down)">{t("settings.danger")}</PanelTitle>
              <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: -10, marginBottom: 20 }}>{t("settings.danger_desc")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ padding: 16, background: "var(--bg-2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{t("settings.stop_all_bots")}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>{t("settings.stop_all_bots_desc")}</div>
                  </div>
                  <Button danger size="md" icon={<Icons.Stop size={13} />} onClick={() => setShowStopAllConfirm(true)}>{t("settings.stop_all_btn")}</Button>
                </div>
                <div style={{ padding: 16, background: "var(--bg-2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{t("settings.clear_creds")}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>{t("settings.clear_creds_desc")}</div>
                  </div>
                  <Button danger size="md" icon={<Icons.Trash size={13} />} onClick={handleClearAllCredentials}>{t("settings.clear_creds_btn")}</Button>
                </div>
                <div style={{ padding: 16, background: "var(--bg-2)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{t("settings.delete_account")}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>{t("settings.delete_account_desc")}</div>
                  </div>
                  <Button danger size="md" icon={<Icons.Trash size={13} />} onClick={() => setShowDeleteConfirm(true)}>{t("settings.delete_account_btn")}</Button>
                </div>
              </div>
            </Card>
          )}

          {showStopAllConfirm && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => { setShowStopAllConfirm(false); setStopAllClosePosition(true); }}>
              <div style={{ background: "var(--bg-1)", borderRadius: 14, padding: 24, maxWidth: 440, width: "90%", border: "1px solid var(--border-subtle)" }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-display)", marginBottom: 8, color: "var(--down)" }}>{t("settings.stop_all_confirm_title")}</h3>
                <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 16, lineHeight: 1.6 }}>{t("settings.stop_all_confirm_body")}</div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={stopAllClosePosition} onChange={(e) => setStopAllClosePosition(e.target.checked)} />
                  {t("bot.stop_close_position")}
                </label>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <Button variant="ghost" size="md" onClick={() => { setShowStopAllConfirm(false); setStopAllClosePosition(true); }}>{t("common.cancel")}</Button>
                  <Button danger size="md" onClick={handleStopAllBots} disabled={stopRobot.isPending}>{t("common.confirm_stop")}</Button>
                </div>
              </div>
            </div>
          )}

          {showDeleteConfirm && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setShowDeleteConfirm(false)}>
              <div style={{ background: "var(--bg-1)", borderRadius: 14, padding: 24, maxWidth: 420, width: "90%", border: "1px solid var(--border-subtle)" }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: 16, fontWeight: 600, fontFamily: "var(--font-display)", marginBottom: 8, color: "var(--down)" }}>{t("settings.delete_confirm_title")}</h3>
                <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 20 }}>{t("settings.delete_confirm_desc")}</div>
                <div style={{ marginBottom: 20 }}>
                  <Field label={t("settings.delete_confirm_input")} value={deleteConfirmText} onChange={setDeleteConfirmText} />
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <Button variant="ghost" size="md" onClick={() => setShowDeleteConfirm(false)}>{t("common.cancel")}</Button>
                  <Button danger size="md" onClick={handleDeleteAccount} disabled={deleteAccount.isPending}>
                    {deleteAccount.isPending ? t("common.submitting") : t("common.delete")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "notifications" && (
            <Card pad={22} style={{ borderRadius: 14 }}>
              <PanelTitle>{t("settings.notifications")}</PanelTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {[
                  { key: "alert", label: t("noti.pref.alert") || "止损/强平警报", desc: t("noti.pref.alert_desc") || "止损触发或强平时的实时通知" },
                  { key: "alpha", label: t("noti.pref.alpha") || "Alpha 里程碑", desc: t("noti.pref.alpha_desc") || "GTC 捕获或 Alpha 超额达到里程碑时通知" },
                  { key: "info", label: t("noti.pref.info") || "状态变更", desc: t("noti.pref.info_desc") || "机器人状态变更时的通知" },
                  { key: "warn", label: t("noti.pref.warn") || "保证金率警告", desc: t("noti.pref.warn_desc") || "保证金率接近阈值时的警告通知" },
                ].map((item) => (
                  <NotificationPrefRow key={item.key} item={item} />
                ))}
              </div>
            </Card>
          )}

          {activeTab === "defaults" && (
            <Card pad={22} style={{ borderRadius: 14 }}>
              <PanelTitle>{t("settings.defaults")}</PanelTitle>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: "var(--fg-3)", fontSize: 13 }}>
                {t("settings.coming_soon")}
              </div>
            </Card>
          )}

          {/* 邀请与返佣 tab — 金色渐变卡（设计稿 1385-1401），真实累计返佣，无社交承诺 */}
          {activeTab === "referral" && (() => {
            const referralRebate = (robots ?? []).reduce((s, r) => s + estimateRebate(r.exchangeId, r.totalFees || 0), 0);
            return (
              <Card
                pad={22}
                style={{
                  borderRadius: 14,
                  position: "relative",
                  overflow: "hidden",
                  background: "linear-gradient(150deg, var(--alpha-tint) 0%, var(--bg-1) 55%)",
                  border: "1px solid var(--alpha-tint-strong)",
                }}
              >
                <div style={{ position: "absolute", top: -30, right: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, var(--alpha) 0%, transparent 70%)", opacity: 0.13, pointerEvents: "none" }} />
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Icons.Sparkles size={16} style={{ color: "var(--alpha)" }} />
                    <h3 style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-display)", letterSpacing: -0.2 }}>{t("referral.title")}</h3>
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.6, marginBottom: 18 }}>{t("referral.subtitle")}</p>
                  {referralRebate > 0 && (
                    <div style={{ display: "inline-flex", flexDirection: "column", gap: 5, padding: "13px 16px", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 10, marginBottom: 18 }}>
                      <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("fees.kpi_rebate_label")}</div>
                      <div className="num" style={{ fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 600, color: "var(--alpha)" }}>${referralRebate.toFixed(2)}</div>
                    </div>
                  )}
                  <ReferralRegisterCards />
                  <ReferralTips />
                </div>
              </Card>
            );
          })()}
        </div>
      </div>
    </Shell>
  );
}

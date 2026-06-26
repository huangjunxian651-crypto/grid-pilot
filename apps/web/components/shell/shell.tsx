"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icons } from "@/components/ui/icons";
import { Pulse, ExchangeMark } from "@/components/ui/primitives";
import { LogoMark } from "@/components/brand/logo";
import { useLang } from "@/lib/i18n-context";
import { SUPPORTED_LANGS, type Lang } from "@/lib/i18n";
import { useThemeStore, useAccountStore, fmt } from "@/lib/store";
import { useIsMobile, useIsTablet } from "@/hooks/useMediaQuery";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useUpdateProfile } from "@/lib/hooks/useProfile";
import { useAuth, useLogout } from "@/lib/hooks/useAuth";
import { getAccounts } from "@/lib/api";
import { useCredentials } from "@/lib/hooks/useCredentials";
import { aggregateSnapshots } from "@/lib/store";
import { WelcomeRebateModal } from "@/components/referral/welcome-rebate-modal";

export function TickerProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Shell({
  children,
  breadcrumb,
  topbarRight,
}: {
  children: React.ReactNode;
  breadcrumb?: string[];
  topbarRight?: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = getActive(pathname);
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-0)", color: "var(--fg-0)", overflow: "hidden", fontFamily: "var(--font-sans)", fontSize: 13 }}>
      {isMobile && (
        <div
          className={`gp-overlay ${sidebarOpen ? "open" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar
        active={active}
        isMobile={isMobile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Topbar
          breadcrumb={breadcrumb}
          right={topbarRight}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <div style={{ flex: 1, overflow: "auto", padding: isMobile ? "12px 16px" : "20px 28px" }}>
          {children}
        </div>
      </div>
      <WelcomeRebateModal />
    </div>
  );
}

function SidebarAccount() {
  const { t } = useLang();
  const snapshots = useAccountStore((s) => s.snapshots);
  const setSnapshots = useAccountStore((s) => s.setSnapshots);
  const [expanded, setExpanded] = useState(false);
  const { data: creds } = useCredentials();

  useEffect(() => {
    getAccounts()
      .then((snaps) => setSnapshots(snaps))
      .catch(() => {});
  }, [setSnapshots]);

  const agg = aggregateSnapshots(snapshots);
  const credMap = new Map(creds?.map((c) => [c.id, c]) ?? []);

  return (
    <div style={{ padding: 14, borderTop: "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 500, marginBottom: 6 }}>{t("nav.account_equity")}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 500, letterSpacing: -0.4, color: snapshots.length > 0 ? "var(--fg-0)" : "var(--fg-3)" }}>
        {snapshots.length > 0 ? fmt.usd(agg.totalEquity) : "—"}
      </div>
      <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>
        {snapshots.length > 0 ? `${fmt.usd(agg.availableUsdt)} USDT ${t("shell.available")}` : t("shell.connect_exchange")}
      </div>

      {snapshots.length > 0 && (
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{ marginTop: 8, padding: "4px 0", fontSize: 10.5, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, width: "100%" }}
        >
          <span>{expanded ? "▲" : "▼"}</span>
          <span>{expanded ? "收起" : "展开"}</span>
        </button>
      )}

      {expanded && snapshots.map((snap) => {
        const cred = credMap.get(snap.credentialId);
        const exchangeId = cred?.exchangeId ?? "binance";
        return (
          <div key={snap.credentialId} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 11 }}>
            <ExchangeMark exchange={exchangeId as "binance" | "gateio" | "okx"} />
            <span style={{ color: "var(--fg-2)", flex: 1 }}>{cred?.label ?? fmt.exchangeName(exchangeId)}</span>
            <span className="num" style={{ color: "var(--fg-0)" }}>{fmt.usd(snap.totalEquity)}</span>
          </div>
        );
      })}
    </div>
  );
}

function getActive(pathname: string): string {
  if (pathname === "/" || pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/robots")) return "robots";
  if (pathname.startsWith("/history")) return "history";
  if (pathname.startsWith("/ai")) return "ai";
  if (pathname.startsWith("/keys")) return "keys";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/learn/fees")) return "fees";
  if (pathname.startsWith("/learn/docs")) return "docs";
  return "dashboard";
}

function getInitials(name: string, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  }
  return (email[0] || "?").toUpperCase();
}

function Sidebar({ active, isMobile, open, onClose }: { active: string; isMobile?: boolean; open?: boolean; onClose?: () => void }) {
  const { t } = useLang();
  const isTablet = useIsTablet();
  const iconOnly = isTablet && !isMobile;
  const { unreadCount } = useNotifications();

  const items = [
    { id: "dashboard", label: t("nav.dashboard"), icon: <Icons.Dashboard size={15} />, href: "/dashboard" },
    { id: "robots", label: t("nav.robots"), icon: <Icons.Bot size={15} />, href: "/robots" },
    { id: "history", label: t("nav.history"), icon: <Icons.History size={15} />, href: "/history" },
    { id: "ai", label: t("nav.ai"), icon: <Icons.Sparkles size={15} />, href: "/ai" },
    { id: "keys", label: t("nav.keys"), icon: <Icons.Key size={15} />, href: "/keys" },
    { id: "notifications", label: t("nav.notifications"), icon: <Icons.Bell size={15} />, href: "/notifications", badge: unreadCount > 0 ? String(unreadCount) : undefined },
    { id: "settings", label: t("nav.settings"), icon: <Icons.Settings size={15} />, href: "/settings" },
  ];

  return (
    <aside
      className={isMobile ? `gp-sidebar ${open ? "open" : ""}` : ""}
      style={{
        width: iconOnly ? 64 : 236,
        background: "var(--bg-1)",
        borderRight: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: iconOnly ? 0 : 8, padding: iconOnly ? "16px 10px" : "16px 18px", borderBottom: "1px solid var(--border-subtle)", justifyContent: iconOnly ? "center" : "flex-start" }}>
        <LogoMark size={32} />
        {!iconOnly && (
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: -0.4, fontFamily: "var(--font-display)" }}>GridPilot</span>
            <span className="num" style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--font-mono)", letterSpacing: 0.3, marginTop: 2 }}>PERP · v0.5.0</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ padding: iconOnly ? "10px 6px" : 10, display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
        {!iconOnly && (
          <div style={{ fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 500, padding: "8px 10px 6px" }}>{t("nav.workspace")}</div>
        )}
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => { if (isMobile && onClose) onClose(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: iconOnly ? 0 : 10,
                padding: iconOnly ? "10px 6px" : "7px 10px",
                borderRadius: 6,
                fontSize: 13,
                color: isActive ? "var(--fg-0)" : "var(--fg-1)",
                background: isActive ? "var(--bg-3)" : "transparent",
                fontWeight: isActive ? 500 : 400,
                textDecoration: "none",
                justifyContent: iconOnly ? "center" : "flex-start",
                position: "relative",
              }}
            >
              {isActive && (
                <span data-testid="nav-active-indicator" style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 2.5, borderRadius: 2, background: "var(--accent)" }} />
              )}
              <span style={{ color: isActive ? "var(--accent)" : "var(--fg-2)" }}>{item.icon}</span>
              {!iconOnly && <span style={{ flex: 1 }}>{item.label}</span>}
              {!iconOnly && item.badge && (
                <span style={{ fontSize: 10, padding: "0 5px", background: item.id === "notifications" ? "var(--alpha)" : "var(--bg-4)", color: item.id === "notifications" ? "var(--btn-fg)" : "var(--fg-1)", borderRadius: 4, fontFamily: "var(--font-mono)" }}>
                  {item.badge}
                </span>
              )}
              {iconOnly && item.badge && (
                <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: item.id === "notifications" ? "var(--alpha)" : "var(--accent)", border: "2px solid var(--bg-1)" }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Help link */}
      {!iconOnly && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--border-subtle)" }}>
          <Link
            href="/learn/fees"
            style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: active === "fees" ? "var(--accent)" : "var(--fg-2)", textDecoration: "none", marginBottom: 9 }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.2" /><path d="M6.3 6.2a1.7 1.7 0 0 1 3.3.5c0 1.2-1.6 1.5-1.6 2.3M8 11.4h.01" /></svg>
            {t("learn.fees.nav")}
          </Link>
          <Link
            href="/learn/docs"
            style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: active === "docs" ? "var(--accent)" : "var(--fg-2)", textDecoration: "none" }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2l5.5 2v3.2c0 3.4-2.3 6-5.5 6.8C4.8 13.2 2.5 10.6 2.5 7.2V4z" /></svg>
            {t("docs.nav")}
          </Link>
        </div>
      )}

      {!iconOnly && <SidebarAccount />}
    </aside>
  );
}

function Topbar({ breadcrumb, right, isMobile, onMenuClick }: { breadcrumb?: string[]; right?: React.ReactNode; isMobile?: boolean; onMenuClick?: () => void }) {
  const { lang, setLang, t } = useLang();
  const { theme, toggleTheme } = useThemeStore();
  const updateProfile = useUpdateProfile();
  const { data: authUser } = useAuth();
  const logout = useLogout();
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const currentLangLabel = SUPPORTED_LANGS.find((l) => l.code === lang)?.label ?? lang;
  const { unreadCount } = useNotifications();

  const initials = getInitials(authUser?.displayName ?? "", authUser?.email ?? "");

  return (
    <header style={{ height: 52, padding: isMobile ? "0 12px" : "0 20px", display: "flex", alignItems: "center", gap: 14, background: "var(--bg-1)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
      {/* Mobile hamburger */}
      {isMobile && (
        <button
          onClick={onMenuClick}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 6, color: "var(--fg-1)", background: "var(--bg-2)", cursor: "pointer" }}
        >
          <Icons.Menu size={18} />
        </button>
      )}

      {/* Breadcrumb */}
      {!isMobile && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          {(breadcrumb ?? [t("nav.dashboard")]).map((b, i, arr) => (
            <React.Fragment key={i}>
              <span style={{ color: i === arr.length - 1 ? "var(--fg-0)" : "var(--fg-2)", fontWeight: i === arr.length - 1 ? 500 : 400 }}>{b}</span>
              {i < arr.length - 1 && <Icons.ChevronRight size={11} style={{ color: "var(--fg-3)" }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      {right}

      {/* WS status */}
      {!isMobile && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-2)" }}>
          <Pulse size={6} /> {t("top.channels_live")}
        </span>
      )}

      {/* Lang toggle */}
      <div
        style={{ position: "relative" }}
        tabIndex={-1}
        onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setLangMenuOpen(false); }}
      >
        <button
          onClick={() => setLangMenuOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 10px", height: 30, background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 6, fontSize: 12, fontWeight: 500, color: "var(--fg-1)", cursor: "pointer" }}
        >
          <Icons.Globe size={13} style={{ color: "var(--fg-2)" }} />
          <span className="gp-hide-mobile">{currentLangLabel}</span>
          <Icons.ChevronDown size={10} style={{ color: "var(--fg-3)" }} />
        </button>
        {langMenuOpen && (
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 4, zIndex: 100, minWidth: 148, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
            {SUPPORTED_LANGS.map((l) => (
              <button
                key={l.code}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setLang(l.code as Lang);
                  if (authUser?.id) {
                    updateProfile.mutate({ language: l.code });
                  }
                  setLangMenuOpen(false);
                }}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 5, fontSize: 12, color: lang === l.code ? "var(--fg-0)" : "var(--fg-1)", background: lang === l.code ? "var(--bg-3)" : "transparent", fontWeight: lang === l.code ? 500 : 400 }}
              >
                <span>{l.label}</span>
                {lang === l.code && <Icons.Check size={12} style={{ color: "var(--accent)" }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Notifications */}
      <Link href="/notifications" style={{ width: 30, height: 30, borderRadius: 6, color: "var(--fg-1)", position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icons.Bell size={15} />
        {unreadCount > 0 && <span style={{ position: "absolute", top: 6, right: 7, width: 6, height: 6, borderRadius: "50%", background: "var(--alpha)" }} />}
      </Link>

      {/* Theme toggle */}
      <button onClick={toggleTheme} style={{ width: 30, height: 30, borderRadius: 6, color: "var(--fg-1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {theme === "dark" ? <Icons.Moon size={15} /> : <Icons.Sun size={15} />}
      </button>

      {/* Avatar + User menu */}
      {!isMobile && (
        <div
          style={{ position: "relative" }}
          tabIndex={-1}
          onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setUserMenuOpen(false); }}
        >
          <button
            onClick={() => setUserMenuOpen((o) => !o)}
            style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, var(--accent) 0%, var(--accent-hi) 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, fontFamily: "var(--font-display)", color: "var(--btn-fg)", cursor: "pointer", border: "none", padding: 0 }}
          >
            {initials}
          </button>
          {userMenuOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 4, zIndex: 100, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
              {authUser?.email && (
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-subtle)", fontSize: 12, color: "var(--fg-2)" }}>
                  {authUser.email}
                </div>
              )}
              <Link
                href="/settings"
                onClick={() => setUserMenuOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 5, fontSize: 12, color: "var(--fg-1)", textDecoration: "none", width: "100%", boxSizing: "border-box" }}
              >
                <Icons.Settings size={13} style={{ color: "var(--fg-2)" }} />
                {t("top.user_menu.settings")}
              </Link>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setUserMenuOpen(false); logout.mutate(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 5, fontSize: 12, color: "var(--fg-1)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left" }}
              >
                <Icons.X size={13} style={{ color: "var(--fg-2)" }} />
                {t("top.user_menu.logout")}
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

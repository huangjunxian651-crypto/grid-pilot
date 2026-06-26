"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/lib/i18n-context";
import { Icons } from "@/components/ui/icons";
import { Field, Button, ExchangeMark } from "@/components/ui/primitives";
import { LogoMark } from "@/components/brand/logo";
import { useThemeStore } from "@/lib/store";
import { useAuth, useLogin, useRegister } from "@/lib/hooks/useAuth";
import { toast } from "sonner";

type AuthMode = "login" | "register" | "forgot";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function LoginPage() {
  const { t, lang, setLang } = useLang();
  const router = useRouter();
  const { data: authUser, isLoading: authLoading } = useAuth();
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const { theme, toggleTheme } = useThemeStore();

  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (authUser) {
      router.push("/dashboard");
    }
  }, [authUser, router]);

  const handleSetMode = (m: AuthMode) => {
    setMode(m);
    setError(null);
  };
  const handleSetEmail = (v: string) => {
    setEmail(v);
    setError(null);
  };
  const handleSetPassword = (v: string) => {
    setPassword(v);
    setError(null);
  };
  const handleSetConfirmPassword = (v: string) => {
    setConfirmPassword(v);
    setError(null);
  };

  const validateLogin = (): boolean => {
    if (!email.trim()) {
      setError(t("login.invalid_email"));
      return false;
    }
    if (!isValidEmail(email)) {
      setError(t("login.invalid_email"));
      return false;
    }
    if (!password) {
      setError(t("login.password"));
      return false;
    }
    return true;
  };

  const validateRegister = (): boolean => {
    if (!email.trim() || !isValidEmail(email)) {
      setError(t("login.invalid_email"));
      return false;
    }
    if (!password) {
      setError(t("login.password"));
      return false;
    }
    if (password.length < 8) {
      setError(t("login.password_min"));
      return false;
    }
    if (password !== confirmPassword) {
      setError(t("login.password_mismatch"));
      return false;
    }
    return true;
  };

  const getErrorText = (err: unknown): string => {
    const status = (err as Error & { status?: number })?.status;
    const msg = err instanceof Error ? err.message : "";

    if (status === 401 || msg.includes("Invalid credentials") || msg.includes("Unauthorized")) {
      return t("login.error_invalid_credentials");
    }
    if (status && status >= 500) {
      return t("login.error_server");
    }
    if (msg.includes("already exists") || msg.includes("Forbidden")) {
      return t("login.error_user_exists");
    }
    if (!status) {
      return t("login.error_network");
    }
    return msg || t("login.error_failed");
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateLogin()) return;

    try {
      await loginMutation.mutateAsync({ email: email.trim(), password });
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(getErrorText(err));
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validateRegister()) return;

    try {
      await registerMutation.mutateAsync({ email: email.trim(), password, language: lang });
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(getErrorText(err));
    }
  };

  const isSubmitting = loginMutation.isPending || registerMutation.isPending;

  // Show loading spinner while checking auth state
  if (authLoading) {
    return (
      <div style={{ width: "100vw", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-0)", color: "var(--fg-0)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--fg-2)" }}>
          <span style={{ display: "inline-block", width: 18, height: 18, border: "2px solid var(--fg-3)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  // If authenticated, the useEffect will redirect; show nothing meanwhile
  if (authUser) {
    return null;
  }

  const isLogin = mode === "login";
  const isRegister = mode === "register";
  const isForgot = mode === "forgot";

  const containerStyle: React.CSSProperties = {
    width: "100vw", height: "100vh", display: "flex",
    // @ts-expect-error CSS custom-property fallback is valid at runtime but
    // stricter than React.CSSProperties allows.
    flexDirection: "var(--login-flex-dir, row)",
    background: "var(--bg-0)", color: "var(--fg-0)", overflow: "hidden",
  };

  const features = [
    { icon: <Icons.TrendingUp size={15} />, text: t("login.feature_track") },
    { icon: <Icons.Dashboard size={15} />, text: t("login.feature_pricing") },
    { icon: <Icons.Sparkles size={15} />, gold: true, text: t("login.feature_alpha") },
  ];

  return (
    <div style={containerStyle}>
      {/* Left: branding */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "linear-gradient(160deg, var(--bg-1) 0%, var(--bg-0) 70%)", display: "flex", flexDirection: "column", padding: "var(--login-brand-pad, 56px)" }}>
        {/* Grid pattern */}
        <svg style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none" }} width="100%" height="100%" preserveAspectRatio="none">
          <defs>
            <pattern id="login-grid" width="44" height="44" patternUnits="userSpaceOnUse">
              <path d="M 44 0 L 0 0 0 44" fill="none" style={{ stroke: "var(--accent)" }} strokeOpacity="0.06" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#login-grid)" />
        </svg>
        {/* 青色光晕 */}
        <div style={{ position: "absolute", top: -80, right: -60, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)", opacity: 0.1, pointerEvents: "none" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 11, position: "relative" }}>
          <LogoMark size={40} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600, letterSpacing: -0.4 }}>GridPilot</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-3)", marginTop: 3, letterSpacing: 0.4 }}>PERP · 动态网格交易平台</span>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 420, position: "relative" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--login-title-size, 40px)", fontWeight: 600, letterSpacing: -1, lineHeight: 1.2, marginBottom: 14 }}>
            {t("login.tagline")}
            <br />
            <span style={{ color: "var(--alpha)" }}>{t("login.tagline_2")}</span>
          </h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {features.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: f.gold ? "var(--alpha-tint)" : "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: f.gold ? "var(--alpha)" : "var(--accent)" }}>
                  {f.icon}
                </div>
                <span style={{ fontSize: 13, color: "var(--fg-1)" }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ fontSize: 11.5, color: "var(--fg-3)", position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--up)" }} />
            {t("login.channels_online")}
          </span>
          <span>·</span>
          <span style={{ fontFamily: "var(--font-mono)" }}>v0.5.0</span>
        </div>
      </div>

      {/* Right: auth form */}
      <div style={{ width: "var(--login-form-width, 480px)", padding: "var(--login-form-pad, 56px 56px)", display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border-subtle)" }}>
        {/* top-right controls */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 24 }}>
          <button
            data-testid="login-lang-toggle"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 12px", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 8, fontSize: 12.5, fontWeight: 500, color: "var(--fg-1)", cursor: "pointer" }}
          >
            <Icons.Globe size={13} style={{ color: "var(--fg-2)" }} />
            {lang === "zh" ? "中文" : "EN"}
          </button>
          <button
            data-testid="login-theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Light" : "Dark"}
            style={{ width: 34, height: 34, borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-1)", cursor: "pointer" }}
          >
            {theme === "dark" ? <Icons.Moon size={15} /> : <Icons.Sun size={16} />}
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          {isForgot ? (
            <>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 600, letterSpacing: -0.5, marginBottom: 6 }}>{t("login.forgot_title")}</h2>
              <p style={{ fontSize: 13.5, color: "var(--fg-2)", marginBottom: 24 }}>{t("login.forgot_sub")}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label={t("login.email")} value={email} onChange={handleSetEmail} placeholder={t("login.email_placeholder")} />
                <Button variant="primary" size="lg" full onClick={() => toast.info(t("login.contact_admin"))}>{t("login.forgot_btn")}</Button>
                <div style={{ padding: "12px 14px", background: "var(--bg-2)", border: "1px solid var(--border-subtle)", borderRadius: 10, display: "flex", gap: 9, fontSize: 12, color: "var(--fg-2)", lineHeight: 1.55 }}>
                  <Icons.Info size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--accent)" }} />
                  {t("login.forgot_hint")}
                </div>
                <div style={{ textAlign: "center", marginTop: 6 }}>
                  <button type="button" onClick={() => handleSetMode("login")} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Icons.ChevronRight size={12} style={{ transform: "rotate(180deg)" }} /> {t("login.back_to_login")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 25, fontWeight: 600, letterSpacing: -0.5, marginBottom: 6 }}>
                {isLogin ? t("login.welcome_back") : t("login.create_account")}
              </h2>
              <p style={{ fontSize: 13.5, color: "var(--fg-2)", marginBottom: 24 }}>
                {isLogin ? t("login.signin_sub") : t("login.register_sub")}
              </p>

              <form onSubmit={isLogin ? handleLoginSubmit : handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <Field label={t("login.email")} value={email} onChange={handleSetEmail} placeholder={t("login.email_placeholder")} />
                <Field label={t("login.password")} type="password" value={password} onChange={handleSetPassword} placeholder="" />

                {isRegister && (
                  <Field label={t("login.confirm_password")} type="password" value={confirmPassword} onChange={handleSetConfirmPassword} placeholder="" />
                )}

                {isLogin && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-2)", cursor: "pointer" }}>
                      <input type="checkbox" defaultChecked style={{ accentColor: "var(--accent)" }} /> {t("login.remember")}
                    </label>
                    <button type="button" onClick={() => handleSetMode("forgot")} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}>
                      {t("login.forgot_link")}
                    </button>
                  </div>
                )}

                {error && (
                  <div style={{ padding: "8px 12px", background: "var(--down-tint)", border: "1px solid var(--down)", borderRadius: 6, color: "var(--down)", fontSize: 12 }}>
                    {error}
                  </div>
                )}

                <Button variant="primary" size="lg" full disabled={isSubmitting}>
                  {isSubmitting ? t("common.submitting") : isLogin ? t("login.signin") : t("login.register")}
                </Button>
              </form>

              <div style={{ marginTop: 24, fontSize: 12, color: "var(--fg-2)", textAlign: "center" }}>
                {isLogin ? (
                  <>
                    {t("login.first_time")}{" "}
                    <button type="button" onClick={() => handleSetMode("register")} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}>
                      {t("login.create_ws")}
                    </button>
                  </>
                ) : (
                  <>
                    {t("login.have_account")}{" "}
                    <button type="button" onClick={() => handleSetMode("login")} style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0 }}>
                      {t("login.signin_link")}
                    </button>
                  </>
                )}
              </div>

              {/* 三所静态信任条 */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{t("login.trust_exchanges")}</span>
                <div style={{ display: "flex", gap: 10 }}>
                  <ExchangeMark exchange="binance" size={22} />
                  <ExchangeMark exchange="gateio" size={22} />
                  <ExchangeMark exchange="okx" size={22} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

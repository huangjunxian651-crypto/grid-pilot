"use client";

import React from "react";
import { Shell } from "@/components/shell/shell";
import { useLang } from "@/lib/i18n-context";
import { Card, Button, SectionHeader, Badge, ExchangeMark, Pulse, Field } from "@/components/ui/primitives";
import { Icons } from "@/components/ui/icons";
import { fmt } from "@/lib/store";
import { useCredentials, useCreateCredential, useUpdateCredential, useDeleteCredential } from "@/lib/hooks/useCredentials";
import { type ExchangeId } from "@gridpilot/shared-types";
import { credentialApi } from "@/lib/api";
import { ReferralCta } from "@/components/referral/referral-cta";
import { ReferralRegisterPrompt } from "@/components/referral/referral-register-prompt";

const EXCHANGES = [
  { ex: "binance", name: "Binance USD-M", sdk: "derivatives-trading · v1", latency: "38ms", iconBg: "#f0b90b1a" },
  { ex: "gateio", name: "Gate.io USDT Perp", sdk: "gate-api v7.2.78", latency: "52ms", iconBg: "var(--bg-3)" },
  { ex: "okx", name: "OKX SWAP", sdk: "v5 REST + WS", latency: "64ms", iconBg: "var(--bg-3)" },
];

function ReferralAccountFork({ exchangeId }: { exchangeId: ExchangeId }) {
  const { t } = useLang();
  const [hasExchangeAccount, setHasExchangeAccount] = React.useState(false);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>{t("referral.have_account_q")}</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
          <input type="radio" name="hasacct" checked={!hasExchangeAccount} onChange={() => setHasExchangeAccount(false)} />
          {t("referral.have_account_no")}
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}>
          <input type="radio" name="hasacct" checked={hasExchangeAccount} onChange={() => setHasExchangeAccount(true)} />
          {t("referral.have_account_yes")}
        </label>
      </div>
      {!hasExchangeAccount && <ReferralRegisterPrompt exchangeId={exchangeId} />}
    </div>
  );
}

export default function ExchangeKeysPage() {
  const { t, lang } = useLang();
  const { data: credentials, isLoading } = useCredentials();
  const createMutation = useCreateCredential();
  const updateMutation = useUpdateCredential();
  const deleteMutation = useDeleteCredential();

  const [showForm, setShowForm] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [maskedValues, setMaskedValues] = React.useState<{ apiKey: string; apiSecret: string }>({ apiKey: "", apiSecret: "" });
  const [activeOnly, setActiveOnly] = React.useState(false);
  const [form, setForm] = React.useState<{
    exchangeId: ExchangeId;
    accountId: string;
    label: string;
    apiKey: string;
    apiSecret: string;
    passphrase: string;
  }>({
    exchangeId: "binance",
    accountId: "",
    label: "",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
  });

  const creds = credentials ?? [];
  const displayedCreds = activeOnly ? creds.filter((c) => c.isActive) : creds;

  const handleSave = () => {
    if (editingId) {
      const patch: Record<string, any> = {
        exchangeId: form.exchangeId,
        accountId: form.accountId,
        label: form.label,
      };
      if (form.apiKey && form.apiKey !== maskedValues.apiKey) {
        patch.apiKey = form.apiKey;
      }
      if (form.apiSecret && form.apiSecret !== maskedValues.apiSecret) {
        patch.apiSecret = form.apiSecret;
      }
      if (form.passphrase) {
        patch.passphrase = form.passphrase;
      }
      updateMutation.mutate(
        { id: editingId, data: patch },
        {
          onSuccess: () => {
            setShowForm(false);
            setEditingId(null);
            setForm({ exchangeId: "binance", accountId: "", label: "", apiKey: "", apiSecret: "", passphrase: "" });
            setMaskedValues({ apiKey: "", apiSecret: "" });
          },
        }
      );
    } else {
      createMutation.mutate(
        {
          exchangeId: form.exchangeId,
          accountId: form.accountId,
          label: form.label,
          apiKey: form.apiKey,
          apiSecret: form.apiSecret,
          passphrase: form.passphrase || undefined,
        },
        {
          onSuccess: () => {
            setShowForm(false);
            setForm({ exchangeId: "binance", accountId: "", label: "", apiKey: "", apiSecret: "", passphrase: "" });
          },
        }
      );
    }
  };

  return (
    <Shell
      breadcrumb={[t("nav.settings"), t("nav.keys")]}
      topbarRight={
        <Button
          variant="primary"
          size="md"
          icon={<Icons.Plus size={13} />}
          onClick={() => setShowForm(true)}
        >
          {t("keys.add_credential")}
        </Button>
      }
    >
      <SectionHeader title={t("keys.title")} subtitle={t("keys.subtitle")} />

      {/* 高意图返佣引导 banner（设计稿 1219-1231，"连接前先开通返佣"）。位置置顶、长期可见，不可删。 */}
      <div style={{ marginBottom: 20 }}>
        <ReferralRegisterPrompt />
      </div>

      {showForm && (
        <Card pad={16} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{editingId ? t("keys.edit_credential") : t("keys.add_credential")}</div>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm({ exchangeId: "binance", accountId: "", label: "", apiKey: "", apiSecret: "", passphrase: "" }); setMaskedValues({ apiKey: "", apiSecret: "" }); }}
              style={{ width: 28, height: 28, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--fg-2)", background: "transparent", border: "none", cursor: "pointer" }}
            >
              <Icons.X size={14} />
            </button>
          </div>
          <div className="gp-grid-3 gp-grid-1-sm" style={{ gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 5, fontWeight: 500 }}>{t("keys.exchange")}</div>
              <div style={{ display: "flex", alignItems: "center", height: 34, background: "var(--bg-2)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "0 10px" }}>
                <select
                  value={form.exchangeId}
                  onChange={(e) => setForm((f) => ({ ...f, exchangeId: e.target.value as ExchangeId }))}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--fg-0)", fontFamily: "var(--font-mono)" }}
                >
                  {EXCHANGES.map((e) => (
                    <option key={e.ex} value={e.ex}>{e.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <Field label={t("keys.account_id")} value={form.accountId} onChange={(v) => setForm((f) => ({ ...f, accountId: v }))} />
            <Field label={t("keys.label")} value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} />
          </div>
          <div className="gp-grid-2 gp-grid-1-sm" style={{ gap: 12, marginBottom: 12 }}>
            <Field label="API Key" value={form.apiKey} placeholder={editingId ? maskedValues.apiKey : undefined} onChange={(v) => setForm((f) => ({ ...f, apiKey: v }))} />
            <Field label="API Secret" type="password" value={form.apiSecret} placeholder={editingId ? maskedValues.apiSecret : undefined} onChange={(v) => setForm((f) => ({ ...f, apiSecret: v }))} />
          </div>
          <div className="gp-grid-3 gp-grid-1-sm" style={{ gap: 12, marginBottom: 16 }}>
            <Field label={t("keys.passphrase")} placeholder={t("common.optional")} value={form.passphrase} onChange={(v) => setForm((f) => ({ ...f, passphrase: v }))} />
          </div>
          {editingId == null && <ReferralAccountFork exchangeId={form.exchangeId} />}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="ghost" size="md" onClick={() => { setShowForm(false); setEditingId(null); setForm({ exchangeId: "binance", accountId: "", label: "", apiKey: "", apiSecret: "", passphrase: "" }); setMaskedValues({ apiKey: "", apiSecret: "" }); }}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              size="md"
              disabled={!form.accountId || !form.label || (!editingId && (!form.apiKey || !form.apiSecret)) || createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
            >
              {createMutation.isPending || updateMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </Card>
      )}

      <div className="gp-grid-3 gp-grid-2-md gp-grid-1-sm" style={{ gap: 13, marginBottom: 20 }}>
        {EXCHANGES.map((e) => {
          const connected = creds.filter((c) => c.exchangeId === e.ex && c.isActive).length;
          return (
            <Card key={e.ex} pad={0} style={{ borderRadius: 13, padding: "15px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: e.iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ExchangeMark exchange={e.ex} size={26} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{e.name}</div>
                  <div style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>{e.sdk}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: connected > 0 ? "var(--up)" : "var(--fg-3)" }}>
                  {connected > 0 ? <Pulse size={5} color="var(--up)" /> : <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--fg-3)" }} />}
                  {connected > 0 ? `${t("keys.connected")} · ${e.latency}` : t("keys.not_connected")}
                </span>
                <span style={{ fontSize: 11, color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>
                  {connected} {t("keys.cred_unit")}
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      <Card pad={0} style={{ borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "13px 17px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10.5, color: "var(--fg-2)", textTransform: "uppercase", letterSpacing: 0.9, fontWeight: 600 }}>{t("keys.section_creds")}</div>
          <Button
            variant={activeOnly ? "primary" : "ghost"}
            size="sm"
            icon={<Icons.Filter size={11} />}
            onClick={() => setActiveOnly((v) => !v)}
          >
            {t("keys.active_only")}
          </Button>
        </div>
        <div className="gp-table-scroll">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--fg-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6 }}>
              {[t("keys.label"), t("keys.exchange"), t("keys.account_id"), t("keys.added_at"), ""].map((h, i) => (
                <th key={i} style={{ padding: i === 0 ? "10px 17px" : i === 4 ? "10px 17px" : "10px 8px", textAlign: i === 4 ? "right" : "left", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} style={{ padding: "24px 16px", textAlign: "center", color: "var(--fg-3)" }}>
                  {t("common.loading")}
                </td>
              </tr>
            ) : creds.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "24px 16px", textAlign: "center", color: "var(--fg-3)" }}>
                  {t("keys.no_credentials")}
                  <div style={{ padding: "12px 16px" }}>
                    <ReferralRegisterPrompt />
                  </div>
                </td>
              </tr>
            ) : (
              displayedCreds.map((c, idx) => (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border-subtle)", opacity: c.isActive ? 1 : 0.55 }}>
                  <td style={{ padding: "12px 17px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontWeight: 500 }}>{c.label}</span>
                      {idx === 0 && c.isActive && <Badge tone="accent">{t("keys.default")}</Badge>}
                      {!c.isActive && <Badge tone="neutral">{t("common.disabled")}</Badge>}
                      {c.passphrase && <Badge tone="neutral">{t("keys.passphrase_badge")}</Badge>}
                    </div>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <ExchangeMark exchange={c.exchangeId} size={16} /> {fmt.exchangeName(c.exchangeId)}
                    </div>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <span className="num" style={{ color: "var(--fg-1)" }}>{c.accountId}</span>
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <span style={{ color: "var(--fg-2)", fontSize: 11 }} className="num" suppressHydrationWarning>
                      {fmt.ago(new Date(c.createdAt).getTime(), lang)}
                    </span>
                  </td>
                  <td style={{ padding: "12px 17px" }}>
                    <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                      <button
                        onClick={async () => {
                          setEditingId(c.id);
                          setForm({
                            exchangeId: c.exchangeId,
                            accountId: c.accountId,
                            label: c.label,
                            apiKey: "",
                            apiSecret: "",
                            passphrase: c.passphrase || "",
                          });
                          try {
                            const detail = await credentialApi.get(c.id);
                            setMaskedValues({ apiKey: detail.apiKeyMasked ?? "", apiSecret: detail.apiSecretMasked ?? "" });
                          } catch {
                            setMaskedValues({ apiKey: "", apiSecret: "" });
                          }
                          setShowForm(true);
                        }}
                        style={{ width: 28, height: 28, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--fg-2)", background: "transparent", border: "none", cursor: "pointer" }}
                      >
                        <Icons.Edit size={13} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(t("keys.confirm_delete"))) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        style={{ width: 28, height: 28, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--fg-2)", background: "transparent", border: "none", cursor: "pointer", opacity: deleteMutation.isPending ? 0.4 : 1 }}
                      >
                        <Icons.Trash size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </Card>

      <div style={{ padding: "15px 16px", background: "var(--bg-1)", border: "1px solid var(--border-subtle)", borderRadius: 12, fontSize: 12, color: "var(--fg-1)", lineHeight: 1.7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7, color: "var(--maker)", fontWeight: 600 }}>
          <Icons.Info size={14} /> {t("keys.security_rec")}
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, listStyle: "disc", color: "var(--fg-2)" }}>
          <li>{t("keys.rec_1")}</li>
          <li>{t("keys.rec_2")}</li>
          <li>{t("keys.rec_3")}</li>
        </ul>
      </div>
    </Shell>
  );
}

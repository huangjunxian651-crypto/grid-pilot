"use client";

import React, { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n-context";
import { Button, Field } from "@/components/ui/primitives";
import { useAiSettings, useUpdateAiSettings } from "@/lib/hooks/useAi";
import { toast } from "sonner";

/**
 * 大模型（LLM）配置表单——设置页与 AI 箱体推荐页共用单一来源（DRY）。
 * 自包含 state + 读取/保存 hooks；保存成功后回调 onSaved（供 /ai 重新拉取/重试生成）。
 */
export function AiSettingsForm({ onSaved }: { onSaved?: () => void }) {
  const { t } = useLang();
  const { data: aiSettings } = useAiSettings();
  const updateAi = useUpdateAiSettings();

  const [aiProvider, setAiProvider] = useState("anthropic");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-opus-4-8");
  const [anthropicBaseUrl, setAnthropicBaseUrl] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const initialized = useRef(false);

  useEffect(() => {
    if (!aiSettings || initialized.current) return;
    initialized.current = true;
    setAiProvider(aiSettings.provider);
    setAnthropicModel(aiSettings.anthropicModel);
    setAnthropicBaseUrl(aiSettings.anthropicBaseUrl ?? "");
    setOpenaiModel(aiSettings.openaiModel ?? "");
    setOpenaiBaseUrl(aiSettings.openaiBaseUrl ?? "");
  }, [aiSettings]);

  const saveAi = () => updateAi.mutate(
    { provider: aiProvider, anthropicApiKey: anthropicKey || undefined, anthropicModel, anthropicBaseUrl, openaiApiKey: openaiKey || undefined, openaiModel, openaiBaseUrl },
    { onSuccess: () => { toast.success(t("settings.ai_saved")); setAnthropicKey(""); setOpenaiKey(""); onSaved?.(); } },
  );

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 500, marginBottom: 6, color: "var(--fg-2)" }}>
            {t("settings.ai_provider")}
          </label>
          <select
            data-testid="ai-provider-select"
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--bg-2)", color: "var(--fg-0)", fontSize: 13 }}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>
        {aiProvider === "anthropic" && (
          <>
            <Field
              type="password"
              label={t("settings.ai_anthropic_key")}
              value={anthropicKey}
              onChange={setAnthropicKey}
              placeholder={aiSettings?.hasAnthropicKey ? t("settings.ai_key_configured") : t("settings.ai_key_empty")}
            />
            <Field
              label={t("settings.ai_anthropic_model")}
              value={anthropicModel}
              onChange={setAnthropicModel}
            />
            <Field
              label={t("settings.ai_anthropic_base_url")}
              value={anthropicBaseUrl}
              onChange={setAnthropicBaseUrl}
            />
          </>
        )}
        {aiProvider === "openai" && (
          <>
            <Field
              type="password"
              label={t("settings.ai_openai_key")}
              value={openaiKey}
              onChange={setOpenaiKey}
              placeholder={aiSettings?.hasOpenaiKey ? t("settings.ai_key_configured") : t("settings.ai_key_empty")}
            />
            <Field
              label={t("settings.ai_openai_model")}
              value={openaiModel}
              onChange={setOpenaiModel}
            />
            <Field
              label={t("settings.ai_openai_base_url")}
              value={openaiBaseUrl}
              onChange={setOpenaiBaseUrl}
            />
          </>
        )}
        <div style={{ fontSize: 12, color: "var(--fg-2)", padding: "10px 12px", background: "var(--bg-2)", borderRadius: 6, lineHeight: 1.6 }}>
          {t("settings.ai_coding_warning")}
        </div>
      </div>
      <div style={{ marginTop: 20 }}>
        <Button
          data-testid="ai-settings-save"
          variant="primary"
          size="md"
          onClick={saveAi}
          disabled={updateAi.isPending}
          loading={updateAi.isPending}
        >
          {t("settings.ai_save")}
        </Button>
      </div>
    </>
  );
}

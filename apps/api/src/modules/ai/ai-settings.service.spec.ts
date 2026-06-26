import { describe, it, expect, vi, beforeEach } from "vitest";
import { AiSettingsService } from "./ai-settings.service";
import { CredentialCrypto } from "../credential/credential-crypto";

const KEY = "test-encryption-key-1234567890";

function makeService(row: any) {
  const findUnique = vi.fn().mockResolvedValue(row);
  const upsert = vi.fn().mockImplementation(({ update }) => Promise.resolve({ ...row, ...update }));
  const prisma = { aiSettings: { findUnique, upsert } } as any;
  return { svc: new AiSettingsService(prisma), upsert };
}

beforeEach(() => { process.env.ENCRYPTION_KEY = KEY; });

describe("AiSettingsService", () => {
  it("getMasked 不返回明文密钥，只返回 has* 布尔与模型/provider", async () => {
    const enc = new CredentialCrypto(KEY).encrypt("sk-secret");
    const { svc } = makeService({ id: "singleton", provider: "anthropic", anthropicApiKey: enc, anthropicModel: "claude-opus-4-8", openaiApiKey: null, openaiModel: null, openaiBaseUrl: null });
    const m = await svc.getMasked();
    expect(m.hasAnthropicKey).toBe(true);
    expect(m.hasOpenaiKey).toBe(false);
    expect(m.provider).toBe("anthropic");
    expect((m as any).anthropicApiKey).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain("sk-secret");
  });

  it("getResolvedConfig 解密密钥，模型缺省回退", async () => {
    const enc = new CredentialCrypto(KEY).encrypt("sk-secret");
    const { svc } = makeService({ id: "singleton", provider: "anthropic", anthropicApiKey: enc, anthropicModel: null, openaiApiKey: null, openaiModel: null, openaiBaseUrl: null });
    const c = await svc.getResolvedConfig();
    expect(c.anthropic.apiKey).toBe("sk-secret");
    expect(c.anthropic.model).toBe("claude-opus-4-8");
  });

  it("anthropicBaseUrl：getMasked 透出、getResolvedConfig 带入、upsert 可写空清除", async () => {
    const enc = new CredentialCrypto(KEY).encrypt("sk-secret");
    const { svc, upsert } = makeService({ id: "singleton", provider: "anthropic", anthropicApiKey: enc, anthropicModel: "claude-opus-4-8", anthropicBaseUrl: "https://proxy.example.com", openaiApiKey: null, openaiModel: null, openaiBaseUrl: null });
    const m = await svc.getMasked();
    expect(m.anthropicBaseUrl).toBe("https://proxy.example.com");
    const c = await svc.getResolvedConfig();
    expect(c.anthropic.baseUrl).toBe("https://proxy.example.com");
    await svc.upsert({ anthropicBaseUrl: "https://new.example.com" });
    expect(upsert.mock.calls[0][0].update.anthropicBaseUrl).toBe("https://new.example.com");
    await svc.upsert({ anthropicBaseUrl: "" });
    expect(upsert.mock.calls[1][0].update.anthropicBaseUrl).toBeNull();
  });

  it("upsert 加密非空密钥、空密钥跳过（保留原值）", async () => {
    const { svc, upsert } = makeService({ id: "singleton", provider: "anthropic", anthropicApiKey: "old-enc", anthropicModel: null, openaiApiKey: null, openaiModel: null, openaiBaseUrl: null });
    await svc.upsert({ provider: "openai", openaiApiKey: "sk-new", openaiModel: "gpt-x", anthropicApiKey: "" });
    const arg = upsert.mock.calls[0][0];
    expect(arg.update.provider).toBe("openai");
    expect(arg.update.openaiModel).toBe("gpt-x");
    expect(arg.update.openaiApiKey).toBeTruthy();
    expect(arg.update.openaiApiKey).not.toBe("sk-new");
    expect(new CredentialCrypto(KEY).decrypt(arg.update.openaiApiKey)).toBe("sk-new");
    expect(arg.update.anthropicApiKey).toBeUndefined();
  });
});

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CredentialCrypto } from "../credential/credential-crypto";

const SINGLETON_ID = "singleton";
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-8";

export interface AiResolvedConfig {
  provider: "anthropic" | "openai";
  anthropic: { apiKey: string | null; model: string; baseUrl: string | null };
  openai: { apiKey: string | null; model: string | null; baseUrl: string | null };
}
export interface AiSettingsMasked {
  provider: "anthropic" | "openai";
  anthropicModel: string;
  anthropicBaseUrl: string | null;
  openaiModel: string | null;
  openaiBaseUrl: string | null;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
}
export interface AiSettingsUpdate {
  provider?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicBaseUrl?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
}

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private crypto(): CredentialCrypto {
    return new CredentialCrypto(process.env.ENCRYPTION_KEY ?? "");
  }
  private row() {
    return this.prisma.aiSettings.findUnique({ where: { id: SINGLETON_ID } });
  }

  async getMasked(): Promise<AiSettingsMasked> {
    const r = await this.row();
    return {
      provider: r?.provider === "openai" ? "openai" : "anthropic",
      anthropicModel: r?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL,
      anthropicBaseUrl: r?.anthropicBaseUrl ?? null,
      openaiModel: r?.openaiModel ?? null,
      openaiBaseUrl: r?.openaiBaseUrl ?? null,
      hasAnthropicKey: !!r?.anthropicApiKey,
      hasOpenaiKey: !!r?.openaiApiKey,
    };
  }

  async getResolvedConfig(): Promise<AiResolvedConfig> {
    const r = await this.row();
    const dec = (v: string | null | undefined) => (v ? this.crypto().decrypt(v) : null);
    return {
      provider: r?.provider === "openai" ? "openai" : "anthropic",
      anthropic: { apiKey: dec(r?.anthropicApiKey), model: r?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL, baseUrl: r?.anthropicBaseUrl ?? null },
      openai: { apiKey: dec(r?.openaiApiKey), model: r?.openaiModel ?? null, baseUrl: r?.openaiBaseUrl ?? null },
    };
  }

  async upsert(input: AiSettingsUpdate): Promise<AiSettingsMasked> {
    const enc = (v?: string) => (v && v.trim() !== "" ? this.crypto().encrypt(v) : undefined);
    const data: Record<string, unknown> = {};
    if (input.provider) data.provider = input.provider === "openai" ? "openai" : "anthropic";
    if (input.anthropicModel !== undefined) data.anthropicModel = input.anthropicModel || null;
    if (input.anthropicBaseUrl !== undefined) data.anthropicBaseUrl = input.anthropicBaseUrl || null;
    if (input.openaiModel !== undefined) data.openaiModel = input.openaiModel || null;
    if (input.openaiBaseUrl !== undefined) data.openaiBaseUrl = input.openaiBaseUrl || null;
    const ak = enc(input.anthropicApiKey); if (ak) data.anthropicApiKey = ak;
    const ok = enc(input.openaiApiKey); if (ok) data.openaiApiKey = ok;
    await this.prisma.aiSettings.upsert({ where: { id: SINGLETON_ID }, create: { id: SINGLETON_ID, ...data }, update: data });
    return this.getMasked();
  }
}

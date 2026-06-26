import { Injectable, BadRequestException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider } from "./llm-provider.interface";
import { AiSettingsService } from "../ai-settings.service";

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  constructor(private readonly settings: AiSettingsService) {}

  async completeJson<T>(system: string, user: string, schema: object): Promise<T> {
    const cfg = (await this.settings.getResolvedConfig()).anthropic;
    if (!cfg.apiKey) {
      throw new BadRequestException({ code: "AI_NOT_CONFIGURED", message: "Anthropic API key not configured" });
    }
    const client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}) });
    let res: { content: Array<{ type: string; text?: string }> };
    try {
      res = (await client.messages.create({
        model: cfg.model,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", schema } },
        system,
        messages: [{ role: "user", content: user }],
      } as unknown as Parameters<typeof client.messages.create>[0])) as unknown as { content: Array<{ type: string; text?: string }> };
    } catch (err) {
      throw new BadRequestException({ code: "AI_LLM_FAILED", message: `Anthropic call failed: ${(err as Error).message}` });
    }
    const textBlock = res.content.find((b) => b.type === "text" && b.text);
    if (!textBlock?.text) throw new BadRequestException({ code: "AI_LLM_FAILED", message: "Empty LLM response" });
    try { return JSON.parse(textBlock.text) as T; }
    catch { throw new BadRequestException({ code: "AI_LLM_FAILED", message: "LLM response not valid JSON" }); }
  }
}

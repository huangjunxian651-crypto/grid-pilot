import { Injectable, BadRequestException } from "@nestjs/common";
import OpenAI from "openai";
import type { LlmProvider } from "./llm-provider.interface";
import { AiSettingsService } from "../ai-settings.service";

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  constructor(private readonly settings: AiSettingsService) {}

  async completeJson<T>(system: string, user: string, schema: object): Promise<T> {
    const cfg = (await this.settings.getResolvedConfig()).openai;
    if (!cfg.apiKey) throw new BadRequestException({ code: "AI_NOT_CONFIGURED", message: "OpenAI API key not configured" });
    if (!cfg.model) throw new BadRequestException({ code: "AI_NOT_CONFIGURED", message: "OpenAI model not configured" });
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl || undefined });
    // 用广泛兼容的 json_object 模式（DeepSeek 等 OpenAI 兼容端点不支持 strict json_schema），
    // 把目标 JSON Schema 嵌进系统提示让模型按形状产出；后端有二次校验兜底松散输出。
    const sys = `${system}\n\nIMPORTANT: Respond with ONLY a single JSON object (no markdown code fences, no commentary) that conforms to this JSON Schema:\n${JSON.stringify(schema)}`;
    let res: { choices: Array<{ message: { content: string | null } }> };
    try {
      res = (await client.chat.completions.create({
        model: cfg.model,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      } as unknown as Parameters<typeof client.chat.completions.create>[0])) as unknown as { choices: Array<{ message: { content: string | null } }> };
    } catch (err) {
      throw new BadRequestException({ code: "AI_LLM_FAILED", message: `OpenAI call failed: ${(err as Error).message}` });
    }
    const content = res.choices?.[0]?.message?.content;
    if (!content) throw new BadRequestException({ code: "AI_LLM_FAILED", message: "Empty LLM response" });
    // 容错：若模型加了 ```json 围栏或前后说明，截取第一个 { 到最后一个 }。
    const match = content.match(/\{[\s\S]*\}/);
    const jsonText = match ? match[0] : content;
    try { return JSON.parse(jsonText) as T; }
    catch { throw new BadRequestException({ code: "AI_LLM_FAILED", message: "LLM response not valid JSON" }); }
  }
}

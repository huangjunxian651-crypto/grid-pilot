import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
const ctorMock = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: createMock }; constructor(opts: unknown) { ctorMock(opts); } },
}));

import { AnthropicProvider } from "./anthropic.provider";

function settings(anthropic: { apiKey: string | null; model: string; baseUrl?: string | null }) {
  return { getResolvedConfig: vi.fn().mockResolvedValue({ provider: "anthropic", anthropic: { baseUrl: null, ...anthropic }, openai: { apiKey: null, model: null, baseUrl: null } }) } as any;
}

describe("AnthropicProvider", () => {
  beforeEach(() => { createMock.mockReset(); ctorMock.mockReset(); });

  it("配置了 baseUrl 时传给 Anthropic 客户端的 baseURL，未配置则不传", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: '{"recommendations":[]}' }] });
    const withUrl = new AnthropicProvider(settings({ apiKey: "sk-test", model: "claude-opus-4-8", baseUrl: "https://proxy.example.com" }));
    await withUrl.completeJson("s", "u", { type: "object" });
    expect(ctorMock.mock.calls[0][0]).toMatchObject({ apiKey: "sk-test", baseURL: "https://proxy.example.com" });

    ctorMock.mockReset();
    const noUrl = new AnthropicProvider(settings({ apiKey: "sk-test", model: "claude-opus-4-8", baseUrl: null }));
    await noUrl.completeJson("s", "u", { type: "object" });
    expect(ctorMock.mock.calls[0][0].baseURL).toBeUndefined();
  });

  it("缺 key 抛 AI_NOT_CONFIGURED", async () => {
    const p = new AnthropicProvider(settings({ apiKey: null, model: "claude-opus-4-8" }));
    await expect(p.completeJson("s", "u", { type: "object" })).rejects.toMatchObject({ response: { code: "AI_NOT_CONFIGURED" } });
  });

  it("用 settings 的 key/model 调用，output_config.format 结构化输出，解析 JSON 文本块", async () => {
    createMock.mockResolvedValue({ content: [{ type: "text", text: '{"recommendations":[]}' }] });
    const p = new AnthropicProvider(settings({ apiKey: "sk-test", model: "claude-opus-4-8" }));
    const out = await p.completeJson<{ recommendations: unknown[] }>("sys", "usr", { type: "object" });
    expect(out.recommendations).toEqual([]);
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(arg.output_config?.format?.type).toBe("json_schema");
    expect(arg.thinking).toEqual({ type: "adaptive" });
  });
});

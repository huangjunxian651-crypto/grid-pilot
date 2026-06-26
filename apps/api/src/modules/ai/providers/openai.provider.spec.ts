import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("openai", () => ({
  default: class { chat = { completions: { create: createMock } }; constructor(_: unknown) {} },
}));

import { OpenAiProvider } from "./openai.provider";

function settings(openai: { apiKey: string | null; model: string | null; baseUrl: string | null }) {
  return { getResolvedConfig: vi.fn().mockResolvedValue({ provider: "openai", anthropic: { apiKey: null, model: "claude-opus-4-8" }, openai }) } as any;
}

describe("OpenAiProvider", () => {
  beforeEach(() => { createMock.mockReset(); });

  it("缺 key 抛 AI_NOT_CONFIGURED", async () => {
    await expect(new OpenAiProvider(settings({ apiKey: null, model: "m", baseUrl: null })).completeJson("s", "u", { type: "object" }))
      .rejects.toMatchObject({ response: { code: "AI_NOT_CONFIGURED" } });
  });

  it("缺 model 抛 AI_NOT_CONFIGURED", async () => {
    await expect(new OpenAiProvider(settings({ apiKey: "sk", model: null, baseUrl: null })).completeJson("s", "u", { type: "object" }))
      .rejects.toMatchObject({ response: { code: "AI_NOT_CONFIGURED" } });
  });

  it("用 settings 的 key/model 调 response_format json_schema 并解析", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '{"recommendations":[]}' } }] });
    const out = await new OpenAiProvider(settings({ apiKey: "sk", model: "test-model", baseUrl: null })).completeJson<{ recommendations: unknown[] }>("sys", "usr", { type: "object" });
    expect(out.recommendations).toEqual([]);
    const arg = createMock.mock.calls[0][0];
    expect(arg.model).toBe("test-model");
    // 广泛兼容的 json_object 模式（支持 DeepSeek 等），schema 嵌进系统提示
    expect(arg.response_format.type).toBe("json_object");
    expect(arg.messages[0].role).toBe("system");
    expect(arg.messages[0].content).toContain("JSON Schema");
  });

  it("容错解析：剥离 ```json 围栏/前后说明", async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '```json\n{"recommendations":[{"x":1}]}\n``` done' } }] });
    const out = await new OpenAiProvider(settings({ apiKey: "sk", model: "m", baseUrl: null })).completeJson<{ recommendations: unknown[] }>("s", "u", { type: "object" });
    expect(out.recommendations).toHaveLength(1);
  });
});

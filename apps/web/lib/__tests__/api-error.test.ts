import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function mockResponse(options: {
  ok: boolean;
  status: number;
  body?: string | object;
}) {
  const bodyText =
    typeof options.body === "string"
      ? options.body
      : options.body
        ? JSON.stringify(options.body)
        : "";

  return {
    ok: options.ok,
    status: options.status,
    text: vi.fn().mockResolvedValue(bodyText),
    json: vi.fn().mockResolvedValue(
      typeof options.body === "string" ? {} : (options.body ?? {}),
    ),
    headers: new Headers(),
  } as unknown as Response;
}

describe("ApiError", () => {
  let ApiError: typeof import("../api").ApiError;
  let fetchJson: typeof import("../api").fetchJson;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    const api = await import("../api");
    ApiError = api.ApiError;
    fetchJson = api.fetchJson;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("提取 NestJS 标准格式 { statusCode, message } 中的 message", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        body: { statusCode: 400, message: "无法启动机器人：至少需要一个箱体" },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(400);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "无法启动机器人：至少需要一个箱体",
      );
    }
  });

  it("NestJS 完整格式 { message, error, statusCode } 优先取 message 而非 error", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        body: {
          statusCode: 400,
          message: "无法启动机器人：至少需要一个箱体",
          error: "Bad Request",
        },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "无法启动机器人：至少需要一个箱体",
      );
    }
  });

  it("提取自定义格式 { error } 中的 error 字段", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 500,
        body: { success: false, error: "内部服务错误" },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(500);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "内部服务错误",
      );
    }
  });

  it("NestJS message 为数组时 join 为字符串", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        body: {
          statusCode: 400,
          message: ["symbol 必填", "direction 必填"],
        },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "symbol 必填; direction 必填",
      );
    }
  });

  it("纯文本响应直接作为 message", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: false, status: 502, body: "Bad Gateway" }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).message).toBe("Bad Gateway");
    }
  });

  it("fetch 网络错误时返回友好提示", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(0);
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "网络连接失败，请稍后重试",
      );
    }
  });

  it("响应体含 code 字段时 ApiError 携带该 code", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 409,
        body: { code: "ROBOT_DUPLICATE", message: "A robot already exists" },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(409);
      expect((err as InstanceType<typeof ApiError>).message).toBe("A robot already exists");
      expect((err as InstanceType<typeof ApiError>).code).toBe("ROBOT_DUPLICATE");
    }
  });

  it("message 不包含 'API xxx:' 前缀", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        body: { statusCode: 400, message: "参数错误" },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as InstanceType<typeof ApiError>).message).not.toMatch(
        /^API \d/,
      );
    }
  });

  it("NestJS BadRequestException 默认 message 为 'Bad Request' 时回退到 statusText", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({
        ok: false,
        status: 400,
        body: { statusCode: 400, message: "Bad Request" },
      }),
    );

    try {
      await fetchJson("/test");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      // NestJS 默认 message="Bad Request" 时，应展示通用提示而非 "Bad Request"
      expect((err as InstanceType<typeof ApiError>).message).toBe(
        "请求参数错误",
      );
    }
  });
});

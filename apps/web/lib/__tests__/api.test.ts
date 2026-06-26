import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let credentialApi: typeof import("../api").credentialApi;

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn());
  const api = await import("../api");
  credentialApi = api.credentialApi;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function mockResponse(options: {
  ok: boolean;
  status: number;
  body?: string | object;
  headers?: Record<string, string>;
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
    json: vi.fn().mockResolvedValue(options.body ?? {}),
    headers: new Headers(options.headers ?? {}),
  } as unknown as Response;
}

describe("fetchJson", () => {
  it("prepends /api to relative paths", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: [{ id: "1" }] }),
    );

    await credentialApi.list();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/credentials",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("does NOT prepend /api to absolute URLs", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: { result: "ok" } }),
    );

    const { fetchJson } = await import("../api");
    await fetchJson("http://example.com/data");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://example.com/data",
      expect.anything(),
    );
  });

  it("throws on non-ok response with status and raw text message", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: false, status: 404, body: "Not found" }),
    );

    await expect(credentialApi.list()).rejects.toThrow("Not found");
  });

  it("parses JSON error response body and uses parsed.error", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: false, status: 400, body: { error: "Invalid input" } }),
    );

    await expect(credentialApi.list()).rejects.toThrow(
      "Invalid input",
    );
  });

  it("returns undefined for 204 No Content", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(mockResponse({ ok: true, status: 204 }));

    const result = await credentialApi.remove("cred-123");

    expect(result).toBeUndefined();
  });

  it("parses and returns JSON on success", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    const data = [
      { id: "1", exchangeId: "binance", accountId: "acc1", label: "Main", isActive: true, createdAt: "2024-01-01" },
    ];
    mockFetch.mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: data }),
    );

    const result = await credentialApi.list();

    expect(result).toEqual(data);
  });

  it("passes custom headers correctly merged with defaults", async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValue(
      mockResponse({ ok: true, status: 200, body: { ok: true } }),
    );

    const { fetchJson } = await import("../api");
    await fetchJson("/test", {
      headers: { "X-Custom": "value", Authorization: "Bearer token" },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Custom": "value",
          Authorization: "Bearer token",
        }),
      }),
    );
  });
});

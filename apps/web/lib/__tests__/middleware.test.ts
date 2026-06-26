import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let middleware: typeof import("../../middleware").middleware;

const API_URL = process.env.API_URL ?? "http://localhost:3301";

function createRequest(path: string, cookieValue?: string) {
  const url = new URL(path, "http://localhost:3300");
  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set("cookie", `gridpilot_session=${cookieValue}`);
  }
  return new NextRequest(url, { headers });
}

describe("middleware auth guard", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    const mod = await import("../../middleware");
    middleware = mod.middleware;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function mockApiResponse(status: number) {
    return {
      ok: status < 400,
      status,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(""),
      headers: new Headers(),
    } as unknown as Response;
  }

  describe("public paths", () => {
    it("allows /login without cookie", async () => {
      const req = createRequest("/login");
      const res = await middleware(req);
      expect(res).toBeInstanceOf(NextResponse);
    });

    it("allows /_next/* without cookie", async () => {
      const req = createRequest("/_next/static/chunk.js");
      const res = await middleware(req);
      expect(res).toBeInstanceOf(NextResponse);
    });
  });

  describe("protected paths without cookie", () => {
    it("redirects /dashboard to /login when no cookie", async () => {
      const req = createRequest("/dashboard");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/login");
    });

    it("redirects / to /login when no cookie", async () => {
      const req = createRequest("/");
      const res = await middleware(req);
      expect(res.status).toBe(307);
    });
  });

  describe("protected paths with valid session", () => {
    it("lets request through when /api/auth/me returns 200", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValue(mockApiResponse(200));

      const req = createRequest("/dashboard", "valid-session-token");
      const res = await middleware(req);

      expect(mockFetch).toHaveBeenCalledWith(
        `${API_URL}/api/auth/me`,
        expect.objectContaining({
          headers: expect.objectContaining({
            cookie: "gridpilot_session=valid-session-token",
          }),
        }),
      );
      expect(res).toBeInstanceOf(NextResponse);
      expect(res.status).not.toBe(307);
    });
  });

  describe("protected paths with invalid/expired session", () => {
    it("redirects to /login and clears cookie when /api/auth/me returns 401", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValue(mockApiResponse(401));

      const req = createRequest("/dashboard", "expired-or-fake-token");
      const res = await middleware(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/login");

      const setCookie = res.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("gridpilot_session=");
      expect(setCookie).toMatch(/Max-Age=0|expires=.*1970/);
    });

    it("API 返回 500（服务异常）时放行且不清 cookie——会话状态未知，不能误杀", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValue(mockApiResponse(500));

      const req = createRequest("/dashboard", "some-token");
      const res = await middleware(req);

      expect(res.status).not.toBe(307);
      expect(res.headers.get("set-cookie") ?? "").not.toMatch(/Max-Age=0/);
    });
  });

  describe("backend unreachable", () => {
    it("API 不可达（重启窗口）时放行且不清 cookie——cookie 是恢复登录态的唯一凭证", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const req = createRequest("/dashboard", "some-token");
      const res = await middleware(req);

      expect(res.status).not.toBe(307);
      expect(res.headers.get("set-cookie") ?? "").not.toMatch(/Max-Age=0/);
    });

    it("/login 页在 API 不可达时不重定向到 dashboard（留在登录页）", async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const req = createRequest("/login", "some-token");
      const res = await middleware(req);

      expect(res.status).not.toBe(307);
    });
  });
});

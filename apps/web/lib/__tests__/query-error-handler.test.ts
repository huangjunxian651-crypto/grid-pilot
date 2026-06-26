import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toast } from "sonner";
import { ApiError } from "../api";
import { handleQueryError, handleMutationError } from "../query-error-handler";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

describe("全局错误处理", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
  });

  it("400 错误直接展示后端消息", () => {
    handleMutationError(new ApiError(400, "无法启动机器人：至少需要一个箱体"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("无法启动机器人：至少需要一个箱体");
  });

  it("404 错误展示业务消息", () => {
    handleMutationError(new ApiError(404, "机器人不存在"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("机器人不存在");
  });

  it("500 错误展示通用服务异常提示", () => {
    handleMutationError(new ApiError(500, "内部错误"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("服务异常，请稍后重试");
  });

  it("502 错误展示通用服务异常提示", () => {
    handleMutationError(new ApiError(502, "Bad Gateway"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("服务异常，请稍后重试");
  });

  it("网络错误（status=0）展示网络连接失败", () => {
    handleMutationError(new ApiError(0, "网络连接失败，请稍后重试"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("网络连接失败，请稍后重试");
  });

  it("非 ApiError 的普通 Error 不 toast", () => {
    handleMutationError(new Error("something"), {} as any, {} as any);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("401 mutation 不 toast（由 401 跳转逻辑处理）", () => {
    handleMutationError(new ApiError(401, "登录已过期"), {} as any, {} as any);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("query 的 401 错误跳转 /login", () => {
    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { href: "", assign: assignSpy },
      writable: true,
      configurable: true,
    });

    handleQueryError(new ApiError(401, "登录已过期"), { meta: {} } as any);
    expect(window.location.href).toBe("/login");

    // cleanup: vitest jsdom 不允许完美还原，但后续测试不依赖 location
  });

  it("query 的 401 + skipAuthRedirect 不跳转", () => {
    const currentHref = window.location.href;
    handleQueryError(new ApiError(401, "登录已过期"), { meta: { skipAuthRedirect: true } } as any);
    expect(window.location.href).toBe(currentHref);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("401 mutation 也跳转 /login", () => {
    Object.defineProperty(window, "location", {
      value: { href: "" },
      writable: true,
      configurable: true,
    });

    handleMutationError(new ApiError(401, "登录已过期"), {} as any, {} as any);
    expect(window.location.href).toBe("/login");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("query 的 500 也 toast", () => {
    handleQueryError(new ApiError(500, "内部错误"), { meta: {} } as any);
    expect(toast.error).toHaveBeenCalledWith("服务异常，请稍后重试");
  });

  it("有 code 时按 code 本地化（zh）", () => {
    handleMutationError(new ApiError(409, "A robot already exists", "ROBOT_DUPLICATE"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("该账户下该交易对已有机器人");
  });

  it("未知 code 回退到后端消息", () => {
    handleMutationError(new ApiError(409, "fallback msg", "UNKNOWN_CODE_XYZ"), {} as any, {} as any);
    expect(toast.error).toHaveBeenCalledWith("fallback msg");
  });
});

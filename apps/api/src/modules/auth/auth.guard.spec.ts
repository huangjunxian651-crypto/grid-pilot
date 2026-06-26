import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthGuard } from "./auth.guard";
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { COOKIE_NAME } from "./auth.constants";

describe("AuthGuard", () => {
  let guard: AuthGuard;
  let sessionMock: any;

  const createMockContext = (cookie?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: cookie ? { cookie } : {},
        }),
      }),
    } as ExecutionContext;
  };

  beforeEach(() => {
    sessionMock = {
      validate: vi.fn(),
    };
    guard = new AuthGuard(sessionMock);
  });

  it("allows access with valid session", async () => {
    sessionMock.validate.mockResolvedValue("user-123");
    const context = createMockContext(`${COOKIE_NAME}=token-abc`);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(sessionMock.validate).toHaveBeenCalledWith("token-abc");
  });

  it("denies access without cookie", async () => {
    const context = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(sessionMock.validate).not.toHaveBeenCalled();
  });

  it("denies access with invalid session", async () => {
    sessionMock.validate.mockResolvedValue(null);
    const context = createMockContext(`${COOKIE_NAME}=invalid-token`);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("attaches userId to request on success", async () => {
    sessionMock.validate.mockResolvedValue("user-123");
    const request: any = { headers: { cookie: `${COOKIE_NAME}=token-abc` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;

    await guard.canActivate(context);

    expect(request.userId).toBe("user-123");
  });
});

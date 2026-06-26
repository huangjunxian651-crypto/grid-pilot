import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionService } from "./session.service";

describe("SessionService", () => {
  let service: SessionService;
  let redisMock: any;

  beforeEach(() => {
    redisMock = {
      setex: vi.fn().mockResolvedValue("OK"),
      get: vi.fn(),
      del: vi.fn().mockResolvedValue(1),
    };
    service = new SessionService(redisMock);
  });

  it("create returns a token and stores in redis", async () => {
    const token = await service.create("user-123");
    expect(token).toBeTypeOf("string");
    expect(token.length).toBeGreaterThan(0);
    expect(redisMock.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^session:/),
      604800,
      JSON.stringify({ userId: "user-123" }),
    );
  });

  it("validate returns userId for valid token", async () => {
    redisMock.get.mockResolvedValue(JSON.stringify({ userId: "user-123" }));
    const userId = await service.validate("token-abc");
    expect(userId).toBe("user-123");
    expect(redisMock.get).toHaveBeenCalledWith("session:token-abc");
  });

  it("validate returns null for invalid token", async () => {
    redisMock.get.mockResolvedValue(null);
    const userId = await service.validate("token-xyz");
    expect(userId).toBeNull();
  });

  it("destroy deletes token from redis", async () => {
    await service.destroy("token-abc");
    expect(redisMock.del).toHaveBeenCalledWith("session:token-abc");
  });
});

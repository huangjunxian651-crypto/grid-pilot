import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "./auth.service";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

describe("AuthService", () => {
  let service: AuthService;
  let prismaMock: any;
  let sessionMock: any;

  beforeEach(() => {
    const userMethods = {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    };
    prismaMock = {
      ...userMethods,
      user: userMethods,
      $transaction: vi.fn(async (fn: any) => fn({ user: userMethods, $executeRaw: vi.fn() })),
    };
    sessionMock = {
      create: vi.fn().mockResolvedValue("session-token-123"),
      destroy: vi.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(prismaMock, sessionMock);
  });

  describe("register", () => {
    it("creates first user with hashed password", async () => {
      prismaMock.user.findFirst.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        displayName: "",
        passwordHash: "hashed",
      });

      const result = await service.register("admin@example.com", "password123");

      expect(result.user.email).toBe("admin@example.com");
      expect(result.token).toBe("session-token-123");
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: "admin@example.com",
          passwordHash: expect.any(String),
        }),
      });
    });

    it("rejects registration when user already exists with password", async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        passwordHash: "existing-hash",
      });

      await expect(service.register("admin@example.com", "password123")).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("allows registration to fill empty user record (no passwordHash)", async () => {
      prismaMock.user.findFirst.mockResolvedValue({
        id: "user-1",
        email: "",
        displayName: "",
        passwordHash: "",
      });
      prismaMock.user.update.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        displayName: "",
      });

      const result = await service.register("admin@example.com", "password123");

      expect(result.user.email).toBe("admin@example.com");
      expect(prismaMock.user.update).toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("returns token for valid credentials", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("password123", 10);
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        passwordHash: hash,
      });

      const result = await service.login("admin@example.com", "password123");

      expect(result.user.email).toBe("admin@example.com");
      expect(result.token).toBe("session-token-123");
    });

    it("rejects login for non-existent user", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(service.login("nobody@example.com", "password123")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects login for wrong password", async () => {
      // Use a real bcrypt hash for a known password so compare works correctly
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        passwordHash: hash,
      });

      await expect(service.login("admin@example.com", "wrongpassword")).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("logout", () => {
    it("destroys session token", async () => {
      await service.logout("token-abc");
      expect(sessionMock.destroy).toHaveBeenCalledWith("token-abc");
    });
  });

  describe("me", () => {
    it("returns user data for valid userId", async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        id: "user-1",
        email: "admin@example.com",
        displayName: "Admin",
        language: "zh",
      });

      const result = await service.me("user-1");

      expect(result).toEqual({
        id: "user-1",
        email: "admin@example.com",
        displayName: "Admin",
        language: "zh",
      });
    });

    it("returns null for non-existent user", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.me("user-nonexistent");

      expect(result).toBeNull();
    });
  });
});

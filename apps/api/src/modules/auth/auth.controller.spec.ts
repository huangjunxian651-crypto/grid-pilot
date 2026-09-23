import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { AuthGuard } from "./auth.guard";

describe("AuthController", () => {
  let app: INestApplication;
  let authMock: any;
  let sessionMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.COOKIE_SECURE;

    authMock = {
      register: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      me: vi.fn(),
    };
    sessionMock = {
      validate: vi.fn(),
      destroy: vi.fn(),
      create: vi.fn(),
    };

    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authMock },
        { provide: SessionService, useValue: sessionMock },
        AuthGuard,
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.COOKIE_SECURE;
  });

  it("POST /auth/register creates user and sets cookie", async () => {
    authMock.register.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", email: "admin@example.com", displayName: "" },
    });

    const res = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "admin@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("admin@example.com");
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.headers["set-cookie"][0]).toMatch(/gridpilot_session=/);
  });

  it("POST /auth/login returns user and sets cookie", async () => {
    authMock.login.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", email: "admin@example.com", displayName: "" },
    });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("admin@example.com");
  });

  it("allows COOKIE_SECURE=false for local HTTP deployments", async () => {
    process.env.COOKIE_SECURE = "false";
    authMock.login.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", email: "admin@example.com", displayName: "" },
    });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"][0]).not.toMatch(/; Secure/i);
  });

  it("allows COOKIE_SECURE=true for HTTPS deployments", async () => {
    process.env.COOKIE_SECURE = "true";
    authMock.login.mockResolvedValue({
      token: "session-token",
      user: { id: "user-1", email: "admin@example.com", displayName: "" },
    });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "admin@example.com", password: "password123" });

    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"][0]).toMatch(/; Secure/i);
  });

  it("POST /auth/logout clears cookie", async () => {
    sessionMock.validate.mockResolvedValue("user-1");

    const res = await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Cookie", "gridpilot_session=token-abc");

    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"][0]).toMatch(/gridpilot_session=;/);
  });

  it("GET /auth/me returns user when authenticated", async () => {
    sessionMock.validate.mockResolvedValue("user-1");
    authMock.me.mockResolvedValue({
      id: "user-1",
      email: "admin@example.com",
      displayName: "Admin",
    });

    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Cookie", "gridpilot_session=token-abc");

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("admin@example.com");
  });

  it("GET /auth/me returns 401 when no session", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me");

    expect(res.status).toBe(401);
  });
});

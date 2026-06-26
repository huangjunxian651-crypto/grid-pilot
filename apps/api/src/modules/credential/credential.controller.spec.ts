import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { CredentialController } from "./credential.controller";
import { CredentialService } from "./credential.service";
import { AuthGuard } from "../auth/auth.guard";

describe("CredentialController (integration)", () => {
  let app: INestApplication;

  const mockService = {
    findAll: vi.fn(),
    findOnePublic: vi.fn(),
    findOneMasked: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module = await Test.createTestingModule({
      controllers: [CredentialController],
      providers: [{ provide: CredentialService, useValue: mockService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("GET /credentials returns list", async () => {
    const credentials = [
      { id: "1", exchangeId: "binance", accountId: "acc1", label: "Main", isActive: true, createdAt: new Date().toISOString() },
      { id: "2", exchangeId: "gateio", accountId: "acc2", label: "Backup", isActive: false, createdAt: new Date().toISOString() },
    ];
    mockService.findAll.mockResolvedValue(credentials);

    const res = await request(app.getHttpServer())
      .get("/credentials")
      .expect(200);

    expect(res.body).toEqual(credentials);
    expect(mockService.findAll).toHaveBeenCalledTimes(1);
  });

  it("GET /credentials/:id returns single credential with masked keys", async () => {
    const credential = {
      id: "1",
      exchangeId: "binance",
      accountId: "acc1",
      label: "Main",
      isActive: true,
      createdAt: new Date().toISOString(),
      apiKeyMasked: "bin8***xyz4",
      apiSecretMasked: "sec8***ret4",
    };
    mockService.findOneMasked.mockResolvedValue(credential);

    const res = await request(app.getHttpServer())
      .get("/credentials/1")
      .expect(200);

    expect(res.body).toEqual(credential);
    expect(mockService.findOneMasked).toHaveBeenCalledWith("1");
  });

  it("POST /credentials creates new credential", async () => {
    const createDto = {
      exchangeId: "binance",
      accountId: "acc3",
      label: "New",
      apiKey: "key",
      apiSecret: "secret",
    };
    const created = { id: "3", ...createDto, isActive: true, createdAt: new Date().toISOString() };
    mockService.create.mockResolvedValue(created);

    const res = await request(app.getHttpServer())
      .post("/credentials")
      .send(createDto)
      .expect(201);

    expect(res.body).toEqual(created);
    expect(mockService.create).toHaveBeenCalledWith(createDto);
  });

  it("PATCH /credentials/:id updates credential", async () => {
    const updateDto = { label: "Updated", isActive: false };
    const updated = {
      id: "1",
      exchangeId: "binance",
      accountId: "acc1",
      label: "Updated",
      isActive: false,
      createdAt: new Date().toISOString(),
    };
    mockService.update.mockResolvedValue(updated);

    const res = await request(app.getHttpServer())
      .patch("/credentials/1")
      .send(updateDto)
      .expect(200);

    expect(res.body).toEqual(updated);
    expect(mockService.update).toHaveBeenCalledWith("1", updateDto);
  });

  it("PATCH /credentials/:id with apiKey/apiSecret passes them through", async () => {
    const updateDto = { apiKey: "NEWKEY", apiSecret: "NEWSECRET", passphrase: "NEWPASS" };
    mockService.update.mockResolvedValue({ id: "1" });

    await request(app.getHttpServer())
      .patch("/credentials/1")
      .send(updateDto)
      .expect(200);

    expect(mockService.update).toHaveBeenCalledWith("1", updateDto);
  });

  it("PATCH /credentials/:id with exchangeId/accountId passes them through", async () => {
    const updateDto = { exchangeId: "okx", accountId: "new-acc", label: "Updated" };
    mockService.update.mockResolvedValue({ id: "1" });

    await request(app.getHttpServer())
      .patch("/credentials/1")
      .send(updateDto)
      .expect(200);

    expect(mockService.update).toHaveBeenCalledWith("1", updateDto);
  });

  it("DELETE /credentials/:id removes credential", async () => {
    mockService.remove.mockResolvedValue({ id: "1" });

    const res = await request(app.getHttpServer())
      .delete("/credentials/1")
      .expect(200);

    expect(res.body).toEqual({ id: "1" });
    expect(mockService.remove).toHaveBeenCalledWith("1");
  });
});

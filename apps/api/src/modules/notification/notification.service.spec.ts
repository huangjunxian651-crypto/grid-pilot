import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotificationService } from "./notification.service";

describe("NotificationService", () => {
  let service: NotificationService;
  let prismaMock: any;
  let gatewayMock: any;

  beforeEach(() => {
    prismaMock = {
      notification: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    gatewayMock = { broadcastNew: vi.fn(), broadcastUnreadCount: vi.fn() };
    service = new NotificationService(prismaMock, gatewayMock);
  });

  it("lists notifications ordered by createdAt desc", async () => {
    const notifications = [
      { id: "n1", type: "alert", title: "T1", body: "B1", read: false, createdAt: new Date("2026-01-02") },
      { id: "n2", type: "info", title: "T2", body: "B2", read: true, createdAt: new Date("2026-01-01") },
    ];
    prismaMock.notification.findMany.mockResolvedValue(notifications);

    const result = await service.list();

    expect(prismaMock.notification.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual(notifications);
  });

  it("creates a notification", async () => {
    const data = { type: "warn", title: "Warning", body: "Body", rangeId: "r1" };
    const created = { id: "n3", ...data, read: false };
    prismaMock.notification.create.mockResolvedValue(created);

    const result = await service.create(data);

    expect(prismaMock.notification.create).toHaveBeenCalledWith({ data });
    expect(result).toEqual(created);
  });

  it("marks a notification as read", async () => {
    const updated = { id: "n1", read: true };
    prismaMock.notification.update.mockResolvedValue(updated);

    const result = await service.markRead("n1");

    expect(prismaMock.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { read: true },
    });
    expect(result).toEqual(updated);
  });

  it("marks all notifications as read", async () => {
    const result = await service.markAllRead();

    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { read: false },
      data: { read: true },
    });
    expect(result).toEqual({ success: true });
  });

  it("deletes all notifications", async () => {
    const result = await service.deleteAll();

    expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith();
    expect(result).toEqual({ success: true });
  });

  it("counts unread notifications", async () => {
    prismaMock.notification.count.mockResolvedValue(5);

    const result = await service.unreadCount();

    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { read: false },
    });
    expect(result).toBe(5);
  });

  it("createAndBroadcast 广播失败时不抛错，仍返回已创建的通知", async () => {
    const created = { id: "n10", type: "warn", title: "T", body: "B", read: false, createdAt: new Date() };
    prismaMock.notification.create.mockResolvedValue(created);
    gatewayMock.broadcastNew.mockImplementation(() => { throw new Error("ws not ready"); });

    const result = await service.createAndBroadcast({ type: "warn", title: "T", body: "B" });

    expect(result).toBe(created);
    expect(gatewayMock.broadcastUnreadCount).not.toHaveBeenCalled();
  });

  it("createAndBroadcast 落库并广播 new 与 unread-count", async () => {
    const created = { id: "n9", type: "alert", title: "T", body: "B", code: "ROBOT_AUTO_PAUSED", params: { symbol: "ETH/USDT" }, read: false, createdAt: new Date() };
    prismaMock.notification.create.mockResolvedValue(created);
    prismaMock.notification.count.mockResolvedValue(3);

    const result = await service.createAndBroadcast({
      type: "alert",
      title: "Robot auto-paused",
      body: "ETH/USDT: activation failed repeatedly",
      code: "ROBOT_AUTO_PAUSED",
      params: { symbol: "ETH/USDT", reason: "ACCOUNT_MODE_RESTRICTED" },
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: "ROBOT_AUTO_PAUSED", params: { symbol: "ETH/USDT", reason: "ACCOUNT_MODE_RESTRICTED" } }),
    });
    expect(gatewayMock.broadcastNew).toHaveBeenCalledWith(created);
    expect(gatewayMock.broadcastUnreadCount).toHaveBeenCalledWith(3);
    expect(result).toBe(created);
  });
});

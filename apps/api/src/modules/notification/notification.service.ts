import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { NotificationGateway } from "./notification.gateway";

export interface CreateAndBroadcastInput {
  type: string;
  title: string;
  body: string;
  code?: string;
  params?: Record<string, string>;
  rangeId?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationGateway,
  ) {}

  async list() {
    return this.prisma.notification.findMany({ orderBy: { createdAt: "desc" } });
  }

  async create(data: CreateAndBroadcastInput) {
    return this.prisma.notification.create({ data });
  }

  async markRead(id: string) {
    return this.prisma.notification.update({ where: { id }, data: { read: true } });
  }

  async markAllRead() {
    await this.prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    return { success: true };
  }

  async deleteAll() {
    await this.prisma.notification.deleteMany();
    return { success: true };
  }

  async unreadCount() {
    return this.prisma.notification.count({ where: { read: false } });
  }

  /** 引擎侧创建通知统一入口：落库 + 实时推送（new + unread-count）。广播失败不冒泡。 */
  async createAndBroadcast(input: CreateAndBroadcastInput) {
    const notification = await this.create(input);
    try {
      this.gateway.broadcastNew(notification);
      const count = await this.unreadCount();
      this.gateway.broadcastUnreadCount(count);
    } catch (err) {
      this.logger.warn(`createAndBroadcast: WS broadcast failed: ${(err as Error).message}`);
    }
    return notification;
  }
}

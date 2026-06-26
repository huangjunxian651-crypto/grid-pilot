import { Controller, Get, Put, Delete, Param, UseGuards } from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { NotificationGateway } from "./notification.gateway";
import { AuthGuard } from "../auth/auth.guard";

@UseGuards(AuthGuard)
@Controller("notifications")
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly gateway: NotificationGateway,
  ) {}

  @Get()
  list() { return this.service.list(); }

  @Put(":id/read")
  async markRead(@Param("id") id: string) {
    const result = await this.service.markRead(id);
    const count = await this.service.unreadCount();
    this.gateway.broadcastUnreadCount(count);
    return result;
  }

  @Put("read-all")
  async markAllRead() {
    const result = await this.service.markAllRead();
    this.gateway.broadcastUnreadCount(0);
    return result;
  }

  @Delete()
  async deleteAll() {
    const result = await this.service.deleteAll();
    this.gateway.broadcastUnreadCount(0);
    return result;
  }
}

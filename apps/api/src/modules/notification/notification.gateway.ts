import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server } from "socket.io";

// Use the same CORS origin as the main API (from WEB_URL env).
// In development we allow any IP origin for convenience.
const webUrl = process.env.WEB_URL;
const isDev = process.env.NODE_ENV !== "production";
const corsOrigins: (string | RegExp)[] = webUrl ? [webUrl] : [];
if (isDev) {
  corsOrigins.push(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
}

@WebSocketGateway({
  namespace: "notifications",
  cors: { origin: corsOrigins.length > 0 ? corsOrigins : "*" },
})
export class NotificationGateway {
  @WebSocketServer()
  server!: Server;

  broadcastNew(notification: any) {
    this.server.emit("new", notification);
  }

  broadcastUnreadCount(count: number) {
    this.server.emit("unread-count", count);
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef, type OnModuleDestroy } from '@nestjs/common';
import { TradingEngineService } from './trading-engine.service';
import type { FillPayload } from './types/fill-payload';

const webUrl = process.env.WEB_URL;
const isDev = process.env.NODE_ENV !== 'production';

if (!isDev && !webUrl) {
  throw new Error('WEB_URL environment variable is required in production for WebSocket CORS');
}

const corsOrigins: (string | RegExp)[] = webUrl ? [webUrl] : [];
if (isDev) {
  corsOrigins.push(/^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/);
}

@WebSocketGateway({
  namespace: 'trading-engine',
  cors: { origin: corsOrigins.length > 0 ? corsOrigins : '*' },
})
export class TradingEngineGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TradingEngineGateway.name);
  private clientSubscriptions = new Map<string, Set<string>>();
  private broadcastInterval: ReturnType<typeof setInterval> | null = null;
  // U2: cache last FSM state per session to detect transitions
  private lastFsmState = new Map<string, string>();

  constructor(
    @Inject(forwardRef(() => TradingEngineService))
    private readonly service: TradingEngineService,
  ) {}

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
    this.clientSubscriptions.set(client.id, new Set());
    this.startBroadcastIfNeeded();
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clientSubscriptions.delete(client.id);
    this.stopBroadcastIfNoClients();
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, sessionCode: string): void {
    const subs = this.clientSubscriptions.get(client.id);
    if (!subs) return;
    subs.add(sessionCode);
    client.join(sessionCode);
    client.emit('subscribed', { sessionCode });
    const status = this.service.getStatus(sessionCode);
    if (status) client.emit('status', status);
    this.logger.log(`Client ${client.id} subscribed to ${sessionCode}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, sessionCode: string): void {
    const subs = this.clientSubscriptions.get(client.id);
    if (!subs) return;
    subs.delete(sessionCode);
    client.leave(sessionCode);
    client.emit('unsubscribed', { sessionCode });
  }

  @SubscribeMessage('subscribe-account')
  handleSubscribeAccount(client: Socket, data: { credentialId: string }): void {
    const roomName = `account:${data.credentialId}`;
    client.join(roomName);
    const snap = this.service.getAccountSnapshot(data.credentialId);
    if (snap) client.emit('account', snap);
  }

  broadcastAccountSnapshot(credentialId: string): void {
    if (!this.server?.sockets?.adapter) return;
    const rooms = this.server.sockets.adapter.rooms;
    const roomName = `account:${credentialId}`;
    if (!rooms.has(roomName)) return;

    const snap = this.service.getAccountSnapshot(credentialId);
    if (!snap) return;
    this.server.to(roomName).emit('account', snap);
  }

  broadcastSessionUpdate(sessionCode: string): void {
    const status = this.service.getStatus(sessionCode);
    if (!status) return;

    this.server.to(sessionCode).emit('status', status);

    if (status.lastPrice != null) {
      this.server.to(sessionCode).emit('ticker', {
        sessionCode,
        price: status.lastPrice,
      });
    }

    const prev = this.lastFsmState.get(sessionCode) ?? 'INIT';
    if (prev !== status.state) {
      this.lastFsmState.set(sessionCode, status.state);
      this.logger.log(`[${sessionCode}] FSM transition: ${prev} → ${status.state}`);
      this.server.to(sessionCode).emit('fsm', {
        sessionCode,
        to: status.state,
      });
    }
  }

  broadcastFill(sessionCode: string, fill: FillPayload): void {
    if (!this.server?.sockets?.adapter) return;
    const rooms = this.server.sockets.adapter.rooms;
    if (!rooms.has(sessionCode)) return;

    this.server.to(sessionCode).emit('fill', fill);
  }

  private startBroadcastIfNeeded(): void {
    if (this.broadcastInterval) return;
    this.broadcastInterval = setInterval(() => {
      if (!this.service) return;
      const allStatuses = this.service.getAllStatuses();
      for (const status of allStatuses) {
        // DEBUG: log broadcast status
        this.logger.debug(`[${status.sessionCode}] [${status.exchange}] Broadcasting: state=${status.state}, price=${status.lastPrice}`);

        // Existing status broadcast (backward compat)
        this.server.to(status.sessionCode).emit('status', status);

        // U2: derive 'ticker' event for frontend price display
        if (status.lastPrice != null) {
          this.server.to(status.sessionCode).emit('ticker', {
            sessionCode: status.sessionCode,
            price: status.lastPrice,
          });
        }

        // U2: derive 'fsm' event only on state transitions (not every tick)
        const prev = this.lastFsmState.get(status.sessionCode) ?? 'INIT';
        if (prev !== status.state) {
          this.lastFsmState.set(status.sessionCode, status.state);
          this.logger.log(`[${status.sessionCode}] FSM transition: ${prev} → ${status.state}`);
          this.server.to(status.sessionCode).emit('fsm', {
            sessionCode: status.sessionCode,
            to: status.state,
          });
        }
      }
    }, 1000);
  }

  private stopBroadcastIfNoClients(): void {
    if (this.clientSubscriptions.size === 0 && this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }

  // 模块销毁时清理广播定时器：stopBroadcastIfNoClients 仅在客户端归零时清，
  // 关闭时若仍有连接定时器会泄漏（在依赖服务销毁后继续触发）。
  onModuleDestroy(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }
  }
}

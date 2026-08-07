// BinanceWsClient — Binance Futures WebSocket 客户端
// 支持公开行情流和用户数据流
// 按 environment 路由端点：demo(默认，模拟盘 BINANCE_WS_DEMO) / live(实盘 BINANCE_WS_LIVE)
// 连接生命周期(重连/心跳/清理)由 ReconnectingWsClient 基类统一管理

import WebSocket from "ws";
import axios from "axios";
import { ReconnectingWsClient } from "../shared/reconnecting-ws-client";
import { BINANCE_REST_DEMO, BINANCE_WS_DEMO, BINANCE_REST_LIVE, BINANCE_WS_LIVE } from "./binance.types";
import { ExchangeEnvironment } from "@gridpilot/shared-types";

interface WsMessage {
  e?: string; // event type
  s?: string; // symbol
  stream?: string;
  data?: WsMessage;
  [key: string]: unknown;
}

export class BinanceWsClient extends ReconnectingWsClient {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;
  private wsUrl: string;
  private listenKey: string | null = null;
  private listenKeyInterval: NodeJS.Timeout | null = null;
  private isUserDataStream = false;
  private activeStreams: string[] = [];

  constructor(
    credentials: { apiKey: string; apiSecret: string },
    isUserDataStream = false,
    environment: ExchangeEnvironment = "demo",
  ) {
    super("BinanceWsClient");
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.baseUrl = environment === "live" ? BINANCE_REST_LIVE : BINANCE_REST_DEMO;
    this.wsUrl = environment === "live" ? BINANCE_WS_LIVE : BINANCE_WS_DEMO;
    this.isUserDataStream = isUserDataStream;
  }

  protected async buildConnectUrl(): Promise<string> {
    if (this.isUserDataStream) {
      this.listenKey = await this.createListenKey();
      this.startListenKeyRefresh();
      return `${this.wsUrl}/ws/${this.listenKey}`;
    }
    // Combined stream for public data: /stream?streams=...
    const streams = this.activeStreams.length > 0 ? this.activeStreams.join("/") : "";
    return `${this.wsUrl}/stream?streams=${streams}`;
  }

  protected afterSocketOpen(): void {
    this.startPing();
    this.emit("open");
  }

  protected handleParsedMessage(msg: unknown): void {
    const message = msg as WsMessage;
    if (message.e) {
      this.emit(message.e, message);
    } else if (message.stream) {
      // Combined stream wrapper
      const inner = message.data;
      if (inner?.e) {
        this.emit(inner.e, inner);
      }
    }
  }

  protected onDisconnect(): void {
    this.stopListenKeyRefresh();
  }

  subscribe(streams: string[]): void {
    // Merge new streams into activeStreams, deduplicating
    for (const s of streams) {
      if (!this.activeStreams.includes(s)) {
        this.activeStreams.push(s);
      }
    }

    if (!this.isConnected) return;
    const url = `${this.wsUrl}/stream?streams=${this.activeStreams.join("/")}`;
    if (this.ws && this.ws.url !== url) {
      // Prevent ghost reconnects from the old socket
      const oldWs = this.ws;
      oldWs.removeAllListeners();
      oldWs.close();
      this.isConnected = false;
      this.reconnectAttempts = 0; // Reset for the new socket
      this.ws = new WebSocket(url);
      this.attachSocketHandlers(this.ws);
    }
  }

  private async createListenKey(): Promise<string> {
    const res = await axios.post(
      `${this.baseUrl}/fapi/v1/listenKey`,
      {},
      { headers: { "X-MBX-APIKEY": this.apiKey } },
    );
    return res.data.listenKey;
  }

  private async refreshListenKey(): Promise<void> {
    if (!this.listenKey) return;
    try {
      await axios.put(
        `${this.baseUrl}/fapi/v1/listenKey`,
        {},
        { headers: { "X-MBX-APIKEY": this.apiKey } },
      );
    } catch {
      // 续期失败则重建 listenKey；重建本身也可能失败——必须在此吞掉，
      // 否则 startListenKeyRefresh 的定时器回调未 await 此 Promise，会产生未捕获的 rejection。
      // 失败仅记录，等待下一个续期周期重试（用户数据流可能短暂失效）。
      try {
        this.listenKey = await this.createListenKey();
      } catch (err) {
        console.error(
          `[BinanceWsClient] listenKey 续期与重建均失败，等待下一周期重试: ${(err as Error).message}`,
        );
        this.forceReconnect();
      }
    }
  }

  private startListenKeyRefresh(): void {
    // createListenKey 是异步的,期间可能已被 disconnect;不要为已断开的客户端重启续期定时器
    if (this.isDisposed) return;
    // 幂等:已有续期定时器则直接返回。forceReconnect 触发的重连不走 onDisconnect,
    // listenKeyInterval 仍存活,故此处 no-op——单一定时器跨重连持续刷新当前(已更新的)listenKey,
    // 不会重复创建定时器(disconnect 才经 stopListenKeyRefresh 清理)。
    if (this.listenKeyInterval) return;
    this.listenKeyInterval = setInterval(() => {
      this.refreshListenKey();
    }, 30 * 60 * 1000); // Refresh every 30 minutes
  }

  private stopListenKeyRefresh(): void {
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval);
      this.listenKeyInterval = null;
    }
  }

  protected heartbeatIntervalMs(): number | null {
    // Only ping user data streams. Combined streams use the WebSocket
    // library's built-in ping/pong; sending application-level pings
    // with invalid payloads can cause the server to close the connection.
    if (!this.isUserDataStream) return null;
    return 3 * 60 * 1000; // Binance requires ping every 3 minutes for user data stream
  }

  protected sendHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Send a standard WebSocket ping frame (not an application message)
      this.ws.ping();
    }
  }
}

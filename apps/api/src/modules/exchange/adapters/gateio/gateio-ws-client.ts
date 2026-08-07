// GateioWsClient — Gate.io Futures WebSocket 客户端
// 手动实现，无官方 Node.js WS SDK
// 按 environment 路由端点：demo(默认，测试网 GATEIO_WS_TESTNET) / live(实盘 GATEIO_WS_LIVE)
// 连接生命周期(重连/心跳/清理)由 ReconnectingWsClient 基类统一管理

import { createHmac } from "crypto";
import { ReconnectingWsClient } from "../shared/reconnecting-ws-client";
import { GATEIO_WS_TESTNET, GATEIO_WS_LIVE } from "./gateio.types";
import { ExchangeEnvironment } from "@gridpilot/shared-types";

interface WsMessage {
  time?: number;
  time_ms?: number;
  id?: number;
  channel?: string;
  event?: string;
  error?: { code: number; message: string };
  result?: unknown;
  payload?: unknown;
  // WebSocket API 响应格式
  request_id?: string;
  header?: {
    channel?: string;
    event?: string;
    response_time?: string;
  };
  data?: {
    result?: unknown;
    errs?: { label?: string; message?: string };
  };
}

export class GateioWsClient extends ReconnectingWsClient {
  private apiKey: string;
  private apiSecret: string;
  private url: string;
  private isAuthenticated = false;
  private pendingSubscriptions: Array<{ channel: string; payload?: string[] }> = [];
  private activeSubscriptions: Array<{ channel: string; payload?: string[]; isPrivate: boolean }> = [];

  constructor(credentials: { apiKey: string; apiSecret: string }, environment: ExchangeEnvironment = "demo") {
    super("GateioWsClient");
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.url = environment === "live" ? GATEIO_WS_LIVE : GATEIO_WS_TESTNET;
  }

  protected buildConnectUrl(): string {
    return this.url;
  }

  protected async afterSocketOpen(): Promise<void> {
    this.startPing();
    this.emit("open");

    // Re-subscribe to public channels after reconnect
    for (const sub of this.activeSubscriptions) {
      if (!sub.isPrivate) {
        this.send({
          time: Math.floor(Date.now() / 1000),
          channel: sub.channel,
          event: "subscribe",
          payload: sub.payload,
        });
      }
    }

    // If there are private subscriptions, authenticate and then restore them
    const hasPrivate = this.activeSubscriptions.some((s) => s.isPrivate);
    if (hasPrivate) {
      await this.authenticate();
      // After auth, send all private subscriptions
      for (const sub of this.activeSubscriptions) {
        if (sub.isPrivate) {
          this.send({
            time: Math.floor(Date.now() / 1000),
            channel: sub.channel,
            event: "subscribe",
            payload: sub.payload,
          });
        }
      }
    }
  }

  protected onSocketClose(): void {
    this.isAuthenticated = false;
  }

  protected onDisconnect(): void {
    this.isAuthenticated = false;
    this.pendingSubscriptions = [];
  }

  protected heartbeatIntervalMs(): number {
    return 20000; // Ping every 20 seconds
  }

  protected sendHeartbeat(): void {
    this.send({ time: Math.floor(Date.now() / 1000), channel: "futures.ping" });
  }

  async authenticate(): Promise<void> {
    if (this.isAuthenticated) return;

    const timestamp = Math.floor(Date.now() / 1000);
    const timestampStr = timestamp.toString();
    // Gate.io WS API 登录签名（已 testnet 验证 2026-06-04）：
    // signString = `${event}\n${channel}\n${reqParam}\n${timestamp}`，futures.login 无参数→reqParam 为空串。
    // 旧的 `channel=...&event=...&time=...` 格式会报 Signature mismatch。
    const signString = `api\nfutures.login\n\n${timestampStr}`;
    const signature = createHmac("sha512", this.apiSecret)
      .update(signString)
      .digest("hex");

    return new Promise((resolve, reject) => {
      // 三个出口(成功/失败/超时)都要清理另两个监听器,否则每轮失败的鉴权重试都会泄漏一对
      const cleanup = () => {
        clearTimeout(timeout);
        this.off("login", onAuth);
        this.off("loginError", onError);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Gate.io WS auth timeout"));
      }, 10000);

      const onAuth = (result: unknown) => {
        cleanup();
        this.isAuthenticated = true;
        // Subscribe to pending subscriptions after auth
        for (const sub of this.pendingSubscriptions) {
          this.subscribe(sub.channel, sub.payload);
        }
        this.pendingSubscriptions = [];

        resolve();
      };

      const onError = (err: { code: number; message: string }) => {
        cleanup();
        reject(new Error(`Gate.io WS auth failed: ${err.message}`));
      };

      this.once("login", onAuth);
      this.once("loginError", onError);

      // 根据官方文档格式发送认证请求
      this.send({
        time: timestamp,
        id: Math.floor(Math.random() * 1000000),
        channel: "futures.login",
        event: "api",
        payload: {
          req_id: `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          req_header: { "X-Gate-Channel-Id": "apiv4-ws" },
          api_key: this.apiKey,
          signature,
          timestamp: timestampStr,
        },
      });
    });
  }

  subscribe(channel: string, payload?: string[]): void {
    // Private channels require authentication
    const isPrivate = channel.startsWith("futures.orders") ||
      channel.startsWith("futures.autoorders") ||
      channel.startsWith("futures.positions");

    // Track all subscriptions for reconnect restoration (before isConnected check)
    const exists = this.activeSubscriptions.some(
      (s) => s.channel === channel && JSON.stringify(s.payload) === JSON.stringify(payload),
    );
    if (!exists) {
      this.activeSubscriptions.push({ channel, payload, isPrivate });
    }

    if (!this.isConnected) return;

    if (isPrivate && !this.isAuthenticated) {
      this.pendingSubscriptions.push({ channel, payload });
      return;
    }

    const msg: WsMessage = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: "subscribe",
    };
    if (payload) {
      msg.payload = payload;
    }
    this.send(msg);
  }

  unsubscribe(channel: string, payload?: string[]): void {
    if (!this.isConnected) return;

    // Remove from tracked subscriptions
    this.activeSubscriptions = this.activeSubscriptions.filter(
      (s) => !(s.channel === channel && JSON.stringify(s.payload) === JSON.stringify(payload)),
    );

    const msg: WsMessage = {
      time: Math.floor(Date.now() / 1000),
      channel,
      event: "unsubscribe",
    };
    if (payload) {
      msg.payload = payload;
    }
    this.send(msg);
  }

  protected handleParsedMessage(msg: unknown): void {
    const message = msg as WsMessage;

    // 处理 WebSocket API 响应格式（用于认证）
    if (message.request_id && message.header) {
      if (message.header.channel === "futures.login") {
        if (message.data?.errs) {
          this.emit("loginError", message.data.errs);
        } else {
          this.emit("login", message.data?.result);
        }
      }
      return;
    }

    // 处理旧格式消息（用于订阅的 channel 数据）
    if (message.channel === "futures.login") {
      if (message.error) {
        this.emit("loginError", message.error);
      } else {
        this.emit("login", message.result);
      }
      return;
    }

    if (message.error) {
      this.emit("wsError", message);
      return;
    }

    if (message.result) {
      this.emit("data", { channel: message.channel, result: message.result });
    }
  }
}

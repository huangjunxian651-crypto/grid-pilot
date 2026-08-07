// OkxWsClient — OKX v5 API WebSocket 客户端
// 手动实现，无官方 Node.js WS SDK
// 对接 OKX Demo 环境的私有 WebSocket
// 连接生命周期(重连/心跳/清理)由 ReconnectingWsClient 基类统一管理

import { createHmac } from "crypto";
import { ReconnectingWsClient } from "../shared/reconnecting-ws-client";
import { OkxCredentials } from "./okx.types";

interface WsMessage {
  event?: string;
  op?: string;
  arg?: { channel: string; instType?: string; instId?: string };
  data?: unknown[];
  id?: string;
  code?: string;
  msg?: string;
}

export class OkxWsClient extends ReconnectingWsClient {
  private credentials: OkxCredentials;
  private url: string;
  private isPrivate: boolean;
  private subscriptions: Array<{ channel: string; instType?: string; instId?: string }> = [];

  constructor(credentials: OkxCredentials, url: string, isPrivate: boolean) {
    super("OkxWsClient");
    this.credentials = credentials;
    this.url = url;
    this.isPrivate = isPrivate;
  }

  protected buildConnectUrl(): string {
    return this.url;
  }

  protected async afterSocketOpen(): Promise<void> {
    // Only login for private WebSocket; public WS does not require auth
    if (this.isPrivate) {
      await this.login();
    }
    this.startPing();
    // Resubscribe to previous subscriptions
    for (const sub of this.subscriptions) {
      this.send({
        op: "subscribe",
        args: [{ channel: sub.channel, instType: sub.instType, instId: sub.instId }],
      });
    }
    this.emit("open");
  }

  protected heartbeatIntervalMs(): number {
    return 25000;
  }

  protected sendHeartbeat(): void {
    this.send({ op: "ping" });
  }

  subscribe(channel: string, instType?: string, instId?: string): void {
    const arg: Record<string, string> = { channel };
    if (instType) arg.instType = instType;
    if (instId) arg.instId = instId;

    // Deduplicate subscriptions
    const exists = this.subscriptions.some(
      (s) => s.channel === channel && s.instType === instType && s.instId === instId,
    );
    if (!exists) {
      this.subscriptions.push({ channel, instType, instId });
    }

    if (this.isConnected) {
      this.send({ op: "subscribe", args: [arg] });
    }
  }

  unsubscribe(channel: string, instType?: string, instId?: string): void {
    const arg: Record<string, string> = { channel };
    if (instType) arg.instType = instType;
    if (instId) arg.instId = instId;

    this.subscriptions = this.subscriptions.filter(
      (s) => !(s.channel === channel && s.instType === instType && s.instId === instId),
    );

    if (this.isConnected) {
      this.send({ op: "unsubscribe", args: [arg] });
    }
  }

  private async login(): Promise<void> {
    const timestamp = new Date().toISOString();
    const message = timestamp + "GET" + "/users/self/verify";
    const sign = createHmac("sha256", this.credentials.apiSecret)
      .update(message)
      .digest("base64");

    this.send({
      op: "login",
      args: [
        {
          apiKey: this.credentials.apiKey,
          passphrase: this.credentials.passphrase,
          timestamp,
          sign,
        },
      ],
    });
  }

  protected handleParsedMessage(msg: unknown): void {
    const message = msg as WsMessage;

    if (message.event === "login" && message.code === "0") {
      this.emit("login");
      return;
    }

    if (message.event === "subscribe" && message.code === "0") {
      this.emit("subscribed", message.arg);
      return;
    }

    if (message.event === "error") {
      this.emit("wsError", message);
      return;
    }

    if (message.data && message.arg) {
      this.emit("data", { channel: message.arg.channel, data: message.data });
    }
  }
}

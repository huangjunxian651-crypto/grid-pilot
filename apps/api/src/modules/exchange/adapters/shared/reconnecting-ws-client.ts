// ReconnectingWsClient — 交易所 WebSocket 客户端共享基类
// 统一连接生命周期:连接 Promise 装配、指数退避自动重连、心跳定时器、断开清理、消息 JSON 解析。
// 各交易所差异通过模板方法注入:URL 构建、open 后的鉴权/恢复订阅顺序、心跳载荷与周期、消息分发。

import WebSocket from "ws";
import { EventEmitter } from "events";

export abstract class ReconnectingWsClient extends EventEmitter {
  protected ws: WebSocket | null = null;
  protected isConnected = false;
  protected reconnectAttempts = 0;
  /** disconnect() 后置位;阻止进行中的异步重连(如 listenKey 请求)把已断开的客户端"复活" */
  protected isDisposed = false;
  private baseReconnectInterval = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  protected constructor(clientName: string) {
    super({ captureRejections: true });

    // 添加默认错误处理器，防止未处理的 "error" 事件导致进程崩溃
    // 使用者可以通过 client.on("error", handler) 覆盖此行为
    this.on("error", (err) => {
      console.error(`[${clientName}] WebSocket error:`, err);
    });
  }

  /** 构建本次连接的 URL(Binance 需先异步获取 listenKey) */
  protected abstract buildConnectUrl(): string | Promise<string>;

  /**
   * 连接建立后的初始化:心跳、鉴权、恢复订阅、emit("open")。
   * 各交易所对这些步骤的顺序要求不同(如 OKX 先登录再 emit,Gate.io 先 emit 再鉴权),
   * 因此整段交给子类编排;抛出/reject 会使 connect() 失败。
   */
  protected abstract afterSocketOpen(): void | Promise<void>;

  /** 处理一条已完成 JSON 解析的消息(分发为本交易所的业务事件) */
  protected abstract handleParsedMessage(msg: unknown): void;

  /** 应用层心跳周期(毫秒);返回 null 表示该连接不需要应用层心跳 */
  protected abstract heartbeatIntervalMs(): number | null;

  /** 发送一次心跳 */
  protected abstract sendHeartbeat(): void;

  /** 连接关闭时的额外状态复位(如清除鉴权标记);默认无操作 */
  protected onSocketClose(): void {}

  /** disconnect 时的额外清理(如停止 listenKey 续期);默认无操作 */
  protected onDisconnect(): void {}

  async connect(): Promise<void> {
    const url = await this.buildConnectUrl();
    if (this.isDisposed) return;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.attachSocketHandlers(this.ws, resolve, reject);
    });
  }

  /** 给 socket 装配统一的生命周期处理器;Binance 变更订阅重建连接时也复用 */
  protected attachSocketHandlers(
    socket: WebSocket,
    resolve: () => void = () => {},
    reject: (err: unknown) => void = () => {},
  ): void {
    socket.on("open", () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      Promise.resolve()
        .then(() => this.afterSocketOpen())
        .then(resolve)
        .catch(reject);
    });

    socket.on("message", (raw: Buffer) => {
      try {
        this.handleParsedMessage(JSON.parse(raw.toString()));
      } catch {
        // Ignore parse errors
      }
    });

    socket.on("close", () => {
      this.isConnected = false;
      this.stopPing();
      this.onSocketClose();
      this.emit("close");
      this.scheduleReconnect();
    });

    socket.on("error", (err) => {
      this.emit("error", err);
      reject(err);
    });
  }

  /**
   * 强制关闭当前 socket 以触发自动重连（区别于 disconnect()：后者置 isDisposed、永久弃用、不再重连）。
   * 用于子类侦测到连接已不可用（如 Binance listenKey 失效）但 socket 尚未自行 close 时主动恢复。
   * close 事件 → scheduleReconnect → connect → buildConnectUrl（重新铸 listenKey）。
   */
  protected forceReconnect(): void {
    if (this.isDisposed) return;
    this.ws?.close();
  }

  disconnect(): void {
    this.isDisposed = true;
    this.stopPing();
    this.onDisconnect();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      // 添加一个空的 error 监听器来吞噬 close() 可能产生的错误
      this.ws.on("error", () => {});
      try {
        this.ws.close();
      } catch {
        // close() 在连接未建立时可能抛出错误，忽略
      }
      this.ws = null;
    }
    this.isConnected = false;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.isDisposed) return;
    // 无限重连，永不放弃：指数退避 1s→2s→…→60s 封顶，此后一直按 60s 重试。
    // 一次成功 open 会把 reconnectAttempts 归零（见 attachSocketHandlers），退避自动重置回 1s。
    // 7×24 行情/订单流不能因一次较长的网络抽风（如代理节点几分钟不稳）就静默断流直到重启。
    const delay = Math.min(
      this.baseReconnectInterval * Math.pow(2, this.reconnectAttempts),
      60000,
    );
    // 首次触达 60s 封顶时 reconnectAttempts=6（第 7 次尝试）。计数封顶 30 远超之，
    // 仅为避免长期运行整数无界增长，不影响退避结果（已被上面的 min 钳在 60s）。
    if (this.reconnectAttempts < 30) this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptReconnect();
    }, delay);
  }

  /**
   * 执行一轮重连。失败时绝不能让 rejection 逃逸(unhandledRejection 会崩溃整个进程),
   * 且必须保证重连链不中断。失败分三种路径,只有第一种会自带 close 事件续链:
   * 1. socket 自身 error(如 ECONNREFUSED):错误已在 error 事件上报,随后的 close 事件
   *    会再次调度重连 —— 这里无需处理;
   * 2. buildConnectUrl 失败(如 Binance 重连前的 listenKey REST 调用不可达):本轮没有
   *    创建新 socket,不会有 close 事件 —— 必须手动调度下一轮;
   * 3. afterSocketOpen 失败但 socket 仍 OPEN(如 Gate.io 鉴权被拒/超时):连接看似健康
   *    但订阅未恢复 —— 主动关闭,让 close 事件驱动下一轮。
   */
  private attemptReconnect(): void {
    const socketBeforeAttempt = this.ws;
    this.connect().catch((err) => {
      if (this.isDisposed) return;
      if (this.ws === socketBeforeAttempt) {
        // 路径 2:本轮未创建新 socket,显式上报错误并手动续链
        this.emit("error", err);
        this.scheduleReconnect();
      } else if (this.ws?.readyState === WebSocket.OPEN) {
        // 路径 3:连接存活但初始化失败,关闭以触发 close 续链
        this.emit("error", err);
        this.ws.close();
      }
      // 路径 1:close 事件会续链,这里不重复上报、不重复调度
    });
  }

  protected startPing(): void {
    const intervalMs = this.heartbeatIntervalMs();
    if (intervalMs === null) return;
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isConnected) {
        this.sendHeartbeat();
      }
    }, intervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  protected send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

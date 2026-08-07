// 回归测试:WS 客户端自动重连失败时,不得产生未捕获的 Promise rejection(否则整个进程崩溃)
// 场景:连接建立后服务端断开,客户端调度重连,但此时端口已不可达,重连必然失败。
// 三个交易所客户端的重连逻辑同构,统一覆盖。

import { describe, it, expect } from "vitest";
import { createServer, Server } from "http";
import { WebSocketServer } from "ws";
import { OkxWsClient } from "./okx/okx-ws-client";
import { BinanceWsClient } from "./binance/binance-ws-client";
import { GateioWsClient } from "./gateio/gateio-ws-client";

const credentials = { apiKey: "test-key", apiSecret: "test-secret", passphrase: "test-pass" };

interface ReconnectingWsClient {
  connect(): Promise<void>;
  disconnect(): void;
}

async function startLocalWsServer(): Promise<{ server: WebSocketServer; url: string }> {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to get local WS server port");
  }
  return { server, url: `ws://127.0.0.1:${address.port}` };
}

async function expectNoUnhandledRejectionOnFailedReconnect(
  buildClient: (url: string) => ReconnectingWsClient,
): Promise<void> {
  const { server, url } = await startLocalWsServer();
  const client = buildClient(url);
  // 缩短重连间隔,避免测试等待默认的 1s 退避
  (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

  await client.connect();

  const rejections: unknown[] = [];
  const captureRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", captureRejection);

  try {
    // 断开所有连接并关闭服务器 → 客户端 close 事件调度重连 → 端口已死,重连必然失败
    for (const socket of server.clients) {
      socket.terminate();
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );

    // 等待至少一轮重连尝试失败并让 rejection 浮出
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    client.disconnect();
    // 让 disconnect 之后残留的微任务结算完
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.off("unhandledRejection", captureRejection);
  }

  expect(rejections).toEqual([]);
}

async function restartServerOnSamePort(server: WebSocketServer, port: number): Promise<WebSocketServer> {
  for (const socket of server.clients) {
    socket.terminate();
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const restarted = new WebSocketServer({ port });
  await new Promise<void>((resolve) => restarted.once("listening", resolve));
  return restarted;
}

/** 等待服务器收到满足条件的连接(可选地再等一条满足条件的消息) */
async function waitForReconnect(
  server: WebSocketServer,
  options: {
    connectionPredicate?: (requestUrl: string) => boolean;
    messagePredicate?: (msg: Record<string, unknown>) => boolean;
  },
  timeoutMs = 3000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for client to reconnect")),
      timeoutMs,
    );
    server.on("connection", (socket, request) => {
      if (options.connectionPredicate && !options.connectionPredicate(request.url ?? "")) {
        return;
      }
      if (!options.messagePredicate) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      socket.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (options.messagePredicate?.(msg)) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  });
}

describe("WS 客户端断线后自动重连并恢复订阅", () => {
  it("OkxWsClient 重连后重发 subscribe", async () => {
    const { server, url } = await startLocalWsServer();
    const port = new URL(url).port;
    const client = new OkxWsClient(credentials, url, false);
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();
    client.subscribe("tickers", undefined, "ETH-USDT-SWAP");

    const restarted = await restartServerOnSamePort(server, Number(port));
    try {
      await waitForReconnect(restarted, {
        messagePredicate: (msg) =>
          msg.op === "subscribe" &&
          (msg.args as Array<{ channel: string }>)[0]?.channel === "tickers",
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => restarted.close(() => resolve()));
    }
  });

  it("BinanceWsClient 重连时按已订阅 streams 重建连接", async () => {
    const { server, url } = await startLocalWsServer();
    const port = new URL(url).port;
    const client = new BinanceWsClient(credentials);
    (client as unknown as { wsUrl: string }).wsUrl = url;
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();
    client.subscribe(["ethusdt@aggTrade"]);
    // subscribe 会立刻重建连接,等新连接建立后再模拟断线
    await new Promise((resolve) => setTimeout(resolve, 100));

    const restarted = await restartServerOnSamePort(server, Number(port));
    try {
      await waitForReconnect(restarted, {
        connectionPredicate: (requestUrl) => requestUrl.includes("ethusdt@aggTrade"),
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => restarted.close(() => resolve()));
    }
  });

  it("GateioWsClient 重连后重发公开频道 subscribe", async () => {
    const { server, url } = await startLocalWsServer();
    const port = new URL(url).port;
    const client = new GateioWsClient(credentials);
    (client as unknown as { url: string }).url = url;
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();
    client.subscribe("futures.tickers", ["ETH_USDT"]);

    const restarted = await restartServerOnSamePort(server, Number(port));
    try {
      await waitForReconnect(restarted, {
        messagePredicate: (msg) =>
          msg.channel === "futures.tickers" && msg.event === "subscribe",
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => restarted.close(() => resolve()));
    }
  });
});

async function startListenKeyHttpServer(port = 0): Promise<{ server: Server; port: number }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ listenKey: "test-listen-key" }));
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to get listenKey HTTP server port");
  }
  return { server, port: address.port };
}

async function stopHttpServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
}

describe("WS 客户端重连失败后重连链不中断", () => {
  it("OkxWsClient 多轮重连失败后服务恢复仍能重连并恢复订阅", async () => {
    const { server, url } = await startLocalWsServer();
    const port = new URL(url).port;
    const client = new OkxWsClient(credentials, url, false);
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();
    client.subscribe("tickers", undefined, "ETH-USDT-SWAP");

    // 断开并保持服务器下线一段时间,让至少两轮重连尝试失败
    for (const socket of server.clients) {
      socket.terminate();
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const restarted = new WebSocketServer({ port: Number(port) });
    await new Promise<void>((resolve) => restarted.once("listening", resolve));
    try {
      await waitForReconnect(restarted, {
        messagePredicate: (msg) =>
          msg.op === "subscribe" &&
          (msg.args as Array<{ channel: string }>)[0]?.channel === "tickers",
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => restarted.close(() => resolve()));
    }
  });

  it("BinanceWsClient 用户数据流重连时 listenKey 获取失败,链不中断,服务恢复后重连成功", async () => {
    // 用户数据流重连前要先走 REST 获取 listenKey;若此时 REST 也不可达(如代理故障),
    // 失败发生在创建 socket 之前,没有 close 事件可以续链——必须由重连逻辑自己续上
    const { server: httpServer, port: httpPort } = await startListenKeyHttpServer();
    const { server: wsServer, url: wsUrl } = await startLocalWsServer();
    const wsPort = new URL(wsUrl).port;

    const client = new BinanceWsClient(credentials, true);
    (client as unknown as { baseUrl: string }).baseUrl = `http://127.0.0.1:${httpPort}`;
    (client as unknown as { wsUrl: string }).wsUrl = wsUrl;
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();

    // 同时关掉 WS 和 REST:首轮重连在 createListenKey 处失败(创建 socket 之前)
    for (const socket of wsServer.clients) {
      socket.terminate();
    }
    await new Promise<void>((resolve, reject) =>
      wsServer.close((err) => (err ? reject(err) : resolve())),
    );
    await stopHttpServer(httpServer);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // 服务恢复:链未断的话,后续重连会重新获取 listenKey 并连上
    await startListenKeyHttpServer(httpPort);
    const restartedWs = new WebSocketServer({ port: Number(wsPort) });
    await new Promise<void>((resolve) => restartedWs.once("listening", resolve));
    try {
      await waitForReconnect(restartedWs, {
        connectionPredicate: (requestUrl) => requestUrl.includes("test-listen-key"),
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => restartedWs.close(() => resolve()));
    }
  });

  it("GateioWsClient 重连鉴权失败时关闭连接并继续重试,而非静默丢失私有订阅", async () => {
    // 鉴权失败发生在 socket 已 OPEN 之后,不会有 close 事件——若不主动关闭,
    // 连接看似健康但私有订阅永远不会恢复
    const { server, url } = await startLocalWsServer();
    let loginAttempts = 0;
    const rejectLogin = (wsServer: WebSocketServer) => {
      wsServer.on("connection", (socket) => {
        socket.on("message", (raw) => {
          const msg = JSON.parse(String(raw)) as {
            channel?: string;
            payload?: { req_id?: string };
          };
          if (msg.channel === "futures.login") {
            loginAttempts++;
            socket.send(
              JSON.stringify({
                request_id: msg.payload?.req_id,
                header: { channel: "futures.login" },
                data: { errs: { label: "AUTH_FAIL", message: "auth rejected" } },
              }),
            );
          }
        });
      });
    };
    rejectLogin(server);

    const client = new GateioWsClient(credentials);
    (client as unknown as { url: string }).url = url;
    (client as unknown as { baseReconnectInterval: number }).baseReconnectInterval = 50;

    await client.connect();
    // 私有频道订阅会记入 activeSubscriptions,重连时触发鉴权
    client.subscribe("futures.orders", ["ETH_USDT"]);

    // 断开连接(服务器保持在线),重连后 afterSocketOpen 鉴权被服务器拒绝
    for (const socket of server.clients) {
      socket.terminate();
    }

    try {
      // 链未断的话,鉴权失败 → 关闭连接 → close 驱动下一轮重连 → 再次尝试鉴权
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Expected >=2 login attempts, got ${loginAttempts}`)),
          3000,
        );
        const check = setInterval(() => {
          if (loginAttempts >= 2) {
            clearTimeout(timeout);
            clearInterval(check);
            resolve();
          }
        }, 50);
      });
    } finally {
      client.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("WS 客户端重连失败时不崩溃进程", () => {
  it("OkxWsClient 重连失败不产生 unhandledRejection", async () => {
    await expectNoUnhandledRejectionOnFailedReconnect((url) => new OkxWsClient(credentials, url, false));
  });

  it("BinanceWsClient 重连失败不产生 unhandledRejection", async () => {
    await expectNoUnhandledRejectionOnFailedReconnect((url) => {
      const client = new BinanceWsClient(credentials);
      (client as unknown as { wsUrl: string }).wsUrl = url;
      return client;
    });
  });

  it("GateioWsClient 重连失败不产生 unhandledRejection", async () => {
    await expectNoUnhandledRejectionOnFailedReconnect((url) => {
      const client = new GateioWsClient(credentials);
      (client as unknown as { url: string }).url = url;
      return client;
    });
  });
});

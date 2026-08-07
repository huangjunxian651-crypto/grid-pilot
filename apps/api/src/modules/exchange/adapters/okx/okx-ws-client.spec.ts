// okx-ws-client.spec.ts — OkxWsClient isPrivate 登录识别单测
//
// 已知缺陷背景：修复前 afterSocketOpen() 靠 `this.url === OKX_WS_PRIVATE` 字符串比较
// 判断"是否需要登录"。一旦引入第二个私有 WS 地址（OKX_WS_PRIVATE_LIVE），走正式私有流
// 的连接 url 不等于 demo 常量，会被误判为公共流、跳过登录导致鉴权失败。
// 本文件覆盖修复后的显式 isPrivate 参数：demo/live 两种 URL 下，isPrivate 是否正确
// 控制登录握手的发起——这是本 Task 要修的 bug 的直接回归测试，不只是 demo 的既有场景。
//
// afterSocketOpen 是 protected（由基类 ReconnectingWsClient 在 socket "open" 后调用），
// 直接通过类型断言调用，不驱动真实 socket——与仓库内其余用例访问受保护/私有成员的方式一致
// （见 gateio-ws-client.spec.ts 对 buildConnectUrl 的调用方式）。

import { describe, it, expect, vi } from "vitest";
import { OkxWsClient } from "./okx-ws-client";
import { OKX_WS_PUBLIC, OKX_WS_PRIVATE, OKX_WS_PUBLIC_LIVE, OKX_WS_PRIVATE_LIVE } from "./okx.types";

const credentials = { apiKey: "k", apiSecret: "s", passphrase: "p" };

function findLoginCall(sendSpy: ReturnType<typeof vi.spyOn>) {
  return sendSpy.mock.calls.find(([msg]) => (msg as { op?: string }).op === "login");
}

describe("OkxWsClient isPrivate 参数控制登录握手", () => {
  it("isPrivate=true + demo 私有流 URL → afterSocketOpen 发送 login", async () => {
    const client = new OkxWsClient(credentials, OKX_WS_PRIVATE, true);
    const sendSpy = vi.spyOn(client as unknown as { send: (msg: unknown) => void }, "send");

    await (client as unknown as { afterSocketOpen: () => Promise<void> }).afterSocketOpen();

    expect(findLoginCall(sendSpy)).toBeDefined();
    client.disconnect();
  });

  it("isPrivate=true + live 私有流 URL → afterSocketOpen 同样发送 login（修复前用 URL===OKX_WS_PRIVATE 字符串比较会在此漏判，跳过登录）", async () => {
    const client = new OkxWsClient(credentials, OKX_WS_PRIVATE_LIVE, true);
    const sendSpy = vi.spyOn(client as unknown as { send: (msg: unknown) => void }, "send");

    await (client as unknown as { afterSocketOpen: () => Promise<void> }).afterSocketOpen();

    expect(findLoginCall(sendSpy)).toBeDefined();
    client.disconnect();
  });

  it("isPrivate=false + demo 公共流 URL → afterSocketOpen 不发送 login", async () => {
    const client = new OkxWsClient(credentials, OKX_WS_PUBLIC, false);
    const sendSpy = vi.spyOn(client as unknown as { send: (msg: unknown) => void }, "send");

    await (client as unknown as { afterSocketOpen: () => Promise<void> }).afterSocketOpen();

    expect(findLoginCall(sendSpy)).toBeUndefined();
    client.disconnect();
  });

  it("isPrivate=false + live 公共流 URL → afterSocketOpen 不发送 login", async () => {
    const client = new OkxWsClient(credentials, OKX_WS_PUBLIC_LIVE, false);
    const sendSpy = vi.spyOn(client as unknown as { send: (msg: unknown) => void }, "send");

    await (client as unknown as { afterSocketOpen: () => Promise<void> }).afterSocketOpen();

    expect(findLoginCall(sendSpy)).toBeUndefined();
    client.disconnect();
  });
});

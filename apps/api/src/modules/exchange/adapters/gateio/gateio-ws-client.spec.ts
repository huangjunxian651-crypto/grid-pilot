import { describe, it, expect } from "vitest";
import { GateioWsClient } from "./gateio-ws-client";
import { GATEIO_WS_TESTNET, GATEIO_WS_LIVE } from "./gateio.types";

// buildConnectUrl 是 protected（由 ReconnectingWsClient 基类在 connect() 内部调用），
// 直接通过类型断言调用，不驱动真实 socket——与仓库内其余用例访问受保护/私有成员的方式一致
// （见 binance-ws-client.spec.ts 对 listenKey 的直接读写）。
describe("GateioWsClient environment routing", () => {
  it("environment 缺省 → buildConnectUrl 解析为 GATEIO_WS_TESTNET", () => {
    const client = new GateioWsClient({ apiKey: "k", apiSecret: "s" });
    expect((client as any).buildConnectUrl()).toBe(GATEIO_WS_TESTNET);
  });

  it('environment: "demo" → buildConnectUrl 解析为 GATEIO_WS_TESTNET', () => {
    const client = new GateioWsClient({ apiKey: "k", apiSecret: "s" }, "demo");
    expect((client as any).buildConnectUrl()).toBe(GATEIO_WS_TESTNET);
  });

  it('environment: "live" → buildConnectUrl 解析为 GATEIO_WS_LIVE', () => {
    const client = new GateioWsClient({ apiKey: "k", apiSecret: "s" }, "live");
    expect((client as any).buildConnectUrl()).toBe(GATEIO_WS_LIVE);
  });
});

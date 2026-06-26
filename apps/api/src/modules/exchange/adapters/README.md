# Exchange Adapters

GridPilot 交易所适配器层，实现 `IExchangeAdapter` 接口。

## 原则

- **仅使用官方 SDK/API**，严禁使用 ccxt 等第三方聚合库
- **仅对接测试开发网**，不连接主网
- 所有交易所差异在适配器内部消化，不向上层泄露
- 内部 Symbol 统一使用 `ETH/USDT`，适配器负责转换

## 交易所测试网端点

| 交易所 | REST 测试网 | WebSocket 测试网 |
|--------|------------|-----------------|
| Binance | https://testnet.binancefuture.com | wss://stream.binancefuture.com |
| Gate.io | https://api.gateio.ws/api/v4 | wss://fx-ws.gateio.ws/v4/ws/usdt |
| OKX | https://www.okx.com | wss://wspap.okx.com:8443/ws/v5/private |

## 目录结构

```
adapters/
├── shared/
│   └── reconnecting-ws-client.ts   # WS 客户端共享基类
├── binance/
│   ├── binance.adapter.ts
│   ├── binance-ws-client.ts
│   └── binance.types.ts
├── gateio/
│   ├── gateio.adapter.ts
│   ├── gateio-ws-client.ts
│   └── gateio.types.ts
├── okx/
│   ├── okx.adapter.ts
│   ├── okx-ws-client.ts
│   ├── okx-rest-client.ts
│   └── okx.types.ts
├── ws-client-reconnect.spec.ts     # WS 重连行为黑盒测试(三所共用)
└── README.md
```

## WebSocket 客户端架构

三所 WS 客户端均继承 `shared/reconnecting-ws-client.ts` 的 `ReconnectingWsClient` 基类:

- **基类统一管理**:连接 Promise 装配、指数退避自动重连(最多 10 次,上限 60s)、心跳定时器、disconnect 清理、消息 JSON 解析、默认 error 处理器(防止 unhandledRejection / 未监听 error 事件崩溃进程)。
- **子类通过模板方法注入差异**:`buildConnectUrl`(Binance 异步获取 listenKey)、`afterSocketOpen`(鉴权/恢复订阅/emit("open") 的顺序各所不同,整段由子类编排)、`heartbeatIntervalMs`/`sendHeartbeat`(OKX 25s `{op:"ping"}`、Gate.io 20s `futures.ping`、Binance 仅用户数据流 3min WS ping 帧)、`handleParsedMessage`(消息分发)、`onSocketClose`/`onDisconnect`(额外状态清理)。
- 订阅管理(格式、去重、私有频道鉴权门控)语义各所不同,保留在子类,不强行抽象。
- **重连链不中断保证**:一轮重连的三种失败路径都会续上下一轮退避重试——socket 错误由 close 事件续链;`buildConnectUrl` 失败(如 Binance listenKey REST 不可达)无 socket 可言,手动续链;`afterSocketOpen` 失败(如 Gate.io 鉴权被拒)时 socket 仍存活,主动关闭让 close 续链。任何路径都不会产生 unhandledRejection,也不会无日志静默死亡(后两条路径显式 emit("error"))。
- 重连行为契约由 `ws-client-reconnect.spec.ts` 黑盒覆盖:断线自动重连并恢复订阅、上述三条失败路径的链持续性、重连失败不崩溃进程。
- 已知边界:重连达到上限(10 次)后客户端停止重试,目前仅有 "close" 事件,上层无专门告警事件(待后续迭代加终态事件)。

## 各交易所特殊注意事项

### Binance
- `clientOrderId` 全局唯一，不可复用
- listenKey 每 30 分钟续期
- 算法单独立接口 `/fapi/v1/algoOrder`
- 账户 UID：期货 account 接口（`/fapi/v2/account`）不返回 UID，`getAccountUid` 改用 `/fapi/v2/balance` 的 `accountAlias`（官方推荐的 unique account code）

### Gate.io
- `text` 字段必须以 `t-` 开头
- 无官方 Node.js WS SDK，手动实现
- 算法单通过 `initial.text` 携带 clientAlgoId
- 持仓模式切换需无持仓/挂单
- 账户 UID：`getAccountDetail` 的 `userId`

### OKX
- `clOrdId` 仅字母数字（无连字符）
- 无独立保证金模式接口，通过 `setLeverage` 隐式绑定
- 撤算法单需先查询再分批（每批 ≤10）
- 账户 UID：`/api/v5/account/config` 的 `uid`

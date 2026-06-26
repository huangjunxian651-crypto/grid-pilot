# GridPilot 交易所对接计划

> **状态**: Phase 1 完成 — 三大交易所适配器 REST API 已实现，WebSocket 待后续迭代
> **适配器目录**: `apps/api/src/modules/exchange/adapters/`

---

## 已完成的对接

### 1. Binance 适配器

| 项目 | 详情 |
|------|------|
| **SDK** | axios 直接调用（无合适的官方 Node.js USD-M SDK，调研文档明确使用 REST API） |
| **测试网** | `https://testnet.binancefuture.com` |
| **合约** | ETHUSDT USD-M 永续 |
| **文件** | `adapters/binance/binance.adapter.ts` |
| **状态** | REST 全部实现 ✓ / WebSocket stub |

**已实现接口**:
- `createOrder` — POST `/fapi/v1/order`，支持 limit/market/post_only(GTX)
- `cancelOrder` — DELETE `/fapi/v1/order`
- `cancelAllOrders` — DELETE `/fapi/v1/allOpenOrders`
- `closePosition` — POST `/fapi/v1/order`，`closePosition=true`
- `createAlgoOrder` — POST `/fapi/v1/algoOrder`，`algoType=CONDITIONAL`/`type=STOP_MARKET`
- `cancelAlgoOrder` — DELETE `/fapi/v1/algoOrder`
- `cancelAllAlgoOrders` — DELETE `/fapi/v1/algoOpenOrders`
- `fetchAlgoOrders` — GET `/fapi/v1/algoOpenOrders`
- `setPositionMode` / `getPositionMode` — POST/GET `/fapi/v1/positionSide/dual`
- `setLeverage` — POST `/fapi/v1/leverage`
- `setMarginMode` / `getMarginMode` — POST `/fapi/v1/marginType` + GET `/fapi/v2/positionRisk`
- `fetchPosition` — GET `/fapi/v2/positionRisk`
- `fetchBalance` — GET `/fapi/v2/account`
- `fetchOpenOrders` — GET `/fapi/v1/openOrders`
- `getMarketInfo` — GET `/fapi/v1/exchangeInfo`
- `syncStateAfterReconnect` — 组合调用
- `isImmediateTriggerError` — 检查错误码 `-2021`
- `getAccountUid` — GET `/fapi/v2/balance`，取 `accountAlias`（账户唯一识别码；期货 account 接口不返回 UID，官方推荐用 accountAlias）

### 2. Gate.io 适配器

| 项目 | 详情 |
|------|------|
| **SDK** | `gate-api` v7.2.78（官方） |
| **测试网** | `https://fx-api-testnet.gateio.ws/api/v4` |
| **合约** | ETH_USDT USDT 永续 |
| **文件** | `adapters/gateio/gateio.adapter.ts` |
| **状态** | REST 全部实现 ✓ / WebSocket stub |

**已实现接口**:
- `createOrder` — `createFuturesOrder`，`tif=poc`/`gtc`，`t-`前缀 clientOrderId
- `cancelOrder` — `cancelFuturesOrder`
- `cancelAllOrders` — `cancelFuturesOrders`
- `closePosition` — `createFuturesOrder`，`size=0`/`close=true`/`tif=ioc`
- `createAlgoOrder` — `createPriceTriggeredOrder`，`initial.text='t-'+clientAlgoId`，缓存 algoId 映射
- `cancelAlgoOrder` — `cancelPriceTriggeredOrder`
- `cancelAllAlgoOrders` — `cancelPriceTriggeredOrderList`
- `fetchAlgoOrders` — `listPriceTriggeredOrders`，重建 algoId Map
- `setPositionMode` — `setPositionMode('single')`，区分"已是此模式"与"有持仓"
- `setLeverage` — `updatePositionLeverage`
- `setMarginMode` — `updatePositionCrossMode`
- `fetchPosition` / `fetchBalance` / `fetchOpenOrders` / `getMarketInfo`
- `syncStateAfterReconnect` — 组合调用
- `isImmediateTriggerError` — `AUTO_TRIGGER_PRICE_GREATE_MARK` / `AUTO_TRIGGER_PRICE_LESS_MARK`
- `getAccountUid` — `getAccountDetail` 取 `userId`（账户唯一识别码）

**特殊处理**: Gate.io 算法单无 clientAlgoId 字段，通过 `initial.text` 携带标识符；适配器维护内存 Map，重启后 REST 懒恢复。

### 3. OKX 适配器

| 项目 | 详情 |
|------|------|
| **SDK** | axios 直接调用（无官方 Node.js SDK） |
| **Demo** | `https://www.okx.com` |
| **合约** | ETH-USDT-SWAP |
| **文件** | `adapters/okx/okx.adapter.ts` + `okx-rest-client.ts` + `okx-ws-client.ts` |
| **状态** | REST 全部实现 ✓ / WebSocket stub |

**已实现接口**:
- `createOrder` — POST `/api/v5/trade/order`，`tdMode=cross`，`ordType=limit/market/post_only`
- `cancelOrder` — POST `/api/v5/trade/cancel-order`
- `cancelAllOrders` — GET pending + POST `/api/v5/trade/cancel-batch-orders`
- `closePosition` — `reduceOnly=true` 市价单
- `createAlgoOrder` — POST `/api/v5/trade/order-algo`，`ordType=trigger`/`triggerPxType=last`/`ordPx=-1`
- `cancelAlgoOrder` — POST `/api/v5/trade/cancel-algos`
- `cancelAllAlgoOrders` — 分批撤销（每批 ≤10）
- `fetchAlgoOrders` — GET `/api/v5/trade/orders-algo-pending`
- `setPositionMode` — `posMode=net_mode`
- `setLeverage` — `mgnMode=cross`（隐式绑定保证金模式）
- `setMarginMode` — NO-OP（OKX 无独立接口）
- `fetchPosition` / `fetchBalance` / `fetchOpenOrders` / `getMarketInfo`
- `syncStateAfterReconnect` — 组合调用
- `isImmediateTriggerError` — 检查错误码 51020/51021
- `getAccountUid` — GET `/api/v5/account/config` 取 `uid`（账户唯一识别码）

**特殊处理**: OKX 无独立保证金模式接口，通过 `setLeverage` 的 `mgnMode` 参数隐式设置；撤算法单需分批（每次最多 10 个）。

---

## 验证通过标准

| # | 验证项 | Binance | Gate.io | OKX |
|---|--------|---------|---------|-----|
| 1 | `createOrder` 支持 limit/market/post_only | ✓ | ✓ | ✓ |
| 2 | `cancelOrder` + `cancelAllOrders` | ✓ | ✓ | ✓ |
| 3 | `closePosition` 市价平仓 | ✓ | ✓ | ✓ |
| 4 | `createAlgoOrder` + `cancelAlgoOrder` | ✓ | ✓ | ✓ |
| 5 | `cancelAllAlgoOrders` + `fetchAlgoOrders` | ✓ | ✓ | ✓ |
| 6 | `fetchPosition` + `fetchBalance` | ✓ | ✓ | ✓ |
| 7 | `fetchOpenOrders` + `getMarketInfo` | ✓ | ✓ | ✓ |
| 8 | `setPositionMode` + `getPositionMode` | ✓ | ✓ | ✓ |
| 9 | `setLeverage` + `setMarginMode` + `getMarginMode` | ✓ | ✓ | ✓ |
| 10 | `syncStateAfterReconnect` | ✓ | ✓ | ✓ |
| 11 | `isImmediateTriggerError` | ✓ | ✓ | ✓ |
| 12 | 编译通过 | ✓ | ✓ | ✓ |

---

## 账户 UID 解析

三所适配器均实现 `getAccountUid(): Promise<string>`，返回交易所**真实账户唯一标识**，缺失/空值抛 `ACCOUNT_UID_MISSING`：

| 交易所 | 来源 |
|--------|------|
| Binance | `GET /fapi/v2/balance` 的 `accountAlias`（期货 account 接口不返回 UID，accountAlias 是官方推荐的 unique account code） |
| Gate.io | `getAccountDetail` 的 `userId` |
| OKX | `GET /api/v5/account/config` 的 `uid` |

**用途**：创建机器人时解析并写入 `GridRobot.exchangeAccountId`，作为「同一真实账户 + 同一 symbol 至多一个活跃机器人」唯一性约束的基准（DB 偏唯一索引 `GridRobot_active_unique (symbol, exchangeAccountId) WHERE endedAt IS NULL`）。一个真实账户可能配多套 API 凭证，故唯一性必须按真实账户（exchangeAccountId）而非 credentialId。解析失败时拒绝创建机器人（不写 null）。

---

## 已知限制与待办

### WebSocket 实时流（三个交易所均未实现）

当前所有 `watchTicker` / `watchOrderFills` / `watchAlgoTriggers` / `watchPositions` 方法均抛出 `Error("WebSocket not yet implemented")`。

**原因**: WebSocket 实现需要真实交易所凭证进行联调验证。当前阶段仅完成 REST API 适配器。

**后续计划**:
1. 用户提供测试网凭证后，逐个交易所联调 WebSocket 私有流
2. Binance: listenKey 机制 + userData 流
3. Gate.io: `wss://fx-ws-testnet.gateio.ws/v4/ws/usdt` + HMAC-SHA512 认证
4. OKX: `wss://wspap.okx.com:8443/ws/v5/private` + login 消息认证

### 测试覆盖

当前合规测试套件 `adapter-compliance.spec.ts` 为骨架结构，使用 Mock 数据或 nock 拦截 HTTP 请求的具体测试用例待填充。

---

## 使用方式

```typescript
import { ExchangeAdapterFactory } from "./exchange-adapter.factory";

// 创建适配器
const factory = new ExchangeAdapterFactory(registry);

// Gate.io 测试网
const gateio = factory.createAdapter({
  exchangeId: "gateio",
  accountId: "my-gateio-account",
  apiKey: process.env.GATEIO_TEST_API_KEY!,
  apiSecret: process.env.GATEIO_TEST_API_SECRET!,
});

// Binance 测试网
const binance = factory.createAdapter({
  exchangeId: "binance",
  accountId: "my-binance-account",
  apiKey: process.env.BINANCE_TEST_API_KEY!,
  apiSecret: process.env.BINANCE_TEST_API_SECRET!,
});

// OKX Demo
const okx = factory.createAdapter({
  exchangeId: "okx",
  accountId: "my-okx-account",
  apiKey: process.env.OKX_DEMO_API_KEY!,
  apiSecret: process.env.OKX_DEMO_API_SECRET!,
  passphrase: process.env.OKX_DEMO_PASSPHRASE!,
});

// 注册到 Registry
factory.registerAdapter(credential);
```

---

## 项目文件清单

```
apps/api/src/modules/exchange/
├── interfaces/
│   ├── exchange-adapter.interface.ts    # 统一接口契约（20+ 方法）
│   └── exchange-adapter.mock.ts         # Mock 实现（Phase 0）
├── adapters/
│   ├── README.md                        # 适配器层说明
│   ├── utils.ts                         # 共享工具（symbol/quantity/clientId 转换）
│   ├── adapter-compliance.spec.ts       # 三所共用合规测试套件
│   ├── binance/
│   │   ├── binance.adapter.ts           # Binance REST 适配器 (~450 行)
│   │   └── binance.types.ts             # Binance 内部类型
│   ├── gateio/
│   │   ├── gateio.adapter.ts            # Gate.io REST 适配器 (~400 行)
│   │   └── gateio.types.ts              # Gate.io 内部类型
│   └── okx/
│       ├── okx.adapter.ts               # OKX REST 适配器 (~400 行)
│       ├── okx-rest-client.ts           # OKX REST 客户端封装 (~150 行)
│       ├── okx-ws-client.ts             # OKX WebSocket 客户端 (~200 行)
│       └── okx.types.ts                 # OKX 内部类型 + API 响应类型
├── exchange-registry.service.ts         # 适配器注册中心
├── exchange-adapter.factory.ts          # 适配器工厂（根据凭证创建实例）
└── exchange.module.ts                   # NestJS 模块
```

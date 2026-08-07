# GridPilot

> ETH/USDT 永续合约**动态网格**交易平台 · 兼容 Binance / Gate.io / OKX

**交易所自带的网格机器人，是上个时代的产品。**

它把一堆订单往盘口一挂就再也不管——建仓不问价位，止损一刀切，行情跳空只能吃到网格线上的死价格。GridPilot 是一位 7×24 小时盯盘的交易员：**每一次行情跳动，它都重新判断该不该出手、该出什么价。**

**简体中文** · [繁體中文](README.zh-TW.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português](README.pt.md) · [Italiano](README.it.md) · [한국어](README.ko.md) · [ไทย](README.th.md) · [Tiếng Việt](README.vi.md)

---

## 📸 界面预览

| 仪表盘 · 总览 | 费用与返佣 |
|:---:|:---:|
| ![GridPilot 仪表盘](docs/screenshots/zh/dashboard.png) | ![费用与返佣](docs/screenshots/zh/fees.png) |

> 深青色品牌主题 · Space Grotesk / IBM Plex 字体 · 内置 12 种语言，界面随语言切换。

## 🎯 为什么是网格交易？

网格交易把一段价格区间切成若干"网格线"，价格每跌一格就买、每涨一格就卖——**在震荡行情里反复高抛低吸，把波动本身变成收益**。它不预测涨跌，只赚区间内来回波动的差价，因此特别适合无明确趋势、上下震荡的市场。

与"买入持有"相比：买入持有只在最终上涨时获利；网格在横盘震荡中持续积累一笔笔小利润。代价是需要持续管理订单、控制风险——这正是 GridPilot 要替你自动化的部分。

> ⚠️ 网格交易并非稳赚：单边下跌时仍会浮亏，杠杆会放大风险。GridPilot 不决定你赚还是亏——那是行情与概率的事；它做的是在同一个网格策略上，把每一笔执行做到最好。请先理解策略再投入。

## 🤔 用网格之前，先问自己五个问题

**价格还在跌，网格为什么急着在山顶把仓位建满？**
原生网格价格一进区间就立即开仓。GridPilot **追踪建仓**：先跟着低点走，反弹 0.2%（默认值，可调）确认企稳才进场——不抄底、不站岗。（仅当价格朝亏损方向进入激活窗口时追踪；从更深处涨回区间则直接开始运行。）

**行情每秒都在变，你的订单为什么挂上去就不再动？**
GridPilot 每次行情更新都重新决策：该撤就撤、该改就改，任意时刻盘口上可能一张单都没有；价位有利就追着盘口卡最优价，价位不利宁可熔断拒单；能挂 Maker（0.02%）绝不白交 Taker（0.05%）。这套追逐没有下行风险：到了网格价继续跌，就追着买得更便宜；涨回去只要没涨破上一格，仍能按原价成交（按赌徒破产模型测算，真正踏空的概率微乎其微）——多赚是白捡的，捡不到也不亏。

**价格一跳 5–10 USDT，你的网格除了干看着还能做什么？**
静态挂单只能吃到网格线上的死价格。GridPilot 在价格偏离网格理论价超过阈值（默认 0.1% ≈ 2× 吃单手续费）时主动吃单，把超出网格步长的跳跃价差锁进口袋——实测订单簿越"毛糙"的交易所，超额收益越高。

**只是短暂跌破，为什么要把全部仓位一刀市价清仓？**
一键平仓既交 Taker 费，又放弃了反弹。GridPilot 在止损缓冲区**逐格限价减仓**；价格反弹，残余仓位直接接着赚。只有跌穿清算线，最后一张兜底条件单才一次性接管。

**价格早就跑出区间，你的网格为什么还在原地空转？**
GridPilot 预配置多段不重叠区间，价格走进哪段就激活哪段；止损后进入"冷静期"，等重新出现企稳信号才再次追踪建仓。

## 📊 和交易所原生网格正面对比

| 维度 | 交易所原生网格 | GridPilot |
|------|----------------|-----------|
| **决策方式** | 批量静态挂单，挂出后不再移动 | 自动化盯盘：每次行情更新重新判断后才动态下单/改单/撤单，任意时刻不一定有挂单 |
| **成交质量** | 静态单只能吃到网格线价格，跳跃行情的超额价差擦肩而过 | 锚定盘口卡最优价，成交价不劣于理论价；价格偏离理论价超阈值（默认 ≈2× 手续费）时主动吃单锁定超额利润；价位不利熔断拒单 |
| **建仓时机** | 进区间立即开仓 | 追踪建仓：朝亏损方向进入时追低点、确认反弹（默认 0.2%）后才建仓 |
| **止损** | 单一价位一次性市价全平 | 止损缓冲区逐格限价减仓，反弹时残余仓位直接受益；清算线留一张兜底条件单 |
| **行情适应** | 固定单一区间 | 多段不重叠区间，价格进哪段激活哪段，其余休眠 |

> 逐项对比交易所网格的创新全解见 [`docs/INNOVATIONS.md`](docs/INNOVATIONS.md)；完整策略原理见 [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md)。

## ✨ 功能概览

- **状态无关自愈**：目标仓位 = f(当前价格)，崩溃/断网/手动改仓后重启自动纠偏
- **普通网络即可运行**：策略靠"等"不靠"抢"，不拼机房与延迟；即使错过更优价，最坏退回网格原价成交，与传统网格打平
- **实时 WebSocket 推送**：Ticker / 成交 / 状态机事件实时同步前端
- **多交易所支持**：统一适配器接口，兼容 Binance、Gate.io、OKX
- **AI 箱体配置建议**：离线推荐区间与参数，不介入实时交易决策
- **多语言界面**：内置 12 种语言

## 💰 看懂手续费，注册时用邀请码省钱（赞助商 rebateto.me）

手续费由交易所收取，**GridPilot 一分不抽**。同一笔交易，挂单（Maker）≈0.02%、吃单（Taker）≈0.05%。日常网格单两边其实都走 Maker；GridPilot 的手续费优势体现在三个关键时刻——进场等确认后挂单而非立即市价、止损逐格限价减仓而非一刀市价全平、只有超额价差确实盖过手续费时才特许吃单。

更进一步：**注册交易所时填一个返佣码，就能把已付手续费长期返还约 20%（Gate 40%），自动到账**——相当于给每笔交易再打个折。

> ⚠️ 每个交易所只能注册一次，返佣只能在注册时绑定，**老账户无法补——这是唯一的机会**。

**赞助商 [rebateto.me](https://rebateto.me)** 汇总并维护各交易所的返佣注册入口。注册时请使用邀请码：

| 交易所 | 邀请码 | 返佣比例 |
|--------|--------|----------|
| Binance | `fanwo20` | 20% |
| OKX | `fangeiwo` | 20% |
| Gate.io | `fangeiwo` | 40% |

> 用 App 注册时记得手动填邀请码——漏填就拿不到返还。每个身份证每所限开一个账户。

## 📦 安装

两条路径面向完全不同的人，互不依赖：**自部署客户只需要 Docker**；**改代码的开发者才需要 Node/pnpm**，且开发模式下基础设施仍然用 Docker 起（用不同的 compose 文件，不会和客户那条路混在一起）。

### 方式一：Docker 一键部署（自部署 / 生产使用）

**前置依赖**：仅 Docker（含 Compose 插件）。

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
./install.sh
```

`install.sh` 会自动检测 Docker、生成 `.env`（含随机 `ENCRYPTION_KEY`）、构建并启动 postgres + redis + api + web 全部四个服务，等健康检查通过后打印访问地址（默认 http://localhost:3300）。脚本可重复运行。

不想用脚本，等价的手动命令：

```bash
cp .env.example .env
openssl rand -base64 32   # 把输出填进 .env 的 ENCRYPTION_KEY
docker compose up --build -d
```

`docker-compose.yml` 默认就是完整产品栈，不需要任何额外参数。

### 方式二：本地开发（面向修改代码的开发者）

**前置依赖**：Node.js ≥ 20、pnpm ≥ 9、Docker（仅用于起 PostgreSQL/Redis，api/web 本身跑在本机，带热更新）。

```bash
git clone https://github.com/QuantiaAI/grid-pilot.git && cd grid-pilot
pnpm install
cp .env.example .env        # 按需调整端口；ENCRYPTION_KEY 填入 openssl rand -base64 32 的输出
pnpm --filter @gridpilot/api exec prisma generate       # 生成 Prisma Client（postinstall 已禁用，必须手动执行）
pnpm dev:infra              # 用 docker-compose.dev.yml 起 PostgreSQL + Redis（仅基础设施，不含 api/web 容器）
pnpm exec dotenv -e .env -- pnpm --filter @gridpilot/api exec prisma migrate deploy # 仅首次安装：执行数据库迁移
pnpm dev:skip-infra         # 起 API + Web（本机进程，非容器）
```

> `prisma generate` / `migrate deploy` 只需首次安装时执行一次；之后日常开发直接 `pnpm dev` 即可一键起所有服务（含基础设施）。

| 服务 | 地址 | 配置项 |
|------|------|--------|
| 前端 | http://localhost:3300 | `WEB_PORT` / `WEB_HOST` |
| 后端 API | http://localhost:3301 | `API_PORT` / `API_HOST` |
| PostgreSQL | localhost:25432 | `DB_PORT` |
| Redis | localhost:26379 | `REDIS_PORT` |

单独启动：

```bash
pnpm dev:infra        # 仅 PostgreSQL + Redis（docker-compose.dev.yml）
pnpm dev:api          # 仅后端
pnpm dev:web          # 仅前端
pnpm dev:skip-infra   # API + Web，跳过 docker
```

## 🕹️ 使用说明

1. **连接交易所**：在设置中填入 API Key/Secret。**仅授予合约交易权限，切勿开启提现权限。**
2. **配置网格**：选择交易对与方向（做多/做空），设置止盈价锚点、主网格格数/步长、每格数量、杠杆、止损缓冲、追踪建仓参数（箱体边界由锚点 + 格数步长自动推导）。
3. **启动机器人**：进入追踪建仓 → 运行，前端实时显示行情、挂单、成交与状态机。
4. **监控与收尾**：价格到达止盈端，网格逐格平仓自然收尾、仓位清零后止盈退出；跌进止损缓冲区则逐格动态减仓。

关键参数：

| 参数 | 说明 |
|------|------|
| `takeProfitPrice` | 止盈价（箱体止盈端边界） |
| `direction` | 方向：LONG（做多）/ SHORT（做空） |
| `mainGridCount` / `mainGridStep` | 主网格格数 / 每格步长（USDT） |
| `mainGridPortionSize` | 每格下单数量 |
| `leverage` | 杠杆倍数 |
| `stopLossGridCount` / `stopLossGridStep` | 止损缓冲区格数 / 步长 |
| `isolationStep` | 隔离带宽度（缺省 = 止损区步长） |
| `activationPrice` / `trailingCallbackRate` | 区间激活价（默认主网格中点）/ 追踪建仓回调幅度 |
| `excessProfitMultiplier` | GTC 区触发倍数（超额利润阈值） |

完整参数见 [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md)。

## ⚠️ 注意事项

- **风险免责**：合约交易具有高杠杆、高风险，可能导致全部本金损失。本项目为开源交易工具，**不构成任何投资建议**，不对盈亏负责。请先用小资金或交易所测试网充分验证。
- **API 权限**：只开合约交易权限，**不要**开启提现权限。
- **单 runner 约束**：同一交易所账户的同一交易对，同一时间只能运行一个机器人。
- **返佣时机**：邀请码只能在注册时绑定，老账户无法补填。
- **密钥安全**：`ENCRYPTION_KEY` 用于加密交易所凭证，务必使用随机生成的强密钥并妥善保管。
- **端口冲突**：本地 3300/3301 端口若被 `pnpm dev` 占用，会与 Docker 容器冲突，请先停止本地进程再启动容器，或修改 `.env` 中的端口配置。

## 🏗️ 技术栈与架构

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 · React 19 · Tailwind CSS v4 · Zustand · React Query · Recharts |
| 后端 | NestJS 10 · Prisma 5 · BullMQ · Socket.IO |
| 基础设施 | PostgreSQL 16 · Redis 7 · Docker Compose |
| 共享 | TypeScript · pnpm Workspaces · Turborepo |

```
apps/web/               # Next.js 前端（暗色主题，12 语）
apps/api/                # NestJS 后端
packages/shared-types/   # 前后端共享类型
docs/                    # STRATEGY_SPEC.md（策略规格）· ARCHITECTURE.md（组件映射）
docker-compose.yml       # 完整产品栈（postgres+redis+api+web），自部署默认用这个
docker-compose.dev.yml   # 仅基础设施，本地开发用（api/web 走 pnpm）
install.sh               # 一键安装脚本，包装 docker-compose.yml
```

**策略状态机**：`TRAILING_ENTRY → RUNNING → LIQUIDATING → LIQUIDATED`，`RUNNING` 可分支至 `TAKE_PROFIT`；运维分支含 `PAUSED`（可 `USER_RESUME` 复位）、`CANCELLED`、`HOLD`。

**开发命令**：

```bash
pnpm dev          # 一键起所有服务
pnpm build        # 构建
pnpm test         # 测试
pnpm lint         # Lint
```

**数据库**（本地开发）：

```bash
cd apps/api
pnpm prisma migrate dev    # 执行迁移
pnpm prisma studio         # 查看数据
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [`docs/INNOVATIONS.md`](docs/INNOVATIONS.md) | 核心创新全解（逐项对比交易所原生网格） |
| [`docs/STRATEGY_SPEC.md`](docs/STRATEGY_SPEC.md) | 完整策略规格说明书（权威参考） |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 代码组件到规格章节的映射索引 |
| [`docs/fees-and-funding.md`](docs/fees-and-funding.md) | 手续费与资金费说明 |

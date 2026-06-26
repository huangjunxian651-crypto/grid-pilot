# 交易引擎领域科普：实体、状态机与操作术语

> 日期：2026-06-15 · 面向：想理解这套系统黑话的人 · 基准：当前 main（含异步停止、CANCELLED 独立终态、终态口径统一、FSM 写回 Run.state）
> 这份文档不讲代码细节，只讲"概念 + 状态 + 术语"，让你看懂 stopBot/detachBot 这些词、以及各实体现在有哪些状态。

---

## 0. 一句话心智模型：三层

理解这套系统，先记住它分**三层**，每层是不同寿命的东西、各有自己的状态机：

```
┌─────────────────────────────────────────────────────────────┐
│ ① Robot（机器人）——长期实体，用户创建到归档                  │
│    "我要在 币安 的 ETH/USDT 上做多网格" 这件事本身             │
│    状态：PAUSED / RUNNING / STOPPING / STOPPED                │
│                                                               │
│    └─ ② Run / session（交易回合）——临时，几分钟到几小时       │
│        价格进入某个箱体的"激活窗口"才诞生一个 Run，            │
│        止盈/止损/用户停止就结束。一个 Robot 一生会经历很多个 Run│
│        状态：TRAILING_ENTRY / RUNNING / PAUSED /              │
│             LIQUIDATING / LIQUIDATED / TAKE_PROFIT /          │
│             STOPPED / SUPERSEDED                              │
│                                                               │
│        └─ ③ GridBotRunner + FSM（执行引擎）——与 Run 同生死    │
│            真正在交易所挂单/撤单/平仓的那个内存对象，          │
│            内部有一个有限状态机（FSM）逐 tick 决策             │
│            FSM 状态：HOLD / TRAILING_ENTRY / RUNNING /        │
│                     LIQUIDATING / LIQUIDATED / TAKE_PROFIT /  │
│                     CANCELLED / PAUSED                        │
└─────────────────────────────────────────────────────────────┘
```

**为什么要分层？** 因为"机器人"这件事会活很久（你可能跑几个月），但每一次"价格进箱→交易→止盈离场"只是其中一段。把长期的东西（Robot）和一段段会死的回合（Run/session）分开，状态才不会乱。**你大部分困惑来自把这三层混为一谈。**

- 管 ① 的代码：`BotManagerService`（robot 级）
- 管 ②③ 的代码：`TradingEngineService` + `GridBotRunner`（session 级）

---

## 1. 实体关系（数据模型）

```
ExchangeAccount（交易所账户：一套 API 密钥）
   └─1对多→ Robot（机器人：账户 × symbol，唯一；不区分方向）
              └─1对多→ Box（箱体：一组网格参数——止盈价/网格数/步长/止损格子/杠杆）
                         └─1对多→ Run（交易回合：某个箱体被激活跑起来的一次执行）
                                    └─1对多→ Order（挂单）
                                               └─1对多→ Fill（成交）
```

大白话：
- **ExchangeAccount**：一个交易所账号（币安/OKX 等）的密钥。
- **Robot**：一台机器人 = "在这个账户、这个交易对上、朝某个方向（做多/做空）做网格"。**同一(账户,symbol)只能有一台未结束的机器人**（唯一不变量；方向不参与唯一键，因系统不支持双向持仓）。

> **唯一性怎么落地？** 不变量「同一交易所账户(exchangeUid) + symbol 至多一个活跃机器人」由
> **偏唯一索引** `Robot_active_unique ON ("exchangeUid","symbol") WHERE "endedAt" IS NULL` 保证。
> 不能写成 `@@unique([account,symbol,deletedAt])`——PostgreSQL 中 `NULL ≠ NULL`，含 NULL 的
> 普通唯一约束挡不住两个活跃机器人。系统不支持双向持仓，故方向不参与唯一键。
> `endedAt` 同时是「终态 + 归档」标记：机器人停止即写 `endedAt`、移出主列表进归档。
> **归档即只读终态**：不可重启、不可暂停，箱体不可增删改——所有写操作（startRobot / pauseRobot / addBox / editBox / removeBox）一律以 `ROBOT_ARCHIVED` 拒绝。要改配置只能基于它新建一台机器人（前端详情页同步隐藏箱体写控件）。

- **Box（箱体）**：机器人里的一套网格配置。一台机器人可以挂多个箱体（多箱策略），但**同一时刻最多一个箱体是活跃的**。
- **Run（回合/session）**：某个箱体被"激活"后跑起来的一次具体执行。它对应内存里的一个 Runner。结束时记录"为什么结束"（exitReason）。
- **Order / Fill**：这次回合里挂的单、成交的笔。

> 补充实体：`StateSnapshot`（FSM 状态定时存盘，供冷启恢复）、`EquitySnapshot`（账户权益时序，画权益曲线用）。这两个是"旁路存档"，理解主流程时可忽略。

---

## 2. 三个状态机

### 2.1 ① Robot.status（机器人状态——你在列表/详情页看到的）

```
        创建
         │
         ▼
     ┌────────┐  用户启动   ┌─────────┐
     │ PAUSED │ ─────────► │ RUNNING │
     │（暂停） │ ◄───────── │（运行中）│
     └────────┘  用户暂停    └────┬────┘
                                  │ 用户点"停止"（立即）
                                  ▼
                            ┌──────────┐  后台 job 跑完（数秒）
                            │ STOPPING │ ──────────────────►  ┌─────────┐
                            │（停止中） │                      │ STOPPED │
                            └──────────┘  绝不卡在这里         │（已停止）│
                                                              └─────────┘
```

| 状态 | 含义 | 怎么进来 |
|---|---|---|
| `PAUSED` | 暂停/未启动。创建后的默认值 | 创建时；或从 RUNNING 暂停 |
| `RUNNING` | 运行中（在监控行情、等价格进箱激活） | 用户启动；或暂停后恢复 |
| `STOPPING` | **正在停止**（新增的中间态）。后台在撤单/平仓/复核 | 用户点"停止"，立即置此并即时返回 |
| `STOPPED` | 已停止（终态）。成功或失败都收敛到这里 | 后台停止 job 跑完 |

要点：
- **`RUNNING` 不等于"正在交易"**。RUNNING 包含两种子情形：(a) 有活跃箱体、正在交易；(b) **"监控中"——没有活跃箱体，调度器在等价格进入某个箱体的激活窗口**。
- **`STOPPING` 是这次新特性加的**。以前停止是同步卡住几十秒，现在点完立即变 STOPPING、后台慢慢跑，前端轮询显示进度。
- `STOPPING` **绝不会卡死**：哪怕后台出错，也会兜底落到 `STOPPED`（带一个告警码）。

### 2.2 ② Run.state（交易回合状态——数据库里每条 Run 记录）

一个 Run 从激活到结束的状态。注意它和下面 ③ 的 FSM 状态**高度重叠但不完全相同**（Run.state 是落库的"账本状态"，FSM 是内存的"执行状态"）。

```
激活 → TRAILING_ENTRY（追踪建仓，等回调）── 价格回调触发 ──► RUNNING（主网格交易）
                                                              │
              用户暂停 ┌───────────────────────────────────────┤
                      ▼                                        │
                   PAUSED ──恢复──► RUNNING                     │
                                                               │
         结束方式（终态，endedAt 被写）：                      │
           • TAKE_PROFIT  止盈达成，仓位清空，正常离场  ◄───────┤
           • LIQUIDATED   清算完成（止损 / 用户清算）       ◄───┤
           • CANCELLED    追踪窗口关闭、从未建仓（exitReason=TRAILING_CANCELLED）
           • STOPPED      用户主动停止（平仓=USER_CLOSE / 仅分离=USER_DETACH）
           • SUPERSEDED   系统切箱被新回合取代（NEW_SESSION）
         （LIQUIDATING 是"正在清算"的过渡态）
```

| Run.state | 含义 |
|---|---|
| `TRAILING_ENTRY` | 追踪建仓：价格还没到，等它回调 N% 再开网格（仅当箱体配了 trailingEntry） |
| `RUNNING` | 主网格运行中：逐 tick 算目标仓位、挂单/撤单 |
| `PAUSED` | 暂停（保留持仓与内存，可恢复） |
| `LIQUIDATING` | 正在清算（撤单 + 市价平仓，等持仓清零） |
| `LIQUIDATED` | 已清算（终态）：止损或用户清算（exitReason=STOP_LOSS） |
| `TAKE_PROFIT` | 已止盈（终态）：仓位全部止盈卖出 |
| `CANCELLED` | 已取消（终态）：追踪窗口关闭、从未建仓（exitReason=TRAILING_CANCELLED）。独立终态，不并入 LIQUIDATED/止损，否则统计会把"空轮取消"误记为"真实止损" |
| `STOPPED` | 用户主动停止（终态）：平仓=USER_CLOSE / 仅分离=USER_DETACH |
| `SUPERSEDED` | 被新回合取代（终态）：同箱体重新激活、或系统切箱（exitReason=NEW_SESSION） |

> **Run.state 跟随 FSM（写回）**：非终态（TRAILING_ENTRY/RUNNING/PAUSED/LIQUIDATING）由 runner 的 `onStateChange` 经 `syncRunStateFromFsm` 把 FSM 实际状态回写 Run.state，FSM 是唯一真相源——上层不再命令式"猜"（例如空仓 resume 实际转 TRAILING_ENTRY 而非硬写 RUNNING）。终态仍由 `handleAutoTermination` 落库。

### 2.3 ③ FSM.kind（执行引擎内部状态——内存里 runner 逐 tick 跑的）

这是最底层、最细的状态机，在 `GridBotRunner` 内部驱动每一次行情 tick 的决策。**终态有三个**：`LIQUIDATED / TAKE_PROFIT / CANCELLED`——一旦进入，runner 自动停止、回合结束。

```
HOLD（冷启占位，恢复后立即被替换）
  │
  ▼
TRAILING_ENTRY ──价格回调达标──► RUNNING
  │                               │
  │ 价格跌回激活线内               │ 仓位止盈清零(d≤0且无仓)──► TAKE_PROFIT ★终态
  ▼                               │ 价格跌穿满仓线(越止损)──► LIQUIDATING
CANCELLED ★终态                   │ 用户暂停 ──► PAUSED
（窗口关闭，没成交）              │ 用户清算 ──► LIQUIDATING
                                  ▼
                            LIQUIDATING ──持仓清零──► LIQUIDATED ★终态

PAUSED ──恢复且有仓──► RUNNING
PAUSED ──恢复且无仓──► TRAILING_ENTRY
```

| FSM.kind | 大白话 |
|---|---|
| `HOLD` | 冷启动占位，恢复出真实状态后立刻被替换，几乎不可见 |
| `TRAILING_ENTRY` | 追踪等待：盯着价格极值，等它回调到位才开网格 |
| `RUNNING` | 主网格运行：核心交易循环 |
| `LIQUIDATING` | 正在清算：撤单 + 市价平仓中 |
| `LIQUIDATED` | ★终态：清算完成（止损/用户清算） |
| `TAKE_PROFIT` | ★终态：止盈达成 |
| `CANCELLED` | ★终态：追踪窗口关闭（价格没跌穿就回升，这次没建成仓） |
| `PAUSED` | 暂停（保留 runner，可恢复） |

> **三层状态怎么对应？** 用户操作（暂停/停止）从 ① 往下传：Robot 停止 → 调 session 级 stopBot/detachBot → runner 内 FSM 走向终态 → 终态回调 handleAutoTermination → 写 Run.state 终态 → 通知 Robot 清掉活跃箱。自动事件（止盈/止损）从 ③ 往上冒：FSM 进终态 → 写 Run 终态 → Robot 回到"监控中"等下一次激活。

---

## 3. 操作术语表（你最困惑的部分）

### 3.1 ⭐ stopBot vs detachBot（最容易混的两个）

两者**都**停掉 runner、撤掉这次回合自己挂的单；**区别只在持仓**：

| | **stopBot** | **detachBot** |
|---|---|---|
| 平仓？ | ✅ **平**：市价清掉持仓（清算）+ 交易所侧复核兜底强平 | ❌ **不平**：只撤单，持仓**留在交易所** |
| 持仓去向 | 清零 | 留着，等**下一个箱体激活时自动接管**（自愈） |
| Run 结束原因 | `USER_CLOSE`（单一写入口，不再 MANUAL/再覆写） | `USER_DETACH`；**系统切箱**时由 `activate` 覆写为 `SUPERSEDED`/`NEW_SESSION` |
| 典型场景 | 用户"停止并平仓"；删除活跃箱且选了平仓 | 切换箱体前先卸下旧回合；删活跃箱但保留持仓 |

一句话：**stopBot = 停 + 平仓；detachBot = 停 + 不平仓（把仓位交棒给下一个箱体）。**

### 3.2 ⭐ stop（停止）vs pause（暂停）

| | **stop（停止）** | **pause（暂停）** |
|---|---|---|
| Robot 终态？ | ✅ 是，进 STOPPED（结束这台机器人这一轮） | ❌ 否，进 PAUSED（只是停手） |
| 持仓 | 可选平掉（closePosition） | 保留 |
| runner | 关闭（清算或分离） | 保留在内存，可直接恢复 |
| 可恢复 | 不能"恢复"，只能重新启动机器人 | 调恢复即可继续 |
| 场景 | 不想跑了 | 临时停一下（看参数、等时机） |

### 3.3 robot 级 vs session 级操作

| 层 | 操作（方法名） | 干什么 |
|---|---|---|
| **Robot 级**（BotManagerService） | `startRobot` | 启动机器人：订阅行情、建调度器，进入"监控中" |
| | `pauseRobot` | 暂停机器人（保留持仓，可恢复） |
| | `requestStop` | **用户点停止的入口**：立即置 STOPPING 并后台异步跑停止 job |
| | `runStopJob` | **后台分阶段停止**：撤单→(平仓)→复核+抓快照→STOPPED |
| | `activate` | **激活箱体**：价格进窗口时，从"监控中"生出一个新 Run（调 session 级 startBot） |
| | `onBoxTerminated` | 回合自动结束时被回调，清掉活跃箱，回到"监控中" |
| | `restoreRobots` | 进程重启时恢复：RUNNING 的重建，STOPPING 的补跑完 |
| **Session 级**（TradingEngineService） | `startBot` | 启动一次回合：建 Run + GridBotRunner，开始交易 |
| | `stopBot` | 停回合 **+ 平仓清算**（返回"是否超时/是否有残留"） |
| | `detachBot` | 停回合 **+ 不平仓**（撤单，持仓留给下个箱体） |
| | `pauseBot` / `resumeBot` | 暂停/恢复回合（FSM 收到 USER_PAUSE/USER_RESUME） |
| | `captureStopSnapshot` | 停止收尾时**一次性 REST 抓一份持仓快照**（不依赖轮询器） |
| | `forceCloseResidualAfterStop` | 停止兜底：交易所侧复核，发现残留就强平 |

### 3.4 几个高频黑话

- **激活（activate）**：价格进入某箱体的"激活窗口"，把"监控中"变成"交易中"——生出一个新 Run/runner。决策由 `RobotScheduler` 逐 tick 做。
- **清算（liquidation）/ requestLiquidation**：撤掉所有单 + 市价平掉持仓，直到仓位归零。是 stopBot 平仓、以及止损的核心动作。
- **追踪建仓（TRAILING_ENTRY）**：不立刻开网格，先盯价格极值，等它回调 N%（默认 0.2%）再开，争取更好的入场点。
- **紧急止损算法单（emergency stop-loss）**：在止损价挂一条"价到就自动平仓"的交易所原生算法单，作为 runner 万一崩了的兜底保护。
- **监控中**：Robot=RUNNING 但没有活跃箱体——调度器在喂价、等下一次激活。这段时间没有 runner、没有实时 WS，前端最新价来自 robot 级轮询。
- **账户快照轮询**：每 10 秒 REST 拉一次账户余额+持仓存内存，供前端显示。**停止后该账户无 runner 了就停轮询**——这正是之前"停止前持仓数据可能不完整"误报的根（已改为停止时持久化一份快照）。

---

## 4. 把它串起来：一台机器人的一生

```
用户创建机器人（PAUSED）
   │ 加几个箱体（Box）
   │ 点"启动"
   ▼
Robot=RUNNING，订阅行情，建调度器 ──────────────► 【监控中】（无活跃箱）
                                                      │ 价格进入某箱激活窗口
                                                      ▼
                                              activate：生出 Run #1
                                              runner FSM: TRAILING_ENTRY→RUNNING
                                              （挂网格单、逐 tick 交易）
                                                      │
                          ┌───────────────────────────┼───────────────────────────┐
                          ▼                            ▼                           ▼
                   止盈 TAKE_PROFIT            止损 LIQUIDATED              用户暂停 PAUSED
                   （Run #1 终结）             （Run #1 终结）              （可恢复）
                          │                            │
                          └──────► 回到【监控中】◄──────┘
                                       │ 价格再进窗口 → Run #2、#3…（同一 Robot，多个回合）
                                       │
                                   用户点"停止"
                                       ▼
                              Robot=STOPPING
                              runStopJob: 撤单 → 平仓(可选) → 复核+抓快照
                                       ▼
                              Robot=STOPPED（带"停止前持仓"快照 + 可能的告警码）
```

---

## 5. 停止流程详解（新特性，理解 stopStage / stopWarning）

用户点"停止"后，后台 `runStopJob` 分三阶段推进，每阶段把进度写进 `robot.stopStage` 供前端轮询显示：

| stopStage | 这一步在干嘛 |
|---|---|
| `CANCELLING_ORDERS` | 撤销网格挂单（前端显示"正在撤销网格挂单…"） |
| `CLOSING_POSITION` | 市价平仓（仅当用户选了平仓；显示"正在平仓…"） |
| `VERIFYING` | 向交易所复核仓位 + 抓一份持仓快照写库（显示"正在复核仓位…"） |
| `null` | 已到终态 STOPPED |

如果过程不干净，落 STOPPED 时带一个 `stopWarning` 错误码（前端翻译成中文提示，**不卡死**）：

| stopWarning | 含义 |
|---|---|
| `LIQUIDATION_TIMEOUT` | 平仓 30 秒没完成，交易所可能还有仓，去核对 |
| `RESIDUAL_POSITION` | 复核后仍有残留、强平也失败，去手动平 |
| `SNAPSHOT_UNAVAILABLE` | 抓快照失败，停止前持仓数据可能不全 |
| `STOP_INTERRUPTED` | 停止过程被意外打断（兜底），去核对仓位与挂单 |

停止那一刻抓到的持仓会持久化到 Robot 表（`lastPositionQty / lastEntryPrice / lastUnrealizedPnl / lastSnapshotAt`），前端"停止前持仓"读这些**持久值**——所以停多久、刷多少次都准，不再像以前读会衰减的内存快照而误报"数据可能不完整"。

---

## 6. 速查表

| 词 | 一句话 |
|---|---|
| Robot | 长期机器人（账户×symbol，不区分方向）。状态 PAUSED/RUNNING/STOPPING/STOPPED |
| Box（箱体） | 一组网格参数。一台机器人多个箱，同时只一个活跃 |
| Run / session | 一次交易回合。一台机器人一生很多个 |
| GridBotRunner | 回合对应的内存执行引擎，内含 FSM |
| FSM | runner 内部逐 tick 决策的状态机，终态 LIQUIDATED/TAKE_PROFIT/CANCELLED |
| 激活 activate | 价格进窗口 →"监控中"生出一个回合 |
| start / pause | 启动 / 暂停（暂停可恢复、不平仓、不终结） |
| stop | 停止机器人（终态）。可选平仓 |
| stopBot | 停回合 **+ 平仓** |
| detachBot | 停回合 **+ 不平仓**（仓位交棒下个箱体） |
| 清算 liquidation | 撤单 + 市价平到仓位归零 |
| 账户快照轮询 | 每 10s 拉账户持仓；停止后停轮询 |

---

## 附：技术债 #2（统一 Run 终态写入口径）——已解决

历史问题：同一"撤单不平仓"动作经不同入口结束时，Run 的 `exitReason` 会落成不同值——`detachBot` 自己写 `DETACHED`，用户停止路径（runStopJob）又覆写成 `USER_DETACH`；平仓路径同理 `MANUAL` vs `USER_CLOSE`，报表口径分叉。

**决策与实现（2026-06-15，"按谁触发"统一）**：
- `stopBot`/`detachBot` 成为**单一终态写入口**，默认落 `STOPPED`/`USER_CLOSE`、`STOPPED`/`USER_DETACH`（不再 `MANUAL`/`DETACHED`，不再二次覆写）。
- **系统切箱**由 `activate` 传 `{SUPERSEDED, NEW_SESSION}` 覆写旧回合，区别于用户分离。
- `removeBox`/`editBox` 直接路径随默认值自动落 `USER_CLOSE`/`USER_DETACH`。
- `runStopJob` 去掉重复覆写，改为 `endedAt` 兜底（仅 runner 已消失/终态未落时补写）。
- 自动止盈止损 `TAKE_PROFIT`/`STOP_LOSS` 不变；追踪取消独立为 `CANCELLED`/`TRAILING_CANCELLED`（见 §2.2）。

背景与权衡详见历史快照 `docs/superpowers/specs/2026-06-13-run-terminal-state-ownership-followup.md`。

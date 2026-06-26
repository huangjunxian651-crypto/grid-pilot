# GridPilot 架构索引

> 完整策略规格见 `STRATEGY_SPEC.md`，本文件只列出代码组件到规格章节的映射。

## 核心模块（apps/api/src/modules/trading-engine）

| 模块 | 责任 | 规格章节 | 实现风格 |
|------|------|---------|---------|
| `pricing/` | 三区间定价 | §7.3 | 纯函数 |
| `strategy/` | 目标仓位计算（适用于所有区域） | §6 + §8 | 纯函数 |
| `fsm/` | 状态机 | §9 | 纯函数 |
| `runner/` | 副作用编排 + 串行化 | §7.6 | 状态类 |
| `exchange-truth-service/` | 交易所真相缓存 | §6.2 | 状态类 |
| `event-loop/` | 单消费者队列 | — | 状态类 |
| `reconstructor/` | 启动恢复 | §4.3 | 纯函数 |

## 参考实现

`~/Workspace/CEX/futures-grid-go`（Go）：当规格不清时以此为准。

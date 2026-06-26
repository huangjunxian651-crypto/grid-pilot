# Trading Engine 黑盒契约测试

## 定位

本目录下的测试 **只通过模块的公开导出 API** 验证行为，禁止：
- mock 模块内部实现
- 访问模块私有字段（即使 TypeScript 允许）
- 断言"调用了哪个内部函数"

每个 `.contract.spec.ts` 对应一个核心纯模块（pricing / strategy / fsm）。

## 命名约定

- `pricing.contract.spec.ts` → 测 `pricing/index.ts` 的导出函数
- `strategy.contract.spec.ts` → 测 `strategy/strategy-engine.ts`
- `fsm.contract.spec.ts` → 测 `fsm/bot-fsm.ts`

## 与 *.spec.ts 的区别

- `*.spec.ts`（与实现同级）：单元测试，可以 mock 依赖，验证私有分支
- `*.contract.spec.ts`（本目录）：黑盒契约，只走公开 API，断言对外可观察行为

当两者冲突时，**契约测试为准**：白盒测试若与契约冲突，说明实现错误或单元测试 over-specified。

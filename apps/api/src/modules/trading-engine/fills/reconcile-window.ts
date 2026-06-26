/**
 * 对账拉取的回滚窗口：起点 = max(0, 最后成交时间 − ROLLBACK)，而非直接取最后成交时间。
 * 原因（修复 I-1）：order-before-fill 竞态下，某成交可能在 Order 行落库前到达而被 ingest
 * 跳过；若其后又有成交落库，最后成交时间会越过被跳过的成交，使 getMyTrades(lastMs) 永远
 * 拉不回它。回滚窗口须 > sweep 间隔（60s），确保「上次 sweep 以来累积的全部成交」每次都
 * 被重拉，任何瞬时被跳过的成交在下次 sweep 必被幂等重摄入（按 tradeId 去重，零重复计数）。
 * 取 5 分钟，远超 60s 留足余量。
 *
 * 抽到中立模块：FillIngestionService（兜底补建的竞态宽限窗）与 FillReconcileService（重拉窗口）
 * 共用本常量以维系「宽限窗 ≥ 回滚窗」的正确性约束；二者互相依赖，故常量不能放在任一服务文件里
 * （否则形成 import 环破坏 NestJS DI）。
 */
export const RECONCILE_ROLLBACK_MS = 5 * 60_000;

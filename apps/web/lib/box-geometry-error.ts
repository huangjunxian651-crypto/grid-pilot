import { deriveBoxLines } from "@gridpilot/shared-types";

/** 校验失败时返回 i18n key（+ 可选占位符参数）；调用方用 t(key, params) 翻译。 */
export type BoxGeometryError = { key: string; params?: Record<string, string | number> };

/**
 * 箱体几何客户端预校验（LONG/SHORT 通用）。
 * 必须与后端 validateBoxGeometry 用户面规则保持一致——否则会重现"前端通过、后端 400"的割裂。
 * isolationStep 为独立参数，缺省回退 stopLossGridStep。
 * 返回首条错误的 i18n key（+ 占位符参数），或 null（通过）。激活价范围校验在弹窗另行处理。
 */
export function boxGeometryError(input: {
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep?: number;
}): BoxGeometryError | null {
  const direction = input.direction === "SHORT" ? ("SHORT" as const) : ("LONG" as const);
  const config = {
    takeProfitPrice: input.takeProfitPrice,
    direction,
    mainGridCount: input.mainGridCount,
    mainGridStep: input.mainGridStep,
    stopLossGridCount: input.stopLossGridCount,
    stopLossGridStep: input.stopLossGridStep,
    isolationStep: input.isolationStep ?? input.stopLossGridStep,
  };

  if (!(config.takeProfitPrice > 0)) return { key: "robot.geo_take_profit_positive" };
  if (!(config.mainGridCount > 0)) return { key: "robot.geo_grid_count_positive" };
  if (!(config.mainGridStep > 0)) return { key: "robot.geo_grid_step_positive" };
  if (config.stopLossGridCount > 0 && !(config.stopLossGridStep > 0)) return { key: "robot.geo_sl_step_positive" };
  if (config.stopLossGridCount > 0 && !(config.isolationStep > 0)) return { key: "robot.geo_isolation_positive" };

  const lines = deriveBoxLines(config);
  const stopLossRange = config.stopLossGridCount * config.stopLossGridStep;
  if (stopLossRange > 0 && stopLossRange > lines.boxDepth / 5) {
    return { key: "robot.geo_sl_range_exceeds", params: { range: stopLossRange, limit: lines.boxDepth / 5 } };
  }
  if (lines.boxLowPrice <= 0) return { key: "robot.geo_box_low_positive" };

  return null;
}

// ── 归一化箱体几何核心（d 空间单实现）────────────────────────────
// 设计文档：docs/superpowers/specs/2026-06-10-short-box-geometry-design.md
//
// 坐标定义：d = 价格离止盈端（takeProfitPrice）的有向距离，亏损方向为正。
// direction 分支只允许出现在 toDistance/toPrice 两个映射函数里；
// 其余所有几何逻辑都在 d 空间单实现，LONG/SHORT 自动镜像。

export type BoxDirection = "LONG" | "SHORT";

/** toDistance/toPrice 只需要的最小锚点信息 */
export interface DirectionAnchor {
  takeProfitPrice: number;
  direction: BoxDirection;
}

export interface BoxGeometryConfig extends DirectionAnchor {
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
}

export interface BoxTargetConfig extends BoxGeometryConfig {
  mainGridPortionSize: number;
}

export function toDistance(price: number, anchor: DirectionAnchor): number {
  return anchor.direction === "LONG"
    ? anchor.takeProfitPrice - price
    : price - anchor.takeProfitPrice;
}

export function toPrice(distance: number, anchor: DirectionAnchor): number {
  return anchor.direction === "LONG"
    ? anchor.takeProfitPrice - distance
    : anchor.takeProfitPrice + distance;
}

export interface BoxLines {
  // d 空间标量（非负，方向无关）
  mainGridDepth: number;
  isolationEndDepth: number;
  boxDepth: number;
  // 结构线（绝对价格，沿亏损方向依次）
  takeProfitPrice: number;
  fullPositionPrice: number;
  stopLossStartPrice: number;
  liquidationPrice: number;
  // 展示/重叠校验用绝对边界
  boxHighPrice: number;
  boxLowPrice: number;
}

export function deriveBoxLines(config: BoxGeometryConfig): BoxLines {
  const mainGridDepth = config.mainGridCount * config.mainGridStep;
  const isolationEndDepth = mainGridDepth + config.isolationStep;
  const boxDepth =
    isolationEndDepth + config.stopLossGridCount * config.stopLossGridStep;
  const takeProfitPrice = config.takeProfitPrice;
  const fullPositionPrice = toPrice(mainGridDepth, config);
  const stopLossStartPrice = toPrice(isolationEndDepth, config);
  const liquidationPrice = toPrice(boxDepth, config);
  return {
    mainGridDepth,
    isolationEndDepth,
    boxDepth,
    takeProfitPrice,
    fullPositionPrice,
    stopLossStartPrice,
    liquidationPrice,
    boxHighPrice: Math.max(takeProfitPrice, liquidationPrice),
    boxLowPrice: Math.min(takeProfitPrice, liquidationPrice),
  };
}

export type BoxZone =
  | "MAIN"
  | "ISOLATION"
  | "STOP_LOSS"
  | "PROFIT_EXIT"
  | "LOSS_EXIT";

export interface BoxTargetPosition {
  targetBoughtSize: number;
  targetHoldSize: number;
  gridIndex: number;
  zone: BoxZone;
  lines: BoxLines;
}

const FLOOR_EPSILON = 1e-9;

/**
 * 统一仓位计算（d 空间单实现）。
 * 行为基线：与旧 computeLong（apps/api strategy/compute-target-position.ts）逐点一致；
 * SHORT 为其镜像。区间开闭见设计文档 §3。
 */
export function computeTargetPosition(
  price: number,
  config: BoxTargetConfig,
): BoxTargetPosition {
  const lines = deriveBoxLines(config);
  const d = toDistance(price, config);
  const {
    mainGridCount,
    mainGridStep,
    mainGridPortionSize,
    stopLossGridCount,
    stopLossGridStep,
  } = config;
  const baseSize = mainGridCount * mainGridPortionSize;
  const stopLossPortionSize =
    stopLossGridCount > 0 ? baseSize / stopLossGridCount : 0;

  let targetBoughtSize: number;
  let targetHoldSize: number;
  let gridIndex: number;
  let zone: BoxZone;

  if (d <= 0) {
    targetBoughtSize = 0;
    targetHoldSize = 0;
    gridIndex = -1;
    zone = "PROFIT_EXIT";
  } else if (stopLossGridCount > 0) {
    if (d <= lines.isolationEndDepth) {
      const grids = Math.floor(d / mainGridStep + FLOOR_EPSILON);
      targetBoughtSize = Math.min(mainGridCount, grids) * mainGridPortionSize;
      targetHoldSize =
        d < lines.mainGridDepth
          ? Math.max(0, grids + 1) * mainGridPortionSize
          : baseSize;
      gridIndex = grids;
      zone = d < lines.mainGridDepth ? "MAIN" : "ISOLATION";
    } else if (d < lines.boxDepth) {
      const slGrids = Math.floor(
        (lines.boxDepth - d) / stopLossGridStep + FLOOR_EPSILON,
      );
      targetBoughtSize = slGrids * stopLossPortionSize;
      targetHoldSize =
        Math.min(stopLossGridCount, slGrids + 1) * stopLossPortionSize;
      gridIndex = mainGridCount + slGrids;
      zone = "STOP_LOSS";
    } else {
      targetBoughtSize = 0;
      targetHoldSize = 0;
      gridIndex = mainGridCount + stopLossGridCount;
      zone = "LOSS_EXIT";
    }
  } else {
    if (d <= lines.boxDepth) {
      const grids = Math.floor(d / mainGridStep + FLOOR_EPSILON);
      targetBoughtSize = Math.min(mainGridCount, grids) * mainGridPortionSize;
      targetHoldSize = Math.max(0, grids + 1) * mainGridPortionSize;
      gridIndex = grids;
      zone = d < lines.mainGridDepth ? "MAIN" : "ISOLATION";
    } else {
      // 无止损模式：越过箱体亏损端保持满仓硬扛（现行为，见设计文档 §3）
      targetBoughtSize = baseSize;
      targetHoldSize = baseSize;
      gridIndex = mainGridCount;
      zone = "LOSS_EXIT";
    }
  }

  return {
    targetBoughtSize: Math.min(targetBoughtSize, baseSize),
    targetHoldSize: Math.min(targetHoldSize, baseSize),
    gridIndex,
    zone,
    lines,
  };
}

// ── Zone 边界索引（旧 which-zone.ts 的 d 空间版） ────────────────

export function buildBoundaryDistances(config: BoxGeometryConfig): number[] {
  const lines = deriveBoxLines(config);
  const distances: number[] = [0];
  for (let i = 1; i <= config.mainGridCount; i++) {
    distances.push(i * config.mainGridStep);
  }
  if (config.isolationStep > 0) {
    distances.push(lines.isolationEndDepth);
  }
  for (let i = 1; i <= config.stopLossGridCount; i++) {
    distances.push(lines.isolationEndDepth + i * config.stopLossGridStep);
  }
  return distances;
}

export function whichZoneFromDistances(
  d: number,
  boundaryDistances: number[],
): number {
  for (let i = 0; i < boundaryDistances.length; i++) {
    if (d <= boundaryDistances[i]) return i;
  }
  return boundaryDistances.length;
}

export function whichZone(price: number, config: BoxGeometryConfig): number {
  return whichZoneFromDistances(
    toDistance(price, config),
    buildBoundaryDistances(config),
  );
}

// ── 网格索引 ↔ 价格映射（旧 index-utils / stop-loss-utils 的 d 空间版） ──
// 交易角色：reduce = 向止盈端的格边（LONG 卖出 / SHORT 买回），
//           add    = 向亏损端的格边（LONG 买入 / SHORT 加空）。

function assertIndexInRange(
  fieldName: string,
  index: number,
  max: number,
): void {
  if (index < 0 || index > max) {
    throw new Error(
      `Invalid ${fieldName}: ${index}, valid range is [0, ${max}]`,
    );
  }
}

// grid buy/sell 共用的深度对：gridIndex 在隔离端点(mainGridCount)取 lines 深度，否则按 step 递推。
function gridLineDepths(
  gridIndex: number,
  config: BoxGeometryConfig,
  lines: ReturnType<typeof deriveBoxLines>,
): { reduceDepth: number; addDepth: number } {
  const reduceDepth =
    gridIndex === config.mainGridCount ? lines.isolationEndDepth : gridIndex * config.mainGridStep;
  const addDepth =
    gridIndex === config.mainGridCount ? lines.mainGridDepth : (gridIndex + 1) * config.mainGridStep;
  return { reduceDepth, addDepth };
}

// stop-loss buy/sell 共用的深度对（仅非隔离路径；隔离端点由各函数 early-return 处理）。
function stopLossLineDepths(
  stopLossIndex: number,
  config: BoxGeometryConfig,
  lines: ReturnType<typeof deriveBoxLines>,
): { reduceDepth: number; addDepth: number } {
  const reduceDepth = lines.boxDepth - stopLossIndex * config.stopLossGridStep;
  const addDepth = lines.boxDepth - (stopLossIndex + 1) * config.stopLossGridStep;
  return { reduceDepth, addDepth };
}

export function gridIndexToBuyPrice(gridIndex: number, config: BoxGeometryConfig): number {
  assertIndexInRange("gridIndex", gridIndex, config.mainGridCount);
  const lines = deriveBoxLines(config);
  const { reduceDepth, addDepth } = gridLineDepths(gridIndex, config, lines);
  return config.direction === "LONG" ? toPrice(addDepth, config) : toPrice(reduceDepth, config);
}

export function gridIndexToSellPrice(gridIndex: number, config: BoxGeometryConfig): number {
  assertIndexInRange("gridIndex", gridIndex, config.mainGridCount);
  const lines = deriveBoxLines(config);
  const { reduceDepth, addDepth } = gridLineDepths(gridIndex, config, lines);
  return config.direction === "LONG" ? toPrice(reduceDepth, config) : toPrice(addDepth, config);
}

export function priceToGridIndex(
  price: number,
  config: BoxGeometryConfig,
): number | null {
  const lines = deriveBoxLines(config);
  const d = toDistance(price, config);
  if (d < 0) return null;
  if (d >= lines.boxDepth) return null;
  if (d < lines.mainGridDepth) {
    return Math.floor(d / config.mainGridStep + FLOOR_EPSILON);
  }
  if (d < lines.isolationEndDepth) return config.mainGridCount;
  return null;
}

export function stopLossIndexToBuyPrice(stopLossIndex: number, config: BoxGeometryConfig): number {
  assertIndexInRange("stopLossIndex", stopLossIndex, config.stopLossGridCount);
  const lines = deriveBoxLines(config);
  if (stopLossIndex === config.stopLossGridCount) {
    // 隔离区（旧行为：LONG buy=liquidationPrice，SHORT buy=liquidationPrice，d 空间统一为 boxDepth）
    return toPrice(lines.boxDepth, config);
  }
  const { reduceDepth, addDepth } = stopLossLineDepths(stopLossIndex, config, lines);
  return config.direction === "LONG" ? toPrice(addDepth, config) : toPrice(reduceDepth, config);
}

export function stopLossIndexToSellPrice(stopLossIndex: number, config: BoxGeometryConfig): number {
  assertIndexInRange("stopLossIndex", stopLossIndex, config.stopLossGridCount);
  const lines = deriveBoxLines(config);
  if (stopLossIndex === config.stopLossGridCount) {
    // 隔离区（旧行为：LONG sell=stopLossStartPrice，SHORT sell=takeProfitPrice，d 空间统一为 isolationEndDepth）
    return toPrice(lines.isolationEndDepth, config);
  }
  const { reduceDepth, addDepth } = stopLossLineDepths(stopLossIndex, config, lines);
  return config.direction === "LONG" ? toPrice(reduceDepth, config) : toPrice(addDepth, config);
}

export function priceToStopLossIndex(
  price: number,
  config: BoxGeometryConfig,
): number | null {
  const lines = deriveBoxLines(config);
  const d = toDistance(price, config);
  if (d >= lines.boxDepth) return null;
  if (d <= lines.mainGridDepth) return null;
  if (d < lines.isolationEndDepth) return config.stopLossGridCount;
  return Math.floor((lines.boxDepth - d) / config.stopLossGridStep + FLOOR_EPSILON);
}

// ── 校验 ─────────────────────────────────────────────────────────

export interface BoxValidation {
  valid: boolean;
  errors: string[];
}

export function validateBoxGeometry(
  config: BoxGeometryConfig & { activationPrice?: number },
): BoxValidation {
  const errors: string[] = [];

  if (!(config.takeProfitPrice > 0)) {
    errors.push(`takeProfitPrice (${config.takeProfitPrice}) must be > 0`);
  }
  if (config.mainGridCount <= 0) {
    errors.push(`mainGridCount (${config.mainGridCount}) must be > 0`);
  }
  if (config.mainGridStep <= 0) {
    errors.push(`mainGridStep (${config.mainGridStep}) must be > 0`);
  }
  if (config.stopLossGridCount > 0 && config.stopLossGridStep <= 0) {
    errors.push(
      `stopLossGridStep (${config.stopLossGridStep}) must be > 0 when stop-loss is enabled`,
    );
  }
  if (config.stopLossGridCount > 0 && config.isolationStep <= 0) {
    errors.push(
      `isolationStep (${config.isolationStep}) must be > 0 when stop-loss is enabled`,
    );
  }
  if (errors.length > 0) return { valid: false, errors };

  const lines = deriveBoxLines(config);
  const stopLossRange = config.stopLossGridCount * config.stopLossGridStep;
  if (stopLossRange > 0 && stopLossRange > lines.boxDepth / 5) {
    errors.push(
      `stop-loss range (${stopLossRange}) exceeds 1/5 of total range (${lines.boxDepth / 5})`,
    );
  }
  if (lines.boxLowPrice <= 0) {
    errors.push(`box low price (${lines.boxLowPrice}) must be > 0`);
  }
  if (config.activationPrice != null && config.activationPrice > 0) {
    const activationDepth = toDistance(config.activationPrice, config);
    if (!(activationDepth > 0 && activationDepth < lines.mainGridDepth)) {
      errors.push(
        `activationPrice (${config.activationPrice}) must be within main grid ` +
          `(${Math.min(lines.takeProfitPrice, lines.fullPositionPrice)}, ${Math.max(lines.takeProfitPrice, lines.fullPositionPrice)})`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── 动作预测（d 空间单实现） ─────────────────────────────────────

export interface PredictAction {
  price: number;
  side: "BUY" | "SELL" | "HOLD";
  qty: number;
  zone: "MAIN" | "STOP_LOSS" | "ISOLATION";
}

export interface PredictInput extends BoxTargetConfig {
  price: number;
  /** 有符号持仓：LONG ≥ 0，SHORT ≤ 0（内部归一化为幅值） */
  positionQty: number;
}

export interface PredictResult {
  actions: PredictAction[];
  nearestBuy: PredictAction | null;
  nearestSell: PredictAction | null;
  fsmTriggers: {
    takeProfit: number;
    enterStopLoss: number;
    liquidate: number;
  };
}

export function predictActions(input: PredictInput): PredictResult {
  const {
    mainGridCount,
    mainGridStep,
    mainGridPortionSize,
    stopLossGridCount,
    stopLossGridStep,
    direction,
    price,
  } = input;
  const lines = deriveBoxLines(input);
  const baseSize = mainGridCount * mainGridPortionSize;
  const stopLossPortionSize =
    stopLossGridCount > 0 ? baseSize / stopLossGridCount : 0;
  const eps = 1e-8;
  const positionSize =
    direction === "LONG" ? input.positionQty : -input.positionQty;

  const sideFor = (role: "reduce" | "add"): "BUY" | "SELL" =>
    direction === "LONG"
      ? role === "reduce" ? "SELL" : "BUY"
      : role === "reduce" ? "BUY" : "SELL";

  const targetsAt = (
    d: number,
    zone: "MAIN" | "SL",
  ): { tB: number; tH: number } => {
    if (zone === "SL") {
      const slGrids = Math.floor(
        (lines.boxDepth - d) / stopLossGridStep + FLOOR_EPSILON,
      );
      return {
        tB: slGrids * stopLossPortionSize,
        tH: Math.min(stopLossGridCount, slGrids + 1) * stopLossPortionSize,
      };
    }
    const grids = Math.floor(d / mainGridStep + FLOOR_EPSILON);
    const tB = Math.min(mainGridCount, grids) * mainGridPortionSize;
    const tH =
      d < lines.mainGridDepth - eps
        ? Math.max(0, grids + 1) * mainGridPortionSize
        : baseSize;
    return { tB, tH };
  };

  const classify = (
    tB: number,
    tH: number,
  ): { side: "BUY" | "SELL" | "HOLD"; qty: number } => {
    if (positionSize > tH + eps) return { side: sideFor("reduce"), qty: positionSize - tH };
    if (positionSize < tB - eps) return { side: sideFor("add"), qty: tB - positionSize };
    return { side: "HOLD", qty: 0 };
  };

  const actions: PredictAction[] = [];
  for (let i = 0; i <= mainGridCount; i++) {
    const dLine = i * mainGridStep;
    const { tB, tH } = targetsAt(dLine, "MAIN");
    const { side, qty } = classify(tB, tH);
    actions.push({ price: toPrice(dLine, input), side, qty, zone: "MAIN" });
  }
  if (stopLossGridCount > 0) {
    for (let i = 0; i < stopLossGridCount; i++) {
      const dLine = lines.isolationEndDepth + i * stopLossGridStep;
      const { tB, tH } = targetsAt(dLine, "SL");
      const { side, qty } = classify(tB, tH);
      actions.push({ price: toPrice(dLine, input), side, qty, zone: "STOP_LOSS" });
    }
  }
  actions.sort((a, b) => b.price - a.price);

  // nearest 搜索：模拟"价格刚越过这条线"。reduce 线在止盈方向（d 更小），
  // add 线在亏损方向（d 更大）。遍历顺序复刻旧 LONG 实现。
  const dPrice = toDistance(price, input);
  const nudge = Math.max(mainGridStep * 0.01, eps * 10);
  const slNudge = Math.max(stopLossGridStep * 0.01, eps * 10);
  let nearestReduce: PredictAction | null = null;
  let nearestAdd: PredictAction | null = null;

  {
    const startI = Math.max(1, Math.floor(dPrice / mainGridStep));
    for (let i = startI; i >= 1; i--) {
      const dLine = i * mainGridStep;
      if (dLine >= dPrice) continue;
      const { tH } = targetsAt(dLine - nudge, "MAIN");
      if (positionSize > tH + eps) {
        nearestReduce = {
          price: toPrice(dLine, input),
          side: sideFor("reduce"),
          qty: positionSize - tH,
          zone: "MAIN",
        };
        break;
      }
    }
  }
  if (!nearestReduce && stopLossGridCount > 0) {
    for (let i = 0; i < stopLossGridCount; i++) {
      const dLine = lines.isolationEndDepth + i * stopLossGridStep;
      if (dLine >= dPrice) continue;
      const { tH } = targetsAt(dLine - slNudge, "SL");
      if (positionSize > tH + eps) {
        nearestReduce = {
          price: toPrice(dLine, input),
          side: sideFor("reduce"),
          qty: positionSize - tH,
          zone: "STOP_LOSS",
        };
        break;
      }
    }
  }
  for (let i = 1; i <= mainGridCount; i++) {
    const dLine = i * mainGridStep;
    if (dLine <= dPrice) continue;
    const { tB } = targetsAt(dLine + nudge, "MAIN");
    if (positionSize < tB - eps) {
      nearestAdd = {
        price: toPrice(dLine, input),
        side: sideFor("add"),
        qty: tB - positionSize,
        zone: "MAIN",
      };
      break;
    }
  }
  if (!nearestAdd && stopLossGridCount > 0) {
    for (let i = 0; i < stopLossGridCount; i++) {
      const dLine = lines.isolationEndDepth + i * stopLossGridStep;
      if (dLine <= dPrice) continue;
      const { tB } = targetsAt(dLine + slNudge, "SL");
      if (positionSize < tB - eps) {
        nearestAdd = {
          price: toPrice(dLine, input),
          side: sideFor("add"),
          qty: tB - positionSize,
          zone: "STOP_LOSS",
        };
        break;
      }
    }
  }

  return {
    actions,
    nearestBuy: direction === "LONG" ? nearestAdd : nearestReduce,
    nearestSell: direction === "LONG" ? nearestReduce : nearestAdd,
    fsmTriggers: {
      takeProfit: lines.takeProfitPrice,
      enterStopLoss: lines.fullPositionPrice,
      liquidate: lines.liquidationPrice,
    },
  };
}

import {
  deriveBoxLines,
  validateBoxGeometry,
  minOrderSizeRequirement,
  isStepAligned,
  nearestStepAlignedValue,
  type BoxGeometryConfig,
  type OrderSizeConstraints,
} from '@gridpilot/shared-types';

export interface BoxSpec {
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  activationPrice?: number;
  mainGridPortionSize?: number;
}

/** 交易所最小下单量约束，供最小下单量预校验使用；获取失败时上游传 undefined/null 跳过该项。
 * 复用 shared-types 的 OrderSizeConstraints，不再重复声明同形状接口。 */
export type MarketConstraints = OrderSizeConstraints;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function toGeometry(spec: BoxSpec): BoxGeometryConfig {
  return {
    takeProfitPrice: spec.takeProfitPrice,
    direction: spec.direction === 'SHORT' ? 'SHORT' : 'LONG',
    mainGridCount: spec.mainGridCount,
    mainGridStep: spec.mainGridStep,
    stopLossGridCount: spec.stopLossGridCount,
    stopLossGridStep: spec.stopLossGridStep,
    isolationStep: spec.isolationStep,
  };
}

/**
 * 校验向某 robot 新增一个箱体（LONG/SHORT，d 空间归一化）。强制：direction 一致、箱体自身有效、
 * 与现有箱不重叠、止损不变量（除唯一的亏损边缘箱外每箱必须有止损）。
 * 规则源：spec §六、§12.1；设计文档 docs/superpowers/specs/2026-06-10-short-box-geometry-design.md。
 */
export function validateBoxAddition(
  newBox: BoxSpec,
  existingBoxes: BoxSpec[],
  robotDirection: string,
  marketConstraints?: MarketConstraints | null,
): ValidationResult {
  const errors: string[] = [];

  // 1. direction 一致
  if (newBox.direction !== robotDirection) {
    errors.push(`box direction (${newBox.direction}) must match robot direction (${robotDirection})`);
  }

  // 2. 箱体自身有效
  const geomCheck = validateBoxGeometry({ ...toGeometry(newBox), activationPrice: newBox.activationPrice });
  if (!geomCheck.valid) {
    errors.push(...geomCheck.errors);
  }

  const nb = deriveBoxLines(toGeometry(newBox));

  // 2.5 最小下单量：按箱体真实最低价（nb.boxLowPrice）折算名义价值，不用实时价，再按
  // stepSize 向上取整（交易所下单会把数量向下截断到 stepSize 整数倍，不取整则用户填入的
  // 值即便过了未取整的理论最小值，截断后名义价值仍可能跌破门槛）。见 minOrderSizeRequirement。
  if (marketConstraints && newBox.mainGridPortionSize != null && newBox.mainGridPortionSize > 0) {
    const portionSize = newBox.mainGridPortionSize;
    const minRequired = minOrderSizeRequirement(nb.boxLowPrice, marketConstraints);
    if (portionSize < minRequired) {
      errors.push(
        `order size ${portionSize} below exchange minimum at box low price ${nb.boxLowPrice} ` +
          `(minQty=${marketConstraints.minQty}, minNotional=${marketConstraints.minNotional}, ` +
          `stepSize=${marketConstraints.stepSize}, suggested>=${minRequired})`,
      );
    }
    // 每格量须为 stepSize 整数倍：策略引擎按「目标持仓(格数×portionSize) − 实际持仓」下单，
    // 下单量向 stepSize 截断；若 portionSize 本身不是 stepSize 整数倍，奇偶网格档位会周期性
    // 截掉半个 stepSize，导致累计持仓与网格线脱节，avg-grid-price 按持仓反推的归属线跨格
    // 加权到错误的价格，产生虚假的负「Alpha 超额」（非真实滑点损失，是统计口径错位）。
    const { stepSize } = marketConstraints;
    if (!isStepAligned(portionSize, stepSize)) {
      errors.push(
        `order size ${portionSize} is not a multiple of exchange stepSize ${stepSize} ` +
          `(nearest valid value ${nearestStepAlignedValue(portionSize, stepSize)})`,
      );
    }
  }

  // 3. 不重叠（边界相接不算）
  for (const e of existingBoxes) {
    const eb = deriveBoxLines(toGeometry(e));
    const noOverlap = nb.boxHighPrice <= eb.boxLowPrice || eb.boxHighPrice <= nb.boxLowPrice;
    if (!noOverlap) {
      errors.push(`box [${nb.boxLowPrice}, ${nb.boxHighPrice}] overlaps existing box [${eb.boxLowPrice}, ${eb.boxHighPrice}]`);
    }
  }

  // 4. 止损不变量：全集里除亏损边缘箱外每箱必须有止损
  // 亏损边缘箱 = 离止盈端最远的箱（LONG: boxLowPrice 最小；SHORT: boxHighPrice 最大）
  const all = [...existingBoxes, newBox];
  let lossMost = all[0];
  for (const b of all) {
    const bl = deriveBoxLines(toGeometry(b));
    const ml = deriveBoxLines(toGeometry(lossMost));
    const moreLossWard = robotDirection === 'SHORT'
      ? bl.boxHighPrice > ml.boxHighPrice
      : bl.boxLowPrice < ml.boxLowPrice;
    if (moreLossWard) lossMost = b;
  }
  for (const b of all) {
    if (b !== lossMost && b.stopLossGridCount <= 0) {
      const bLines = deriveBoxLines(toGeometry(b));
      errors.push(
        `non-loss-edge box [${bLines.boxLowPrice}, ${bLines.boxHighPrice}] must have stop-loss (stopLossGridCount > 0)`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

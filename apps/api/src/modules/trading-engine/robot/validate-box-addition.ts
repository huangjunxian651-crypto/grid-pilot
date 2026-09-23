import {
  deriveBoxLines,
  validateBoxGeometry,
  minOrderValueRequirement,
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

  // 2.5 最小下单量：输入值现在是每格 USDT 名义价值；按箱体最低价校验，即使
  // 价格走到箱体底部，换算成基础币数量并按 stepSize 截断后仍能通过交易所门槛。
  if (marketConstraints && newBox.mainGridPortionSize != null && newBox.mainGridPortionSize > 0) {
    const portionValue = newBox.mainGridPortionSize;
    const minRequired = minOrderValueRequirement(nb.boxLowPrice, marketConstraints);
    if (portionValue < minRequired) {
      errors.push(
        `order value ${portionValue} USDT below exchange minimum at box low price ${nb.boxLowPrice} ` +
          `(minQty=${marketConstraints.minQty}, minNotional=${marketConstraints.minNotional}, ` +
          `stepSize=${marketConstraints.stepSize}, suggested>=${minRequired})`,
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

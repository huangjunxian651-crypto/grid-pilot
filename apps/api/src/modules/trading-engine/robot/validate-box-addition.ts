import { deriveBoxLines, validateBoxGeometry, type BoxGeometryConfig } from '@gridpilot/shared-types';

export interface BoxSpec {
  direction: string;
  takeProfitPrice: number;
  mainGridCount: number;
  mainGridStep: number;
  stopLossGridCount: number;
  stopLossGridStep: number;
  isolationStep: number;
  activationPrice?: number;
}

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

  // 3. 不重叠（边界相接不算）
  const nb = deriveBoxLines(toGeometry(newBox));
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

import { BadRequestException } from "@nestjs/common";

/**
 * 将箱体验证错误数组映射为语义化错误码。
 *
 * 映射优先级（从具体到笼统）：
 * 1. 重叠 → BOX_OVERLAP
 * 2. 方向不一致 → BOX_DIRECTION_MISMATCH
 * 3. 止损缺失 → BOX_STOPLOSS_REQUIRED
 * 4. 几何/网格参数非法 → BOX_GEOMETRY_INVALID
 * 5. 其他 → BOX_VALIDATION_FAILED
 *
 * 规则源：spec §六、§12.1
 */
export function mapBoxValidationError(errors: string[]): {
  code: string;
  message: string;
} {
  if (!errors.length) {
    return { code: "BOX_VALIDATION_FAILED", message: "" };
  }

  const errorStr = errors.join("; ");

  // 按优先级匹配
  if (errors.some((e) => e.includes("overlaps"))) {
    return { code: "BOX_OVERLAP", message: errorStr };
  }
  if (errors.some((e) => e.includes("direction"))) {
    return { code: "BOX_DIRECTION_MISMATCH", message: errorStr };
  }
  if (errors.some((e) => e.includes("stop-loss"))) {
    return { code: "BOX_STOPLOSS_REQUIRED", message: errorStr };
  }
  // 几何参数非法：takeProfitPrice / mainGridCount / mainGridStep / stopLossGridStep
  // 或止损范围过大 / boxLowPrice <= 0 / activationPrice 越界
  if (
    errors.some(
      (e) =>
        e.includes("takeProfitPrice") ||
        e.includes("mainGridCount") ||
        e.includes("mainGridStep") ||
        e.includes("stopLossGridStep") ||
        e.includes("stop-loss range") ||
        e.includes("box low price") ||
        e.includes("activationPrice") ||
        e.includes("grid"),
    )
  ) {
    return { code: "BOX_GEOMETRY_INVALID", message: errorStr };
  }

  return { code: "BOX_VALIDATION_FAILED", message: errorStr };
}

/**
 * 抛出带语义化错误码的 BadRequestException。
 * 供 bot-manager.service.ts addBox / editBox 共用。
 */
export function throwBoxValidationError(errors: string[]): never {
  const { code, message } = mapBoxValidationError(errors);
  throw new BadRequestException({
    code,
    message: `Box validation failed: ${message}`,
  });
}

/**
 * 盈亏相对「当前占用保证金」的回报率。
 *
 * 占用保证金 = |持仓数量| × 当前价 ÷ 杠杆
 *
 * 口径只在此处定义，三个展示位（机器人列表、详情活跃箱、仪表盘）统一调用，
 * 不得各自重算——同一公式散落多处会导致口径漂移。
 */

/**
 * 保证金下限。低于此值不显示百分比：网格平仓时持仓逐格趋近 0，分母随之趋近 0，
 * 百分比会爆炸（0.001 ETH 时保证金约 0.09 USDT，+9 盈亏显示成 +10000%），
 * 且越接近平仓成功数字越离谱。归入「分母不可用」，与空仓同一条规则。
 */
export const MIN_MARGIN_USDT = 1;

export function computeMarginRoi(params: {
  pnl: number;
  positionQty: number | null | undefined;
  price: number | null | undefined;
  leverage: number | null | undefined;
}): number | null {
  const { pnl, positionQty, price, leverage } = params;

  if (positionQty == null || price == null || leverage == null) return null;
  if (!Number.isFinite(pnl)) return null;
  if (!Number.isFinite(positionQty) || !Number.isFinite(price) || !Number.isFinite(leverage)) return null;
  if (leverage <= 0 || price <= 0) return null;

  const margin = (Math.abs(positionQty) * price) / leverage;
  if (margin < MIN_MARGIN_USDT) return null;

  return (pnl / margin) * 100;
}

/**
 * 回报率 → 展示串；不可计算时为占位符 —。
 * 取符号用的是**四舍五入后**的值：-0.04 四舍五入后为 0，应显示 +0.0% 而非
 * -0.0%（资金界面上后者读作缺陷）。
 */
export function formatMarginRoi(roi: number | null): string {
  if (roi == null) return "—";
  const rounded = Number(roi.toFixed(1));
  return `${rounded >= 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}%`;
}

/**
 * 机器人列表项的未实现盈亏回报率展示串。仪表盘与列表页共用同一取值口径，
 * 避免两处各自拼装 computeMarginRoi 的入参时字段取错。
 * 不可计算时返回 null（调用方据此完全不渲染节点，而非显示占位符）。
 */
export function robotUnrealizedRoiText(robot: {
  lastUnrealizedPnl: number | null | undefined;
  lastPositionQty: number | null | undefined;
  latestPrice: number | null | undefined;
  activeBoxLeverage: number | null | undefined;
}): string | null {
  if (robot.lastUnrealizedPnl == null) return null;
  const roi = computeMarginRoi({
    pnl: robot.lastUnrealizedPnl,
    positionQty: robot.lastPositionQty,
    price: robot.latestPrice,
    leverage: robot.activeBoxLeverage,
  });
  return roi == null ? null : formatMarginRoi(roi);
}

/**
 * 详情页箱体回报率展示串。非活跃箱恒为 null——它展示的是纯 netPnl（历史累积、
 * 未实现恒为 0、无当前持仓），套用实时保证金分母会是错误口径。
 * 不可计算时返回 null（调用方据此完全不渲染节点，而非显示占位符）。
 */
export function activeBoxRoiText(
  pnl: number,
  isActive: boolean,
  live: { positionQty?: number | null; price?: number | null; leverage?: number | null } | null | undefined,
): string | null {
  if (!isActive || !live) return null;
  const roi = computeMarginRoi({ pnl, positionQty: live.positionQty, price: live.price, leverage: live.leverage });
  return roi == null ? null : formatMarginRoi(roi);
}

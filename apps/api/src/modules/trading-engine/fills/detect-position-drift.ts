/**
 * 判断 DB 推算持仓与交易所真实持仓是否出现"需要告警"的漂移。
 * 阈值取该机器人自己的 mainGridPortionSize（每格最小下单量），差值严格大于阈值才算漂移，
 * 恰好等于阈值不算（避免浮点边界抖动误报）。
 */
export function detectPositionDrift(
  dbSignedQty: number,
  exchangeSignedQty: number,
  minPortionSize: number,
): boolean {
  return Math.abs(dbSignedQty - exchangeSignedQty) > minPortionSize + 1e-9;
}

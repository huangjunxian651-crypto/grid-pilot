// 共享 fixtures：直接来源于 STRATEGY_SPEC.md 的示例数据
// 修改任何一组数据前必须先在 STRATEGY_SPEC.md 找到对应章节并核实

export const ETH_RANGE_1 = {
  configId: 'range-1',
  symbol: 'ETH_USDT',
  direction: 'LONG' as const,
  takeProfitPrice: 2800,
  mainGridCount: 235,
  mainGridStep: 2.5,
  mainGridPortionSize: 0.05,
  leverage: 20,
  stopLossGridCount: 4,
  stopLossGridStep: 2.5,
  isolationStep: 2.5,
  gtcThreshold: 0.001,
  reorderThreshold: 0.0002,
  trailingCallbackRate: 0.002,
} as const;

// 来源：STRATEGY_SPEC.md §10.2 "范例解读"
// fullPositionPrice = takeProfitPrice − 235×2.5 = 2212.5
// stopLossStartPrice = 2212.5 − 2.5(隔离带) = 2210
// FullPosition = 235 * 0.05 = 11.75 ETH
export const ETH_RANGE_1_DERIVED = {
  stopLossStartPrice: 2210,
  fullPositionPrice: 2212.5,
  takeProfitPrice: 2800,
  gridStep: 2.5,
  fullPosition: 11.75,
  stopGridPortionSize: 11.75 / 4, // 2.9375
  activationPrice: (2212.5 + 2800) / 2, // 2506.25（主网格中点）
} as const;

export const TICK_SIZE_ETH = 0.01;

export const ZERO_POSITION = {
  symbol: 'ETH_USDT',
  baseAssetQty: 0,
  quoteAssetQty: 0,
  entryPrice: 0,
  leverage: 20,
  marginType: 'CROSS' as const,
};

export function positionAt(qty: number, entry = 2500): typeof ZERO_POSITION {
  return { ...ZERO_POSITION, baseAssetQty: qty, entryPrice: entry, quoteAssetQty: -qty * entry };
}

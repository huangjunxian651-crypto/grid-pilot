/**
 * Grid Geometry Module
 *
 * 提供网格几何相关的纯函数，用于价格与网格索引之间的转换。
 *
 * 主要功能：
 * - GridIndex ↔ Price 转换（index-utils）
 * - StopLossIndex ↔ Price 转换（stop-loss-utils）
 */

// GridIndex 相关函数
export {
  gridIndexToBuyPrice,
  gridIndexToSellPrice,
  priceToGridIndex,
} from './index-utils';

// StopLossIndex 相关函数
export {
  stopLossIndexToBuyPrice,
  stopLossIndexToSellPrice,
  priceToStopLossIndex,
} from './stop-loss-utils';

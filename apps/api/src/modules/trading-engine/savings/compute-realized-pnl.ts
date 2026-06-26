export interface FillLite {
  side: 'BUY' | 'SELL';
  fillQty: number;
  fillPrice: number;
  ts: number;
}

/**
 * 加权平均成本法计算已实现盈亏（价差，不含手续费）。
 * 用有符号持仓统一处理 LONG/SHORT：加仓更新均价，减仓/平仓结算 realized。
 * 规则源：修复路线图 R3 / 规则 16。
 */
export function computeRealizedPnl(fills: FillLite[]): number {
  const sorted = [...fills].sort((a, b) => a.ts - b.ts);
  let position = 0; // 有符号：LONG 正、SHORT 负
  let avgCost = 0;
  let realized = 0;

  for (const fill of sorted) {
    const signedQty = fill.side === 'BUY' ? fill.fillQty : -fill.fillQty;

    if (position === 0 || (position > 0) === (signedQty > 0)) {
      // 加仓/开仓：更新加权均价
      const newPos = position + signedQty;
      const denom = Math.abs(newPos);
      if (denom > 1e-12) {
        avgCost = (avgCost * Math.abs(position) + fill.fillPrice * Math.abs(signedQty)) / denom;
      }
      position = newPos;
    } else {
      // 减仓/平仓（方向相反）
      const closeQty = Math.min(Math.abs(signedQty), Math.abs(position));
      const sign = position > 0 ? 1 : -1;
      realized += sign * (fill.fillPrice - avgCost) * closeQty;
      const newPos = position + signedQty;
      if (Math.abs(newPos) <= 1e-12) {
        position = 0;
        avgCost = 0;
      } else if ((newPos > 0) !== (position > 0)) {
        // 反向超出：剩余成为新方向开仓
        position = newPos;
        avgCost = fill.fillPrice;
      } else {
        position = newPos;
      }
    }
  }

  // 规避浮点尾差
  return Math.round(realized * 1e8) / 1e8;
}

export interface PnlState {
  signedPosition: number; // LONG 正, SHORT 负
  avgCost: number;
}

export interface PnlFillInput {
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
}

/**
 * 加权平均成本法的逐笔增量。与 compute-realized-pnl.ts 的整批逻辑等价，
 * 但维护可持久化的运行态 (signedPosition, avgCost)，每笔返回本笔 realized delta（纯价差）。
 */
export function applyFillToPnlState(
  state: PnlState,
  fill: PnlFillInput,
): { state: PnlState; delta: number } {
  const signedQty = fill.side === 'BUY' ? fill.qty : -fill.qty;
  const { signedPosition: position, avgCost } = state;

  if (position === 0 || (position > 0) === (signedQty > 0)) {
    const newPos = position + signedQty;
    const denom = Math.abs(newPos);
    const newAvg = denom > 1e-12
      ? (avgCost * Math.abs(position) + fill.price * Math.abs(signedQty)) / denom
      : 0;
    return { state: { signedPosition: newPos, avgCost: newAvg }, delta: 0 };
  }

  const closeQty = Math.min(Math.abs(signedQty), Math.abs(position));
  const sign = position > 0 ? 1 : -1;
  const delta = Math.round(sign * (fill.price - avgCost) * closeQty * 1e8) / 1e8;
  const newPos = position + signedQty;

  if (Math.abs(newPos) <= 1e-12) {
    return { state: { signedPosition: 0, avgCost: 0 }, delta };
  }
  if ((newPos > 0) !== (position > 0)) {
    return { state: { signedPosition: newPos, avgCost: fill.price }, delta };
  }
  return { state: { signedPosition: newPos, avgCost }, delta };
}

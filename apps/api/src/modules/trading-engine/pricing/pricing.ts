// F16 — the GTC threshold is user-configurable but floored at ExcessProfitMultiplier ×
// takerFeeRate. Crossing the spread (taker) only makes sense when the captured edge exceeds
// `multiplier` times the taker fee paid; the multiplier defaults to 2.0 (Go config.go:258).
// Without a taker fee (no floor available) the raw user value is used as-is.
export function effectiveGtcThreshold(args: {
  gtcThreshold: number;
  excessProfitMultiplier?: number;
  takerFeeRate?: number;
}): number {
  const userValue = args.gtcThreshold ?? 0;
  if (!args.takerFeeRate || args.takerFeeRate <= 0) {
    return userValue;
  }
  const multiplier = args.excessProfitMultiplier && args.excessProfitMultiplier > 0 ? args.excessProfitMultiplier : 2.0;
  const floor = multiplier * args.takerFeeRate;
  return Math.max(userValue, floor);
}

export type PricingZone = 'BLOCKED' | 'POC' | 'GTC';

export interface PricingDecision {
  zone: PricingZone;
  actualPrice: number;
  tif: 'POC' | 'GTC' | 'NONE';
}

/**
 * Round a price to the nearest tick boundary.
 * T10: aligns with Go utils/precision.go RoundPrice = round(p*(1/tick)) / (1/tick).
 * Uses multiplication instead of division to avoid floating-point precision issues.
 */
export function roundToTick(price: number, tick: number): number {
  const safeTick = tick > 0 ? tick : 0.01;
  const inv = 1 / safeTick;
  return Math.round(price * inv) / inv;
}

export function calculateOptimalPrice(args: {
  side: 'BUY' | 'SELL';
  gridPrice: number;
  marketPrice: number;
  tickSize: number;
  gtcThreshold: number;
}): PricingDecision {
  const { side } = args;
  const tick = args.tickSize > 0 ? args.tickSize : 0.01;
  const roundPx = (p: number) => roundToTick(p, tick);
  const market = roundPx(args.marketPrice);
  const grid = roundPx(args.gridPrice);
  const gtcPrice = side === 'BUY'
    ? roundPx(grid * (1 - args.gtcThreshold))
    : roundPx(grid * (1 + args.gtcThreshold));

  if (side === 'BUY') {
    if (market > grid) return { zone: 'BLOCKED', actualPrice: 0, tif: 'NONE' };
    // POC(maker) 必须挂在卖一之下才不会被 post-only 立即成交拒单：用 market(bestAsk) − tick。
    // min(grid, …) 为防御性上界：当前 POC 区恒有 market <= grid，故网格线项不会胜出，
    // 但若日后调整 zone 边界，此夹取可保证价格不越过网格线本意。
    if (market > gtcPrice) return { zone: 'POC', actualPrice: Math.min(grid, roundPx(market - tick)), tif: 'POC' };
    const protectionPrice = roundPx(market * 1.02);
    return { zone: 'GTC', actualPrice: Math.min(gtcPrice, protectionPrice), tif: 'GTC' };
  }
  // SELL
  if (market < grid) return { zone: 'BLOCKED', actualPrice: 0, tif: 'NONE' };
  // POC(maker) 必须挂在买一之上：用 market(bestBid) + tick。max(grid, …) 同为防御性下界。
  if (market < gtcPrice) return { zone: 'POC', actualPrice: Math.max(grid, roundPx(market + tick)), tif: 'POC' };
  const protectionPriceSell = roundPx(market * 0.98);
  return { zone: 'GTC', actualPrice: Math.max(gtcPrice, protectionPriceSell), tif: 'GTC' };
}

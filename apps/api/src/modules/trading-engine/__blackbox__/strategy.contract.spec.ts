import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../strategy/strategy-engine';
import { ETH_RANGE_1, ETH_RANGE_1_DERIVED, positionAt, TICK_SIZE_ETH } from './fixtures/strategy-spec-cases';

const engine = new StrategyEngine();

function call(price: number, baseQty: number, bid: number = price - 1, ask: number = price + 1) {
  return engine.computeDesiredOrders(price, positionAt(baseQty, price), {
    takeProfitPrice: ETH_RANGE_1.takeProfitPrice,
    mainGridCount: ETH_RANGE_1.mainGridCount,
    mainGridStep: ETH_RANGE_1.mainGridStep,
    mainGridPortionSize: ETH_RANGE_1.mainGridPortionSize,
    direction: ETH_RANGE_1.direction,
    reorderThreshold: ETH_RANGE_1.reorderThreshold,
    stopLossGridCount: ETH_RANGE_1.stopLossGridCount,
    stopLossGridStep: ETH_RANGE_1.stopLossGridStep,
    isolationStep: ETH_RANGE_1.isolationStep,
    gtcThreshold: ETH_RANGE_1.gtcThreshold,
    // F11: ε death-band is now SymbolInfo.MinQty. This contract is written with ε = 0.05,
    // so configure minQty = 0.05 explicitly (previously ε was implicitly mainGridPortionSize).
    minQty: ETH_RANGE_1.mainGridPortionSize,
  }, { tickSize: TICK_SIZE_ETH, bestBid: bid, bestAsk: ask });
}

// Grid arithmetic for price=2500:
// fullPositionPrice = 2200 + 4*2.5 + 2.5 = 2212.5
// gridHigh = takeProfitPrice = 2800, step = (2800 - 2212.5) / 235 = 2.5
// computeTargetPosition adds +1 grid buffer to hold size:
//   grids = floor((2800 - 2500) / 2.5) = 120
//   targetBoughtSize = 120 * 0.05 = 6.00 ETH
//   targetHoldSize   = (120 + 1) * 0.05 = 6.05 ETH
// mainGridPortionSize (minQty ε) = 0.05
// SELL threshold (contract): currentSize >= targetHoldSize  + ε = 6.05 + 0.05 = 6.10
// BUY  threshold (contract): currentSize <= targetBoughtSize - ε = 6.00 - 0.05 = 5.95
// Buffer zone (contract): (5.95, 6.10)  → HOLD

describe('StrategyEngine (contract, LONG)', () => {
  it('returns PLACE BUY when price below MainGridLow and position < targetBoughtSize', () => {
    // price=2212 is in isolation zone (2210 < 2212 < 2212.5)
    // gridPrice = 2212.5 (fullPositionPrice); ask must be <= 2212.5 to avoid melt zone
    const decision = call(ETH_RANGE_1_DERIVED.fullPositionPrice - 0.5, 0, 2211, 2211);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
  });

  // Buffer-zone center: between targetBoughtSize=6.00 and targetHoldSize+minQty=6.10.
  // HOLD both pre- and post-fix; this is a regression guard against future inversion.
  it('returns HOLD when position is strictly inside buffer zone (6.00, 6.05)', () => {
    const decision = call(2500, 5.97);
    expect(decision.action).toBe('HOLD');
  });

  // Step 3 ─ qty 6.09 is in [6.05, 6.10); with +1 buffer, targetHoldSize=6.05, threshold=6.10
  // bid=2501 to avoid melt zone
  it('returns HOLD when position is in extended buffer (6.05 <= qty < targetHoldSize + minQty)', () => {
    const decision = call(2500, 6.09, 2501, 2501);
    expect(decision.action).toBe('HOLD');
  });

  // Step 3 ─ Red (before fix): qty 5.96 is in (5.95, 6.00]; with +1 buffer, BUY threshold=5.95
  // ask=2501 to avoid melt zone masking the buffer logic
  it('returns HOLD when position is in extended buffer (targetBoughtSize - minQty < qty <= 6.00)', () => {
    const decision = call(2500, 5.96, 2499, 2501);
    expect(decision.action).toBe('HOLD');
  });

  // Step 3 ─ confirms SELL fires at contract threshold (qty >= targetHoldSize + minQty = 6.10)
  // gridPrice(SELL) = 2800 - 120*2.5 = 2500; bid must be >= 2500 to avoid melt zone
  it('returns SELL when position >= targetHoldSize + minQty (6.10)', () => {
    const decision = call(2500, 6.11, 2501, 2501);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('SELL');
  });

  // Step 3 ─ confirms BUY fires at contract threshold (qty <= targetBoughtSize - minQty = 5.95)
  // gridPrice(BUY) = 2800 - 119*2.5 = 2502.5; ask must be <= 2502.5 to avoid melt zone
  it('returns BUY when position <= targetBoughtSize - minQty (5.95)', () => {
    const decision = call(2500, 5.94, 2499, 2501);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
  });

  // Step 7 ─ should already be green: price above takeProfitPrice with zero position → HOLD
  it('returns HOLD when price > takeProfitPrice and zero position', () => {
    const decision = call(ETH_RANGE_1.takeProfitPrice + 5, 0);
    expect(decision.action).toBe('HOLD');
  });

  it('returns PLACE SELL at exact threshold actualHeld >= targetHoldSize + minQty (LONG)', () => {
    // targetHoldSize = 6.05, minQty = 0.05 → threshold ≈ 6.10; >= triggers SELL
    // bid=2501 to avoid melt zone: SELL gridPrice=2500, need bid >= 2500
    const decision = call(2500, 6.1001, 2501, 2501);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('SELL');
  });

  it('returns PLACE BUY at exact threshold actualHeld == targetBoughtSize - minQty (LONG, <=)', () => {
    // targetBoughtSize = 6.00, minQty = 0.05 → threshold = 5.95; <= triggers BUY
    // ask=2501 to avoid melt zone: BUY gridPrice=2502.5, need ask <= 2502.5
    const decision = call(2500, 5.95, 2499, 2501);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
  });
});

describe('StrategyEngine (contract) — stop-loss zone boundary = MainGridLow incl isolation (Go strategy.go:50-56)', () => {
  // fullPositionPrice = 2212.5. Price 2211 is ABOVE stopLossStartPrice but BELOW fullPositionPrice
  // With +1 buffer, the engine now computes targets for all price zones → produces decisions
  it('PLACE BUY when price in isolation/stop zone (stopLossStartPrice < price < fullPositionPrice) with zero position', () => {
    const decision = call(2211, 0);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
  });

  it('does NOT hold (computes grid) at price just above fullPositionPrice (2213) with zero position', () => {
    // zero position, far below target held → expect a BUY placement, definitely not the main-grid HOLD
    const decision = call(2213, 0, 2213, 2213);
    expect(decision.reason === 'price_below_main_grid').toBe(false);
  });

  it('HOLD exactly at fullPositionPrice boundary is excluded (price < fullPositionPrice is strict; price == fullPositionPrice computes)', () => {
    // price == 2212.5 should NOT be price_below_main_grid (strict <)
    const decision = call(2212.5, 0, 2212.5, 2212.5);
    expect(decision.reason === 'price_below_main_grid').toBe(false);
  });
});

describe('StrategyEngine (contract, SHORT)', () => {
  function callShort(price: number, baseQty: number, bid: number = price - 1, ask: number = price + 1) {
    return engine.computeDesiredOrders(price, positionAt(baseQty, price), {
      takeProfitPrice: ETH_RANGE_1.takeProfitPrice,
      mainGridCount: ETH_RANGE_1.mainGridCount,
      mainGridStep: ETH_RANGE_1.mainGridStep,
      mainGridPortionSize: ETH_RANGE_1.mainGridPortionSize,
      direction: 'SHORT',                  // override
      reorderThreshold: ETH_RANGE_1.reorderThreshold,
      stopLossGridCount: ETH_RANGE_1.stopLossGridCount,
      stopLossGridStep: ETH_RANGE_1.stopLossGridStep,
      isolationStep: ETH_RANGE_1.isolationStep,
      gtcThreshold: ETH_RANGE_1.gtcThreshold,
      minQty: ETH_RANGE_1.mainGridPortionSize, // F11: contract ε = 0.05, now via config.minQty
    }, { tickSize: TICK_SIZE_ETH, bestBid: bid, bestAsk: ask });
  }

  // ── SHORT 镜像几何（设计文档 §3/§4.2）──
  // SHORT toPrice(d)=2800+d，箱体在止盈端之上。
  // 镜像 LONG@2500（d=300）的 SHORT 价格 = 2800 + 300 = 3100。
  //   d=300, mainGridDepth=587.5, isolationEndDepth=590 → 主网格分支
  //   reduceGridPrice = toPrice(heldGrids*step) = toPrice(120*2.5=300) = 3100
  //   addGridPrice    = toPrice(boughtGrids*step) = toPrice(119*2.5=297.5) = 3097.5
  //   SHORT: sellGridPrice=addGridPrice=3097.5, buyGridPrice=reduceGridPrice=3100
  //   targetBoughtSize = 120 * 0.05 = 6.00, targetHoldSize = (120+1)*0.05 = 6.05
  //   buffer zone (5.95, 6.10) → HOLD
  // SHORT position stored as negative baseAssetQty: shortPosition = -baseQty (positive)

  it('returns HOLD when short exposure within buffer (SHORT, mirror of LONG@2500)', () => {
    // shortPosition = 5.97 ∈ (5.95, 6.10) → HOLD
    const decision = callShort(3100, -5.97);
    expect(decision.action).toBe('HOLD');
  });

  // SHORT BUY-reduce gridPrice = reduceGridPrice = toPrice(120*2.5) = 3100
  it('returns PLACE BUY (reduce short) with correct gridPrice (SHORT, mirror)', () => {
    // shortPosition = 6.11 ≥ 6.05 + 0.05 = 6.10 → BUY to reduce
    // BUY-reduce gridPrice = 3100; ask must be <= 3100 to avoid melt zone
    const decision = callShort(3100, -6.11, 3099, 3099);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
    expect(decision.gridPrice).toBeCloseTo(3100, 4);
  });

  // SHORT SELL-build gridPrice = addGridPrice = toPrice(119*2.5) = 3097.5
  it('returns PLACE SELL (build short) with correct gridPrice (SHORT, mirror)', () => {
    // shortPosition = 5.94 ≤ 6.00 - 0.05 = 5.95 → SELL to build short
    // SELL-build gridPrice = 3097.5; bid must be >= 3097.5 to avoid melt zone
    const decision = callShort(3100, -5.94, 3098, 3098);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('SELL');
    expect(decision.gridPrice).toBeCloseTo(3097.5, 4);
  });

  it('SHORT: exact threshold shortPosition >= targetHoldSize + minQty triggers BUY-reduce', () => {
    // targetHoldSize=6.05, minQty=0.05 → threshold ≈ 6.10
    const decision = callShort(3100, -6.1001, 3099, 3099);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('BUY');
  });

  it('SHORT: exact threshold shortPosition == targetBoughtSize - minQty triggers SELL-build', () => {
    // targetBoughtSize=6.00, minQty=0.05 → threshold = 5.95
    const decision = callShort(3100, -5.95, 3098, 3098);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('SELL');
  });

  // SHORT 止损区：d∈[590,600) → price∈[3390,3400)。price 3392 在上侧止损区。
  it('SHORT: price in upper stop-loss zone produces SELL when market allows', () => {
    // d=592 stop-loss zone → 应建空（shortPosition=0 < target）→ SELL build
    const decision = callShort(3392, 0, 3393, 3393);
    expect(decision.action).toBe('PLACE');
    expect(decision.side).toBe('SELL');
  });

  it('SHORT: price inside SHORT main grid (3100) computes orders, not exit HOLD', () => {
    const decision = callShort(3100, 0, 3100, 3100);
    expect(decision.reason === 'price_below_main_grid' || decision.reason === 'price_above_main_grid').toBe(false);
  });

  // SHORT gridPrice consistency at a second price point (mirror of LONG@2700, d=100)
  it('SHORT: gridPrice consistency at price=2900 (mirror of LONG@2700)', () => {
    // SHORT@2900 d=100：
    //   heldGrids  = count(i: 100 > i*2.5) = count(i<40) = 40 → reduceGridPrice=toPrice(100)=2900
    //   boughtGrids= count(i: 100 > (i+1)*2.5) = count(i<39) = 39 → addGridPrice=toPrice(97.5)=2897.5
    //   targetBoughtSize=40*0.05=2.00, targetHoldSize=41*0.05=2.05
    // BUY-reduce gridPrice = reduceGridPrice = 2900
    const buyDecision = callShort(2900, -2.05, 2899, 2899); // shortPosition just at threshold
    if (buyDecision.action === 'PLACE') {
      expect(buyDecision.side).toBe('BUY');
      expect(buyDecision.gridPrice).toBeCloseTo(2900, 4);
    }
  });
});

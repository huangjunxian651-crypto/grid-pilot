import { describe, it, expect } from 'vitest';
import { StrategyEngine } from './strategy-engine';
import type { Position } from '../types/exchange.types';

describe('StrategyEngine (Top-Down, Go-aligned)', () => {
  const engine = new StrategyEngine();

  const baseConfig = {
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 40,
    mainGridPortionSize: 0.01,
    reorderThreshold: 0.0002,
    stopLossGridCount: 0,
    stopLossGridStep: 0,
    isolationStep: 0,
    gtcThreshold: 1.0,
  };

  const marketInfo = {
    tickSize: 0.01,
    bestBid: 2500,
    bestAsk: 1500,
  };

  // Top-Down price table for takeProfitPrice=2200, mainGridCount=10, mainGridStep=40
  // i=0: Sell=2200, Buy=2160
  // i=1: Sell=2160, Buy=2120
  // i=2: Sell=2120, Buy=2080
  // i=3: Sell=2080, Buy=2040
  // i=4: Sell=2040, Buy=2000
  // i=5: Sell=2000, Buy=1960
  // i=6: Sell=1960, Buy=1920
  // i=7: Sell=1920, Buy=1880
  // i=8: Sell=1880, Buy=1840
  // i=9: Sell=1840, Buy=1800

  describe('F11: ε death-band uses SymbolInfo.MinQty (Go strategy.go:69)', () => {
    it('SELLs a small overshoot beyond minQty even though it is smaller than one grid lot', () => {
      // price=2000 → targetHoldSize=0.06. Position 0.065 overshoots by 0.005.
      // With ε=minQty(0.001) it must SELL 0.005.
      const config = { ...baseConfig, direction: 'LONG' as const, minQty: 0.001 };
      const position: Position = {
        symbol: 'ETH/USDT', baseAssetQty: 0.065, quoteAssetQty: -130,
        entryPrice: 1800, leverage: 10, marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(2000, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.qty).toBeCloseTo(0.005, 10);
    });

    it('SHORT: buys back a small overshoot beyond minQty (mirror of LONG@2000)', () => {
      const config = { ...baseConfig, direction: 'SHORT' as const, minQty: 0.001 };
      // SHORT 镜像 LONG@2000：d=200 → SHORT price = 2200 + 200 = 2400
      // SHORT position magnitude 0.065 vs targetHoldSize 0.06 → buy back 0.005.
      const position: Position = {
        symbol: 'ETH/USDT', baseAssetQty: -0.065, quoteAssetQty: 130,
        entryPrice: 2200, leverage: 10, marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(2400, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBeCloseTo(0.005, 10);
    });
  });

  describe('F13: stepSize alignment + minNotional gate', () => {
    it('rounds order qty down to the exchange stepSize', () => {
      // targetBoughtSize at price 2000 = 0.05. Position 0.0283 → raw BUY qty 0.0217.
      // stepSize 0.001 → floor-align to 0.021.
      const config = { ...baseConfig, direction: 'LONG' as const, minQty: 0.001, stepSize: 0.001 };
      const position: Position = {
        symbol: 'ETH/USDT', baseAssetQty: 0.0283, quoteAssetQty: -56,
        entryPrice: 1800, leverage: 10, marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(2000, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.qty).toBe(0.021);
    });

    it('HOLDs when the resulting order notional is below minNotional', () => {
      // Tiny overshoot beyond minQty but worth < minNotional → not placeable, must HOLD.
      const config = {
        ...baseConfig, direction: 'LONG' as const,
        minQty: 0.0001, stepSize: 0.0001, minNotional: 1000, quantoMultiplier: 1,
      };
      const position: Position = {
        symbol: 'ETH/USDT', baseAssetQty: 0.0602, quoteAssetQty: -120.04,
        entryPrice: 1800, leverage: 10, marginType: 'CROSS',
      };
      // overshoot 0.0002 above targetHoldSize=0.06, qty*price notional « 1000 → HOLD.
      const decision = engine.computeDesiredOrders(2000, position, config, marketInfo);
      expect(decision.action).toBe('HOLD');
    });
  });

  describe('LONG direction', () => {
    const config = { ...baseConfig, direction: 'LONG' as const };

    it('should HOLD when position is within buffer zone', () => {
      // price=2000: targetHoldSize=0.06, targetBoughtSize=0.05
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.05,
        quoteAssetQty: -100,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('HOLD');
    });

    it('should BUY when position is below TargetBoughtSize', () => {
      // price=2000: targetBoughtSize=0.05
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.03,
        quoteAssetQty: -60,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.02); // 0.05 - 0.03
      expect(decision.tif).toBe('POC');
      expect(decision.price).toBe(1499.99); // bestAsk − tick (maker-safe)
    });

    it('should SELL when position is above TargetHeldSize', () => {
      // price=2000: targetHoldSize=0.06
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.08,
        quoteAssetQty: -160,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.qty).toBe(0.02); // 0.08 - 0.06
      expect(decision.price).toBe(2500.01); // bestBid + tick (maker-safe)
    });

    it('should produce single order for large deviation (no splitting)', () => {
      // price=2000: targetBoughtSize=0.05
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.05); // single order for 5-grid deviation
    });

    it('should return BUY at lower price with zero position', () => {
      // price=1920: targetHoldSize=0.08, targetBoughtSize=0.07
      const price = 1920;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.03,
        quoteAssetQty: -54,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.04); // 0.07 - 0.03
    });

    it('should return BUY near BoxLow with zero position', () => {
      // price=1801: targetHoldSize=0.10, targetBoughtSize=0.09
      const price = 1801;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.09);
    });

    it('should return SELL near BoxHigh when over-positioned', () => {
      // price=2199: targetHoldSize=0.01, targetBoughtSize=0.00
      const price = 2199;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.11,
        quoteAssetQty: -220,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.qty).toBe(0.1); // 0.11 - 0.01
    });

    it('should return HOLD at BoxHigh with zero position', () => {
      // price=2200: targetHoldSize=0, targetBoughtSize=0
      const price = 2200;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('HOLD');
    });
  });

  // SHORT 镜像几何：toPrice(d)=2200+d。LONG@2000 d=200 → SHORT 镜像 price=2400
  describe('SHORT direction (mirror of LONG)', () => {
    const config = { ...baseConfig, direction: 'SHORT' as const };

    it('should HOLD when short position is within buffer zone', () => {
      // SHORT@2400 d=200: targetHoldSize=0.06, targetBoughtSize=0.05
      // shortPosition = 0.05, within buffer zone
      const price = 2400;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: -0.05,
        quoteAssetQty: 100,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('HOLD');
    });

    it('should SELL when short position is less than target', () => {
      // SHORT@2400: targetBoughtSize=0.05
      // shortPosition = 0.03 < 0.05 → SELL more
      const price = 2400;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: -0.03,
        quoteAssetQty: 60,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.qty).toBe(0.02); // 0.05 - 0.03
    });

    it('should BUY when short position exceeds target', () => {
      // SHORT@2400: targetHoldSize=0.06
      // shortPosition = 0.08 > 0.06 → BUY to reduce
      const price = 2400;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: -0.08,
        quoteAssetQty: 160,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.02); // 0.08 - 0.06
    });
  });

  describe('computeReorder (Go checkPriceAndReOrder)', () => {
    const tickSize = 0.01;
    const gtcThreshold = 0.001; // 0.1%
    const reorderThreshold = 0.0002; // 0.05%

    it('signals BLOCKED (cancel only) when a BUY market crosses above the grid price', () => {
      // BUY grid floor = 2000, market 2001 > grid → BLOCKED.
      const r = engine.computeReorder({
        side: 'BUY', gridPrice: 2000, placedPrice: 1999, marketPrice: 2001,
        tickSize, gtcThreshold, reorderThreshold,
      });
      expect(r.shouldReorder).toBe(true);
      expect(r.blocked).toBe(true);
    });

    it('upgrades a resting POC BUY to GTC when the market drops into the GTC zone', () => {
      // gtcPrice = 2000*(1-0.001) = 1998. market 1997 <= 1998 → GTC zone.
      const r = engine.computeReorder({
        side: 'BUY', gridPrice: 2000, placedPrice: 1999, marketPrice: 1997,
        tickSize, gtcThreshold, reorderThreshold,
      });
      expect(r.shouldReorder).toBe(true);
      expect(r.blocked).toBe(false);
      expect(r.tif).toBe('GTC');
    });

    it('reorders a POC BUY when the market moves beyond the reorder threshold', () => {
      // Both in POC zone (1998 < market <= 2000). placed 1999.0, market 1998.5:
      // |1998.5-1999|/1998.5 = 0.00025 > 0.0002 → reorder at new POC price.
      const r = engine.computeReorder({
        side: 'BUY', gridPrice: 2000, placedPrice: 1999.0, marketPrice: 1998.5,
        tickSize, gtcThreshold, reorderThreshold,
      });
      expect(r.shouldReorder).toBe(true);
      expect(r.blocked).toBe(false);
      expect(r.tif).toBe('POC');
      expect(r.newPrice).toBe(1998.49); // BUY POC = market − tick = 1998.5 − 0.01 (maker-safe)
    });

    it('holds (no reorder) when a POC BUY price barely moves within threshold', () => {
      // placed 1999.0, market 1999.1 (still POC zone): |0.1|/1999.1 ≈ 0.00005 < 0.0002.
      const r = engine.computeReorder({
        side: 'BUY', gridPrice: 2000, placedPrice: 1999.0, marketPrice: 1999.1,
        tickSize, gtcThreshold, reorderThreshold,
      });
      expect(r.shouldReorder).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should BUY to full position when price is below BoxLow (no stop-loss)', () => {
      const config = { ...baseConfig, direction: 'LONG' as const };
      const price = 1799;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.05,
        quoteAssetQty: -100,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.05); // baseSize(0.10) - position(0.05)
    });

    it('should BUY to full position when price is in isolation band with stop-loss', () => {
      const config = {
        ...baseConfig,
        direction: 'LONG' as const,
        mainGridStep: 37.5,
        stopLossGridCount: 2,
        stopLossGridStep: 10,
        isolationStep: 5,
      };
      // stopLossStartPrice = 1800 + 20 = 1820, fullPositionPrice = 1825
      // price=1822 is between stopLossStartPrice=1820 and fullPositionPrice=1825
      const price = 1822; // in former isolation band, now computes targets
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.05,
        quoteAssetQty: -100,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBeCloseTo(0.05, 10); // targetBoughtSize(0.10) - position(0.05)
    });

    it('should compute grid index from MainGridLow with isolationStep', () => {
      const config = {
        ...baseConfig,
        direction: 'LONG' as const,
        mainGridStep: 37.5,
        stopLossGridCount: 2,
        stopLossGridStep: 10,
        isolationStep: 5,
      };
      // fullPositionPrice = 1825, step = (2200 - 1825) / 10 = 37.5
      // price=1900: between 1825 and 2200
      // targetHeld: price < Sell(i) for Sell >= 1900
      // i=0: 2200 > 1900 ✓
      // i=1: 2160 > 1900 ✓
      // i=2: 2120 > 1900 ✓
      // ... up to i=8: 1900 > 1900? No (1880 < 1900, so i=7: 1920 > 1900 ✓, i=8: 1880 > 1900 ✗)
      // Actually: Sell(i) = 2200 - i*37.5
      // i=0:2200, i=1:2162.5, i=2:2125, i=3:2087.5, i=4:2050, i=5:2012.5, i=6:1975, i=7:1937.5, i=8:1900
      // 1900 < 1937.5? Yes. 1900 < 1900? No.
      // targetBoughtSize = 8*0.01=0.08, targetHoldSize = 9*0.01=0.09
      const price = 1900;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBeCloseTo(0.08, 10);
    });

    it('should default to fullPositionPrice behavior when isolationStep=0 and stopLossGridCount=0', () => {
      const config = { ...baseConfig, direction: 'LONG' as const };
      const price = 1900;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0,
        quoteAssetQty: 0,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      // step = (2200 - 1800) / 10 = 40
      // price=1900: targetHoldSize=0.08 (grids=7+1), targetBoughtSize=0.07 (grids=7)
      const decision = engine.computeDesiredOrders(price, position, config, marketInfo);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.qty).toBe(0.07);
    });
  });

  describe('three-zone pricing (STRATEGY_SPEC §7.3)', () => {
    const zoneConfig = {
      ...baseConfig,
      direction: 'LONG' as const,
      gtcThreshold: 0.001, // 0.1%
    };

    it('should return POC when price deviation is within threshold', () => {
      // price=2000: targetBought=4, gridPrice=2200-4*40=2040
      // bestAsk=2040*0.9995=2039.98? Let's use 2039
      // 2039 <= 2040? Yes (favorable). 2039 <= 2040*0.999=2037.96? No → POC
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.03,
        quoteAssetQty: -60,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2500, bestAsk: 2039 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.tif).toBe('POC');
      expect(decision.price).toBe(2038.99); // BUY POC = bestAsk − tick = 2039 − 0.01 (maker-safe)
    });

    it('should return GTC when price deviates beyond threshold', () => {
      // price=2000: gridPrice=2040
      // bestAsk=2030 <= 2040*0.999=2037.96? Yes → GTC
      // gtcPrice = 2040 * (1 - 0.001) = 2037.96, market*1.02 = 2030*1.02 = 2070.6
      // actualPrice = min(2037.96, 2070.6) = 2037.96
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.03,
        quoteAssetQty: -60,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2500, bestAsk: 2030 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('BUY');
      expect(decision.tif).toBe('GTC');
      expect(decision.price).toBe(2037.96); // gtcPrice (Go-aligned: min(gtcPrice, market*1.02))
    });

    it('should return HOLD (melt zone) when market price is unfavorable', () => {
      // price=2000: gridPrice=2040
      // bestAsk=2050 >= 2040 → melt zone
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.03,
        quoteAssetQty: -60,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2500, bestAsk: 2050 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('HOLD');
      expect(decision.reason).toBe('melt_zone');
    });

    it('should return POC for SELL when deviation is within threshold', () => {
      // price=2000: targetHeld=5, gridPrice=2200-5*40=2000
      // bestBid=2001 > 2000, < 2000*1.001=2002 → POC
      // POC 价 = bestBid + tick = 2001.01（做市安全）
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.08,
        quoteAssetQty: -160,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2001, bestAsk: 1500 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.tif).toBe('POC');
      expect(decision.price).toBe(2001.01); // bestBid 2001 + tick 0.01 (maker-safe)
    });

    it('should return GTC for SELL when deviation is beyond threshold', () => {
      // price=2000: gridPrice=2000
      // bestBid=2010 > 2000*1.001=2002 → GTC
      // gtcPrice = 2000 * (1 + 0.001) = 2002, market*0.98 = 2010*0.98 = 1969.8
      // actualPrice = max(2002, 1969.8) = 2002
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.08,
        quoteAssetQty: -160,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2010, bestAsk: 1500 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('PLACE');
      expect(decision.side).toBe('SELL');
      expect(decision.tif).toBe('GTC');
      expect(decision.price).toBe(2002); // gtcPrice (Go-aligned: max(gtcPrice, market*0.98))
    });

    it('should return HOLD (melt zone) for SELL when market price is unfavorable', () => {
      // price=2000: gridPrice=2000
      // bestBid=1995 <= 2000 → melt zone
      const price = 2000;
      const position: Position = {
        symbol: 'ETH/USDT',
        baseAssetQty: 0.08,
        quoteAssetQty: -160,
        entryPrice: 1800,
        leverage: 10,
        marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 1995, bestAsk: 1500 };
      const decision = engine.computeDesiredOrders(price, position, zoneConfig, mi);
      expect(decision.action).toBe('HOLD');
      expect(decision.reason).toBe('melt_zone');
    });
  });

  describe('stop-loss zone gridPrice correctness', () => {
    // takeProfitPrice=200, mainGridCount=10, mainGridStep=8.7, mainGridPortionSize=0.01
    // stopLossGridCount=2, stopLossGridStep=5, isolationStep=3
    // d 空间：mainGridDepth=87, isolationEndDepth=90, boxDepth=100
    // LONG toPrice(d)=200-d：止损区价格区间 100~110（d∈[90,100)）
    // SHORT toPrice(d)=200+d（镜像）：止损区价格区间 290~300（d∈[90,100)）
    const slConfig = {
      takeProfitPrice: 200,
      mainGridCount: 10,
      mainGridStep: 8.7,
      mainGridPortionSize: 0.01,
      reorderThreshold: 0.0002,
      stopLossGridCount: 2,
      stopLossGridStep: 5,
      isolationStep: 3,
      gtcThreshold: 1.0,
    };

    it('LONG stop-loss: gridPrice uses stopLossGridStep (5), not main step (8.7)', () => {
      // price=105 in LONG stop-loss zone (liquidationPrice=100, stopLossStartPrice=110)
      // slGrids = floor((105-100)/5) = 1
      // targetBoughtSize = 1 * 0.05 = 0.05 (baseSize=0.10, stopLossPortionSize=0.05)
      // targetHoldSize = min(2, 2) * 0.05 = 0.10 (slGrids+1=2)
      // With position=0 < targetBoughtSize(0.05): BUY
      // BUY gridPrice = liquidationPrice + (slGrids+1) * slStep = 100 + 2*5 = 110 (next grid level above)
      // NOT gridHigh - targetBoughtGrids * step = 200 - 1 * 8.7 = 191.3
      const config = { ...slConfig, direction: 'LONG' as const };
      const position: Position = {
        symbol: 'TEST', baseAssetQty: 0, quoteAssetQty: 0,
        entryPrice: 100, leverage: 10, marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2500, bestAsk: 104 };
      const decision = engine.computeDesiredOrders(105, position, config, mi);
      expect(decision.action).toBe('PLACE');
      if (decision.action === 'PLACE') {
        expect(decision.gridPrice).toBeCloseTo(110, 4);
      }
    });

    it('SHORT stop-loss: SELL-build gridPrice uses stopLossGridStep (mirror of LONG@105)', () => {
      // SHORT 镜像：price=295 in SHORT stop-loss zone（d=95, boxDepth=100, isolationEndDepth=90）
      // slGrids = floor((100-95)/5) = 1
      // targetBoughtSize = 1 * 0.05 = 0.05
      // shortPosition=0 < targetBoughtSize(0.05): SELL-build
      // SELL-build gridPrice = addGridPrice = toPrice(boxDepth - (slGrids+1)*slStep) = toPrice(90) = 290
      const config = { ...slConfig, direction: 'SHORT' as const };
      const position: Position = {
        symbol: 'TEST', baseAssetQty: 0, quoteAssetQty: 0,
        entryPrice: 200, leverage: 10, marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 291, bestAsk: 1500 };
      const decision = engine.computeDesiredOrders(295, position, config, mi);
      expect(decision.action).toBe('PLACE');
      if (decision.action === 'PLACE') {
        expect(decision.gridPrice).toBeCloseTo(290, 4);
      }
    });

    it('SHORT stop-loss: BUY-reduce gridPrice uses stopLossGridStep (mirror)', () => {
      // SHORT 镜像：price=293 in SHORT stop-loss zone（d=93）
      // slGrids = floor((100-93)/5) = 1
      // targetHoldSize = min(2, 2) * 0.05 = 0.10
      // shortPosition=0.12 > targetHoldSize(0.10) + epsilon: BUY-reduce
      // BUY-reduce gridPrice = reduceGridPrice = toPrice(boxDepth - slGrids*slStep) = toPrice(95) = 295
      const config = { ...slConfig, direction: 'SHORT' as const };
      const position: Position = {
        symbol: 'TEST', baseAssetQty: -0.12, quoteAssetQty: 24,
        entryPrice: 200, leverage: 10, marginType: 'CROSS',
      };
      const mi = { tickSize: 0.01, bestBid: 2500, bestAsk: 294 };
      const decision = engine.computeDesiredOrders(293, position, config, mi);
      expect(decision.action).toBe('PLACE');
      if (decision.action === 'PLACE') {
        expect(decision.gridPrice).toBeCloseTo(295, 4);
      }
    });
  });

  describe('reorder logic', () => {
    it('should recommend reorder when price deviates beyond threshold', () => {
      expect(engine.shouldReorder(2000, 2000.5, 0.0002)).toBe(true);
    });

    it('should not reorder when deviation is below threshold', () => {
      expect(engine.shouldReorder(2000, 2000.1, 0.0002)).toBe(false);
    });

    it('should use configurable reorderThreshold', () => {
      expect(engine.shouldReorder(2000, 2001, 0.001)).toBe(false);
      expect(engine.shouldReorder(2000, 2003, 0.001)).toBe(true);
    });
  });
});

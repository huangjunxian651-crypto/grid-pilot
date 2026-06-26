import { describe, it, expect } from 'vitest';
import { whichZone, type BoxTargetConfig } from '@gridpilot/shared-types';

describe('whichZone', () => {
  const config: BoxTargetConfig = {
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 40,
    mainGridPortionSize: 0.01,
    stopLossGridCount: 2,
    stopLossGridStep: 10,
    isolationStep: 5,
    direction: 'LONG',
  };

  it('changes zone at every main grid line (LONG)', () => {
    for (let i = 0; i < 10; i++) {
      const gridLine = 2200 - i * 40;
      expect(whichZone(gridLine + 0.1, config), `above grid line ${gridLine}`).not.toBe(
        whichZone(gridLine - 0.1, config),
      );
    }
  });

  it('changes zone at fullPositionPrice → isolation boundary (LONG)', () => {
    expect(whichZone(1800.1, config)).not.toBe(whichZone(1799.9, config));
  });

  it('changes zone at stopLossStartPrice → stop-loss boundary (LONG)', () => {
    expect(whichZone(1795.1, config)).not.toBe(whichZone(1794.9, config));
  });

  it('changes zone at each stop-loss grid line (LONG)', () => {
    expect(whichZone(1785.1, config)).not.toBe(whichZone(1784.9, config));
  });

  it('changes zone at liquidationPrice boundary (LONG)', () => {
    expect(whichZone(1775.1, config)).not.toBe(whichZone(1774.9, config));
  });

  it('returns same zone above takeProfitPrice (LONG)', () => {
    expect(whichZone(2200, config)).toBe(whichZone(2300, config));
  });

  it('returns same zone below liquidationPrice (LONG)', () => {
    expect(whichZone(1774, config)).toBe(whichZone(1700, config));
  });

  it('works for SHORT direction — zone changes mirror LONG', () => {
    // SHORT toPrice(d)=2200+d：主网格线在 2200 + i*40，箱体在 2200~2625
    const shortConfig: BoxTargetConfig = { ...config, direction: 'SHORT' };
    for (let i = 0; i < 10; i++) {
      const gridLine = 2200 + i * 40;
      expect(whichZone(gridLine + 0.1, shortConfig), `above grid line ${gridLine}`).not.toBe(
        whichZone(gridLine - 0.1, shortConfig),
      );
    }
    // price <= takeProfitPrice 同区（PROFIT_EXIT）
    expect(whichZone(2200, shortConfig)).toBe(whichZone(2100, shortConfig));
    // price 越过箱体亏损端（liquidationPrice=2625）同区
    expect(whichZone(2626, shortConfig)).toBe(whichZone(2700, shortConfig));
  });

  it('handles zero stop-loss config', () => {
    const noSl: BoxTargetConfig = {
      ...config,
      stopLossGridCount: 0,
      stopLossGridStep: 0,
      isolationStep: 0,
    };
    expect(whichZone(1801, noSl)).not.toBe(whichZone(1799, noSl));
    expect(whichZone(2200, noSl)).toBe(whichZone(2300, noSl));
    expect(whichZone(1799, noSl)).toBe(whichZone(1700, noSl));
  });
});

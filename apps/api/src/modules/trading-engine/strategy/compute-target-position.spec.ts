import { describe, it, expect } from 'vitest';
import { computeTargetPosition, type BoxTargetConfig } from '@gridpilot/shared-types';

describe('computeTargetPosition - Extended Return Value', () => {
  const baseConfig: BoxTargetConfig = {
    takeProfitPrice: 2200,
    mainGridCount: 10,
    mainGridStep: 40,
    mainGridPortionSize: 0.01,
    stopLossGridCount: 4,
    stopLossGridStep: 10,
    isolationStep: 5,
    direction: 'LONG',
  };

  // d 空间几何：mainGridDepth=400, isolationEndDepth=405, boxDepth=445
  // LONG toPrice(d)=2200-d：主网格区 1800~2200, 隔离区 1795~1800, 止损区 1755~1795
  // SHORT toPrice(d)=2200+d（镜像）：主网格区 2200~2600, 隔离区 2600~2605, 止损区 2605~2645

  describe('LONG direction', () => {
    it('returns zone MAIN when price in main grid', () => {
      const result = computeTargetPosition(2000, baseConfig);
      expect(result.zone).toBe('MAIN');
      expect(result.gridIndex).toBeGreaterThanOrEqual(0);
      expect(result.gridIndex).toBeLessThan(baseConfig.mainGridCount);
    });

    it('returns zone ISOLATION when price in isolation zone', () => {
      const result = computeTargetPosition(1798, baseConfig);
      expect(result.zone).toBe('ISOLATION');
      expect(result.targetHoldSize).toBe(baseConfig.mainGridCount * baseConfig.mainGridPortionSize);
    });

    it('returns zone STOP_LOSS when price in stop-loss area', () => {
      const result = computeTargetPosition(1780, baseConfig);
      expect(result.zone).toBe('STOP_LOSS');
      expect(result.gridIndex).toBeGreaterThanOrEqual(baseConfig.mainGridCount);
    });

    it('returns zone LOSS_EXIT when price below liquidationPrice', () => {
      const result = computeTargetPosition(1750, baseConfig);
      expect(result.zone).toBe('LOSS_EXIT');
      expect(result.targetBoughtSize).toBe(0);
      expect(result.targetHoldSize).toBe(0);
    });

    it('returns zone PROFIT_EXIT when price above takeProfitPrice', () => {
      const result = computeTargetPosition(2300, baseConfig);
      expect(result.zone).toBe('PROFIT_EXIT');
      expect(result.targetBoughtSize).toBe(0);
      expect(result.targetHoldSize).toBe(0);
    });

    it('calculates correct gridIndex in stop-loss zone', () => {
      // d=420, boxDepth=445, slStep=10 → slGrids = floor((445-420)/10)=2, gridIndex = 10 + 2 = 12
      const result = computeTargetPosition(1780, baseConfig);
      expect(result.gridIndex).toBe(12);
    });

    it('returns lines object', () => {
      const result = computeTargetPosition(2000, baseConfig);
      expect(result.lines).toBeDefined();
      expect(result.lines.takeProfitPrice).toBe(baseConfig.takeProfitPrice);
      expect(result.lines.mainGridDepth).toBe(baseConfig.mainGridCount * baseConfig.mainGridStep);
    });
  });

  describe('SHORT direction (mirror of LONG)', () => {
    const shortConfig: BoxTargetConfig = { ...baseConfig, direction: 'SHORT' };

    it('returns zone MAIN when price in main grid (mirror of LONG@2000)', () => {
      // LONG@2000 d=200 → SHORT mirror price = 2200 + 200 = 2400
      const result = computeTargetPosition(2400, shortConfig);
      expect(result.zone).toBe('MAIN');
      const longResult = computeTargetPosition(2000, baseConfig);
      expect(result.targetBoughtSize).toBe(longResult.targetBoughtSize);
      expect(result.targetHoldSize).toBe(longResult.targetHoldSize);
      expect(result.gridIndex).toBe(longResult.gridIndex);
    });

    it('returns zone STOP_LOSS when price in stop-loss area (mirror of LONG@1780)', () => {
      // LONG@1780 d=420 → SHORT mirror price = 2200 + 420 = 2620
      const result = computeTargetPosition(2620, shortConfig);
      expect(result.zone).toBe('STOP_LOSS');
      const longResult = computeTargetPosition(1780, baseConfig);
      expect(result.gridIndex).toBe(longResult.gridIndex);
    });

    it('returns zone PROFIT_EXIT when price below takeProfitPrice (mirror of LONG@2300)', () => {
      // LONG@2300 d=-100 (PROFIT_EXIT) → SHORT mirror price = 2200 - 100 = 2100
      const result = computeTargetPosition(2100, shortConfig);
      expect(result.zone).toBe('PROFIT_EXIT');
      expect(result.targetBoughtSize).toBe(0);
      expect(result.targetHoldSize).toBe(0);
    });

    it('returns zone LOSS_EXIT when price above liquidationPrice (mirror of LONG@1750)', () => {
      // LONG@1750 d=450 (LOSS_EXIT) → SHORT mirror price = 2200 + 450 = 2650
      const result = computeTargetPosition(2650, shortConfig);
      expect(result.zone).toBe('LOSS_EXIT');
      expect(result.targetBoughtSize).toBe(0);
      expect(result.targetHoldSize).toBe(0);
    });
  });
});

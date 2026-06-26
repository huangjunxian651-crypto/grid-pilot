import { describe, it, expect } from 'vitest';
import { gridIndexToBuyPrice, gridIndexToSellPrice, priceToGridIndex } from './index-utils';
import type { BoxTargetConfig as TargetPositionConfig } from '@gridpilot/shared-types';

describe('gridIndexToBuyPrice', () => {
  const baseConfig: TargetPositionConfig = {
    takeProfitPrice: 2000,
    mainGridCount: 10,
    mainGridStep: 10,
    mainGridPortionSize: 0.01,
    stopLossGridCount: 4,
    stopLossGridStep: 5,
    isolationStep: 5,
    direction: 'LONG',
  };

  describe('LONG 方向', () => {
    it('GridIndex 0 → takeProfitPrice - mainGridStep（主网格下沿）', () => {
      const result = gridIndexToBuyPrice(0, baseConfig);
      expect(result).toBe(1990); // 2000 - 10
    });

    it('GridIndex 1 → takeProfitPrice - 2 × mainGridStep', () => {
      const result = gridIndexToBuyPrice(1, baseConfig);
      expect(result).toBe(1980); // 2000 - 20
    });

    it('GridIndex mainGridCount - 1 → fullPositionPrice', () => {
      const result = gridIndexToBuyPrice(9, baseConfig);
      expect(result).toBe(1900); // 2000 - 10×10
    });

    it('GridIndex mainGridCount（隔离区）→ fullPositionPrice', () => {
      const result = gridIndexToBuyPrice(10, baseConfig);
      expect(result).toBe(1900); // fullPositionPrice
    });

    it('无效 GridIndex（-1）→ 抛出错误', () => {
      expect(() => gridIndexToBuyPrice(-1, baseConfig)).toThrow('Invalid gridIndex');
    });

    it('无效 GridIndex（mainGridCount + 1）→ 抛出错误', () => {
      expect(() => gridIndexToBuyPrice(11, baseConfig)).toThrow('Invalid gridIndex');
    });
  });

  // SHORT 镜像几何：toPrice(d)=2000+d；reduce 边（买回）=toPrice(i×step)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('GridIndex 0 → toPrice(0)=takeProfitPrice（主网格止盈端）', () => {
      const result = gridIndexToBuyPrice(0, shortConfig);
      expect(result).toBe(2000);
    });

    it('GridIndex 1 → toPrice(step)', () => {
      const result = gridIndexToBuyPrice(1, shortConfig);
      expect(result).toBe(2010); // 2000 + 10
    });

    it('GridIndex mainGridCount - 1 → toPrice(9×step)', () => {
      const result = gridIndexToBuyPrice(9, shortConfig);
      expect(result).toBe(2090); // 2000 + 90
    });

    it('GridIndex mainGridCount（隔离区）→ toPrice(isolationEndDepth=105)', () => {
      const result = gridIndexToBuyPrice(10, shortConfig);
      expect(result).toBe(2105); // 2000 + 105
    });

    it('无效 GridIndex（-1）→ 抛出错误', () => {
      expect(() => gridIndexToBuyPrice(-1, shortConfig)).toThrow('Invalid gridIndex');
    });

    it('无效 GridIndex（mainGridCount + 1）→ 抛出错误', () => {
      expect(() => gridIndexToBuyPrice(11, shortConfig)).toThrow('Invalid gridIndex');
    });
  });
});

describe('gridIndexToSellPrice', () => {
  const baseConfig: TargetPositionConfig = {
    takeProfitPrice: 2000,
    mainGridCount: 10,
    mainGridStep: 10,
    mainGridPortionSize: 0.01,
    stopLossGridCount: 4,
    stopLossGridStep: 5,
    isolationStep: 5,
    direction: 'LONG',
  };

  describe('LONG 方向', () => {
    it('GridIndex 0 → takeProfitPrice（上沿）', () => {
      const result = gridIndexToSellPrice(0, baseConfig);
      expect(result).toBe(2000);
    });

    it('GridIndex 1 → takeProfitPrice - mainGridStep', () => {
      const result = gridIndexToSellPrice(1, baseConfig);
      expect(result).toBe(1990);
    });

    it('GridIndex mainGridCount - 1 → fullPositionPrice + step', () => {
      const result = gridIndexToSellPrice(9, baseConfig);
      expect(result).toBe(1910);
    });

    it('GridIndex mainGridCount（隔离区）→ stopLossStartPrice', () => {
      const result = gridIndexToSellPrice(10, baseConfig);
      expect(result).toBe(1895); // fullPositionPrice - isolationStep
    });

    it('无效 GridIndex（-1）→ 抛出错误', () => {
      expect(() => gridIndexToSellPrice(-1, baseConfig)).toThrow('Invalid gridIndex');
    });

    it('无效 GridIndex（mainGridCount + 1）→ 抛出错误', () => {
      expect(() => gridIndexToSellPrice(11, baseConfig)).toThrow('Invalid gridIndex');
    });
  });

  // SHORT 镜像几何：add 边（加空）=toPrice((i+1)×step)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('GridIndex 0 → toPrice(step)', () => {
      const result = gridIndexToSellPrice(0, shortConfig);
      expect(result).toBe(2010);
    });

    it('GridIndex 1 → toPrice(2 × step)', () => {
      const result = gridIndexToSellPrice(1, shortConfig);
      expect(result).toBe(2020);
    });

    it('GridIndex mainGridCount - 1 → toPrice(mainGridCount × step)', () => {
      const result = gridIndexToSellPrice(9, shortConfig);
      expect(result).toBe(2100); // 2000 + 100
    });

    it('GridIndex mainGridCount（隔离区）→ toPrice(mainGridDepth=100)', () => {
      const result = gridIndexToSellPrice(10, shortConfig);
      expect(result).toBe(2100);
    });

    it('无效 GridIndex（-1）→ 抛出错误', () => {
      expect(() => gridIndexToSellPrice(-1, shortConfig)).toThrow('Invalid gridIndex');
    });

    it('无效 GridIndex（mainGridCount + 1）→ 抛出错误', () => {
      expect(() => gridIndexToSellPrice(11, shortConfig)).toThrow('Invalid gridIndex');
    });
  });
});

describe('priceToGridIndex', () => {
  const baseConfig: TargetPositionConfig = {
    takeProfitPrice: 2000,
    mainGridCount: 10,
    mainGridStep: 10,
    mainGridPortionSize: 0.01,
    stopLossGridCount: 4,
    stopLossGridStep: 5,
    isolationStep: 5,
    direction: 'LONG',
  };

  describe('LONG 方向', () => {
    it('price = takeProfitPrice → 返回 0', () => {
      const result = priceToGridIndex(2000, baseConfig);
      expect(result).toBe(0);
    });

    it('price = takeProfitPrice - 0.5 × step → 返回 0', () => {
      const result = priceToGridIndex(1995, baseConfig);
      expect(result).toBe(0);
    });

    it('price = fullPositionPrice + ε → 返回 mainGridCount - 1', () => {
      const result = priceToGridIndex(1900.1, baseConfig);
      expect(result).toBe(9);
    });

    it('price = fullPositionPrice + isolationStep/2 → 返回 mainGridCount（隔离区）', () => {
      const result = priceToGridIndex(1897.5, baseConfig);
      expect(result).toBe(10);
    });

    it('price = stopLossStartPrice + ε → 返回 mainGridCount（隔离区）', () => {
      const result = priceToGridIndex(1895.1, baseConfig);
      expect(result).toBe(10);
    });

    it('price = stopLossStartPrice → 返回 null（止损区）', () => {
      const result = priceToGridIndex(1895, baseConfig);
      expect(result).toBeNull();
    });

    it('price = liquidationPrice + ε → 返回 null（止损区）', () => {
      const result = priceToGridIndex(1875.1, baseConfig);
      expect(result).toBeNull();
    });

    it('price 越过 takeProfitPrice → 返回 null（PROFIT_EXIT）', () => {
      const result = priceToGridIndex(2001, baseConfig);
      expect(result).toBeNull();
    });

    it('price <= liquidationPrice → 返回 null（LOSS_EXIT）', () => {
      const result = priceToGridIndex(1875, baseConfig);
      expect(result).toBeNull();
    });
  });

  // SHORT 镜像几何：d=price-2000；主网格 d∈[0,100)，隔离区 d∈[100,105)，止损区 d∈[105,125)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('price = takeProfitPrice + ε → 返回 0', () => {
      const result = priceToGridIndex(2000.1, shortConfig);
      expect(result).toBe(0);
    });

    it('price = takeProfitPrice + 6 × mainGridStep + ε → 返回 6', () => {
      const result = priceToGridIndex(2060.1, shortConfig);
      expect(result).toBe(6);
    });

    it('price = takeProfitPrice + 7 × mainGridStep - ε → 返回 6', () => {
      const result = priceToGridIndex(2069.9, shortConfig);
      expect(result).toBe(6);
    });

    it('price = takeProfitPrice + 7 × mainGridStep → 返回 7', () => {
      const result = priceToGridIndex(2070, shortConfig);
      expect(result).toBe(7);
    });

    it('price = fullPositionPrice - ε → 返回 9', () => {
      const result = priceToGridIndex(2099.9, shortConfig);
      expect(result).toBe(9);
    });

    it('price = fullPositionPrice + isolationStep/2 → 返回 mainGridCount（隔离区）', () => {
      const result = priceToGridIndex(2102.5, shortConfig);
      expect(result).toBe(10);
    });

    it('price = stopLossStartPrice - ε → 返回 mainGridCount（隔离区）', () => {
      const result = priceToGridIndex(2104.9, shortConfig);
      expect(result).toBe(10);
    });

    it('price = stopLossStartPrice → 返回 null（止损区）', () => {
      const result = priceToGridIndex(2105, shortConfig);
      expect(result).toBeNull();
    });

    it('price = takeProfitPrice → 返回 0（止盈端边界，与 LONG 镜像）', () => {
      const result = priceToGridIndex(2000, shortConfig);
      expect(result).toBe(0);
    });

    it('price < takeProfitPrice → 返回 null（PROFIT_EXIT）', () => {
      const result = priceToGridIndex(1999.9, shortConfig);
      expect(result).toBeNull();
    });

    it('price >= liquidationPrice → 返回 null（LOSS_EXIT）', () => {
      const result = priceToGridIndex(2125, shortConfig);
      expect(result).toBeNull();
    });
  });
});

import { describe, it, expect } from 'vitest';
import { stopLossIndexToBuyPrice, stopLossIndexToSellPrice, priceToStopLossIndex } from './stop-loss-utils';
import type { BoxTargetConfig as TargetPositionConfig } from '@gridpilot/shared-types';

describe('stopLossIndexToBuyPrice', () => {
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
    it('StopLossIndex 0 → liquidationPrice + stopLossGridStep（止损区上沿）', () => {
      const result = stopLossIndexToBuyPrice(0, baseConfig);
      expect(result).toBe(1880); // liquidationPrice + step = 1875 + 5
    });

    it('StopLossIndex 1 → liquidationPrice + 2 × stopLossGridStep', () => {
      const result = stopLossIndexToBuyPrice(1, baseConfig);
      expect(result).toBe(1885); // 1875 + 10
    });

    it('StopLossIndex stopLossGridCount - 1 → takeProfitPrice - isolationStep', () => {
      const result = stopLossIndexToBuyPrice(3, baseConfig);
      expect(result).toBe(1895); // 2000 - 5
    });

    it('StopLossIndex stopLossGridCount（隔离区）→ liquidationPrice', () => {
      const result = stopLossIndexToBuyPrice(4, baseConfig);
      expect(result).toBe(1875); // liquidationPrice
    });

    it('无效 StopLossIndex（-1）→ 抛出错误', () => {
      expect(() => stopLossIndexToBuyPrice(-1, baseConfig)).toThrow('Invalid stopLossIndex');
    });

    it('无效 StopLossIndex（stopLossGridCount + 1）→ 抛出错误', () => {
      expect(() => stopLossIndexToBuyPrice(5, baseConfig)).toThrow('Invalid stopLossIndex');
    });
  });

  // SHORT 镜像几何：toPrice(d)=2000+d, boxDepth=125；reduce 边（买回）=toPrice(boxDepth - j×slStep)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('StopLossIndex 0 → toPrice(boxDepth)=liquidationPrice', () => {
      const result = stopLossIndexToBuyPrice(0, shortConfig);
      expect(result).toBe(2125); // 2000 + 125
    });

    it('StopLossIndex 1 → toPrice(boxDepth - slStep)', () => {
      const result = stopLossIndexToBuyPrice(1, shortConfig);
      expect(result).toBe(2120); // 2000 + 120
    });

    it('StopLossIndex stopLossGridCount - 1 → toPrice(boxDepth - 3×slStep)', () => {
      const result = stopLossIndexToBuyPrice(3, shortConfig);
      expect(result).toBe(2110); // 2000 + 110
    });

    it('StopLossIndex stopLossGridCount（隔离区）→ toPrice(boxDepth)', () => {
      const result = stopLossIndexToBuyPrice(4, shortConfig);
      expect(result).toBe(2125); // 2000 + 125
    });

    it('无效 StopLossIndex（-1）→ 抛出错误', () => {
      expect(() => stopLossIndexToBuyPrice(-1, shortConfig)).toThrow('Invalid stopLossIndex');
    });

    it('无效 StopLossIndex（stopLossGridCount + 1）→ 抛出错误', () => {
      expect(() => stopLossIndexToBuyPrice(5, shortConfig)).toThrow('Invalid stopLossIndex');
    });
  });
});

describe('stopLossIndexToSellPrice', () => {
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
    it('StopLossIndex 0 → liquidationPrice（止损区下沿）', () => {
      const result = stopLossIndexToSellPrice(0, baseConfig);
      expect(result).toBe(1875); // liquidationPrice
    });

    it('StopLossIndex 1 → liquidationPrice + stopLossGridStep', () => {
      const result = stopLossIndexToSellPrice(1, baseConfig);
      expect(result).toBe(1880); // 1875 + 5
    });

    it('StopLossIndex stopLossGridCount - 1 → takeProfitPrice - isolationStep - stopLossGridStep', () => {
      const result = stopLossIndexToSellPrice(3, baseConfig);
      expect(result).toBe(1890); // 2000 - 5 - 5
    });

    it('StopLossIndex stopLossGridCount（隔离区）→ stopLossStartPrice', () => {
      const result = stopLossIndexToSellPrice(4, baseConfig);
      expect(result).toBe(1895); // stopLossStartPrice = fullPositionPrice - isolationStep
    });

    it('无效 StopLossIndex（-1）→ 抛出错误', () => {
      expect(() => stopLossIndexToSellPrice(-1, baseConfig)).toThrow('Invalid stopLossIndex');
    });

    it('无效 StopLossIndex（stopLossGridCount + 1）→ 抛出错误', () => {
      expect(() => stopLossIndexToSellPrice(5, baseConfig)).toThrow('Invalid stopLossIndex');
    });
  });

  // SHORT 镜像几何：add 边（加空）=toPrice(boxDepth - (j+1)×slStep)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('StopLossIndex 0 → toPrice(boxDepth - slStep)', () => {
      const result = stopLossIndexToSellPrice(0, shortConfig);
      expect(result).toBe(2120); // 2000 + 120
    });

    it('StopLossIndex 1 → toPrice(boxDepth - 2 × slStep)', () => {
      const result = stopLossIndexToSellPrice(1, shortConfig);
      expect(result).toBe(2115); // 2000 + 115
    });

    it('StopLossIndex stopLossGridCount - 1 → toPrice(boxDepth - 4 × slStep)', () => {
      const result = stopLossIndexToSellPrice(3, shortConfig);
      expect(result).toBe(2105); // 2000 + 105
    });

    it('StopLossIndex stopLossGridCount（隔离区）→ toPrice(isolationEndDepth=105)', () => {
      const result = stopLossIndexToSellPrice(4, shortConfig);
      expect(result).toBe(2105); // 2000 + 105
    });

    it('无效 StopLossIndex（-1）→ 抛出错误', () => {
      expect(() => stopLossIndexToSellPrice(-1, shortConfig)).toThrow('Invalid stopLossIndex');
    });

    it('无效 StopLossIndex（stopLossGridCount + 1）→ 抛出错误', () => {
      expect(() => stopLossIndexToSellPrice(5, shortConfig)).toThrow('Invalid stopLossIndex');
    });
  });
});

describe('priceToStopLossIndex', () => {
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
    it('price = liquidationPrice + ε → 返回 0', () => {
      const result = priceToStopLossIndex(1875.1, baseConfig);
      expect(result).toBe(0);
    });

    it('price = stopLossStartPrice - ε → 返回 stopLossGridCount - 1', () => {
      const result = priceToStopLossIndex(1894.9, baseConfig);
      expect(result).toBe(3);
    });

    it('price = stopLossStartPrice → 返回 stopLossGridCount（隔离区）', () => {
      const result = priceToStopLossIndex(1895, baseConfig);
      expect(result).toBe(4);
    });

    it('price = fullPositionPrice - ε → 返回 stopLossGridCount（隔离区）', () => {
      const result = priceToStopLossIndex(1899.9, baseConfig);
      expect(result).toBe(4);
    });

    it('price = fullPositionPrice → 返回 null（主网格区）', () => {
      const result = priceToStopLossIndex(1900, baseConfig);
      expect(result).toBeNull();
    });

    it('price > fullPositionPrice → 返回 null（主网格区）', () => {
      const result = priceToStopLossIndex(1950, baseConfig);
      expect(result).toBeNull();
    });

    it('price <= liquidationPrice → 返回 null（LOSS_EXIT）', () => {
      const result = priceToStopLossIndex(1875, baseConfig);
      expect(result).toBeNull();
    });
  });

  // SHORT 镜像几何：d=price-2000；主网格 d≤100，隔离区 d∈(100,105)，止损区 d∈[105,125)
  describe('SHORT 方向（镜像）', () => {
    const shortConfig: TargetPositionConfig = { ...baseConfig, direction: 'SHORT' };

    it('price = fullPositionPrice - ε → 返回 null（主网格区）', () => {
      const result = priceToStopLossIndex(2099.9, shortConfig);
      expect(result).toBeNull();
    });

    it('price = fullPositionPrice → 返回 null（主网格区边界）', () => {
      const result = priceToStopLossIndex(2100, shortConfig);
      expect(result).toBeNull();
    });

    it('price = fullPositionPrice + ε → 返回 stopLossGridCount（隔离区）', () => {
      const result = priceToStopLossIndex(2100.1, shortConfig);
      expect(result).toBe(4);
    });

    it('price = stopLossStartPrice - ε → 返回 stopLossGridCount（隔离区）', () => {
      const result = priceToStopLossIndex(2104.9, shortConfig);
      expect(result).toBe(4);
    });

    it('price = stopLossStartPrice + ε → 返回 stopLossGridCount - 1（止损区）', () => {
      const result = priceToStopLossIndex(2105.1, shortConfig);
      expect(result).toBe(3);
    });

    it('price = liquidationPrice - 3 × slStep → 返回 3', () => {
      const result = priceToStopLossIndex(2110, shortConfig);
      expect(result).toBe(3);
    });

    it('price = liquidationPrice - 2 × slStep → 返回 2', () => {
      const result = priceToStopLossIndex(2115, shortConfig);
      expect(result).toBe(2);
    });

    it('price = liquidationPrice - slStep → 返回 1', () => {
      const result = priceToStopLossIndex(2120, shortConfig);
      expect(result).toBe(1);
    });

    it('price = liquidationPrice - ε → 返回 0（止损区）', () => {
      const result = priceToStopLossIndex(2124.9, shortConfig);
      expect(result).toBe(0);
    });

    it('price = liquidationPrice → 返回 null（LOSS_EXIT）', () => {
      const result = priceToStopLossIndex(2125, shortConfig);
      expect(result).toBeNull();
    });

    it('price <= fullPositionPrice → 返回 null（主网格区）', () => {
      const result = priceToStopLossIndex(2100, shortConfig);
      expect(result).toBeNull();
    });
  });
});

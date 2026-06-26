import { isPlaceable } from './grid-geometry';

describe('grid-geometry', () => {
  describe('isPlaceable', () => {
    const symbolInfo = { minQty: 0.001, minNotional: 5, quantoMultiplier: 1 };

    it('accepts an order that clears both minQty and minNotional', () => {
      expect(isPlaceable(0.05, 2000, symbolInfo)).toBe(true);
    });

    it('rejects an order below minQty', () => {
      expect(isPlaceable(0.0005, 2000, symbolInfo)).toBe(false);
    });

    it('rejects an order below minNotional', () => {
      expect(isPlaceable(0.002, 2000, symbolInfo)).toBe(false);
    });

    it('applies the quanto multiplier to notional', () => {
      expect(isPlaceable(0.01, 2000, { minQty: 0.001, minNotional: 5, quantoMultiplier: 0.001 })).toBe(false);
    });

    it('treats zero/absent limits as no constraint', () => {
      expect(isPlaceable(0.0005, 2000, { minQty: 0, minNotional: 0, quantoMultiplier: 1 })).toBe(true);
    });
  });
});

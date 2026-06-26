import { describe, it, expect } from 'vitest';
import { formatPrice, formatQty, getPrecision, toFixedPrecision } from './format-precision';

describe('format-precision', () => {
  describe('formatPrice - rounds to tick size (Go RoundPrice)', () => {
    it('rounds correctly for tickSize=0.01', () => {
      expect(formatPrice(2197.834, 0.01)).toBeCloseTo(2197.83, 4);
      expect(formatPrice(2197.835, 0.01)).toBeCloseTo(2197.84, 4); // round-half-up at 5
      expect(formatPrice(2197.836, 0.01)).toBeCloseTo(2197.84, 4);
    });

    it('rounds correctly for tickSize=0.05 (non-decimal)', () => {
      expect(formatPrice(100.05, 0.05)).toBeCloseTo(100.05, 4);
      expect(formatPrice(100.025, 0.05)).toBeCloseTo(100.05, 4); // 100.025 * 20 = 2000.5 → 2001 → 100.05
      expect(formatPrice(100.075, 0.05)).toBeCloseTo(100.10, 4);
    });

    it('rounds correctly for tickSize=0.005', () => {
      expect(formatPrice(100.005, 0.005)).toBeCloseTo(100.005, 4);
      expect(formatPrice(100.002, 0.005)).toBeCloseTo(100.000, 4);
      expect(formatPrice(100.003, 0.005)).toBeCloseTo(100.005, 4);
    });

    it('passes through when tickSize <= 0', () => {
      expect(formatPrice(123.456, 0)).toBe(123.456);
      expect(formatPrice(123.456, -0.01)).toBe(123.456);
    });
  });

  describe('formatQty - floors to step size (Go RoundQty)', () => {
    it('floors correctly for stepSize=0.001', () => {
      expect(formatQty(0.1239, 0.001)).toBeCloseTo(0.123, 4);
      expect(formatQty(0.1234, 0.001)).toBeCloseTo(0.123, 4);
      expect(formatQty(0.1230, 0.001)).toBeCloseTo(0.123, 4);
    });

    it('handles epsilon guard (prevents float under-floor)', () => {
      // 0.3 * 1000 = 300, but floating point might give 299.9999999
      // epsilon guard ensures we get 0.3 not 0.299
      expect(formatQty(0.3, 0.1)).toBeCloseTo(0.3, 4);
      expect(formatQty(0.6, 0.2)).toBeCloseTo(0.6, 4);
    });

    it('handles division remainders (real-world case)', () => {
      // portionSize = 0.1 / 3 = 0.033333...
      // stepSize = 0.001 → should floor to 0.033
      expect(formatQty(0.033333333, 0.001)).toBeCloseTo(0.033, 4);
      // Larger: 0.5 / 7 ≈ 0.071428 → floor 0.071
      expect(formatQty(0.071428, 0.001)).toBeCloseTo(0.071, 4);
    });

    it('passes through when stepSize <= 0', () => {
      expect(formatQty(0.123, 0)).toBe(0.123);
    });
  });

  describe('getPrecision', () => {
    it('counts decimal places from step size', () => {
      expect(getPrecision(0.001)).toBe(3);
      expect(getPrecision(0.01)).toBe(2);
      expect(getPrecision(0.1)).toBe(1);
      expect(getPrecision(1)).toBe(0);
    });

    it('handles edge cases', () => {
      expect(getPrecision(0.005)).toBe(3);
      expect(getPrecision(0.05)).toBe(2);
      expect(getPrecision(0.0001)).toBe(4);
    });
  });

  describe('toFixedPrecision', () => {
    it('formats to fixed decimal places', () => {
      expect(toFixedPrecision(2197.834, 2)).toBe('2197.83');
      expect(toFixedPrecision(2197.836, 2)).toBe('2197.84');
      expect(toFixedPrecision(0.033, 3)).toBe('0.033');
    });
  });
});

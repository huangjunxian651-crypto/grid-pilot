import { describe, it, expect } from 'vitest';
import { detectPositionDrift } from './detect-position-drift';

describe('detectPositionDrift', () => {
  it('差值超过阈值时返回 true', () => {
    expect(detectPositionDrift(0.475, 0.55, 0.05)).toBe(true);
  });

  it('差值恰好等于阈值时返回 false（边界不算漂移）', () => {
    expect(detectPositionDrift(0.5, 0.55, 0.05)).toBe(false);
  });

  it('差值在阈值内返回 false', () => {
    expect(detectPositionDrift(0.52, 0.55, 0.05)).toBe(false);
  });

  it('方向无关：DB 高于交易所同样判定漂移', () => {
    expect(detectPositionDrift(0.6, 0.5, 0.05)).toBe(true);
  });

  it('跨零持仓（多空反向）也按绝对差值判断', () => {
    expect(detectPositionDrift(-0.02, 0.03, 0.03)).toBe(true);
  });
});

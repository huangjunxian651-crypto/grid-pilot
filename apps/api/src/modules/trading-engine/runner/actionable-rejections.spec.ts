import { describe, it, expect } from 'vitest';
import { isActionableRejection } from './actionable-rejections';

describe('isActionableRejection', () => {
  it('白名单内的错误码可操作', () => {
    expect(isActionableRejection('ACCOUNT_MODE_RESTRICTED')).toBe(true);
    expect(isActionableRejection('51008')).toBe(true);
    expect(isActionableRejection('51010')).toBe(true);
  });

  it('白名单外或缺失的错误码不可操作', () => {
    expect(isActionableRejection('SOME_RANDOM_CODE')).toBe(false);
    expect(isActionableRejection(undefined)).toBe(false);
  });
});

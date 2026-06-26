import { describe, it, expect } from 'vitest';
import { groupConfigsByRobot, type ConfigRow } from './group-configs-by-robot';

const row = (id: string, credentialId: string, symbol: string, direction: string): ConfigRow =>
  ({ id, credentialId, symbol, direction });

describe('groupConfigsByRobot', () => {
  it('returns empty array for no configs', () => {
    expect(groupConfigsByRobot([])).toEqual([]);
  });

  it('groups a single config into one group', () => {
    const out = groupConfigsByRobot([row('c1', 'cred-1', 'ETH/USDT', 'LONG')]);
    expect(out).toEqual([
      { credentialId: 'cred-1', symbol: 'ETH/USDT', direction: 'LONG', configIds: ['c1'] },
    ]);
  });

  it('merges configs with same (credentialId, symbol, direction) into one group', () => {
    const out = groupConfigsByRobot([
      row('c1', 'cred-1', 'ETH/USDT', 'LONG'),
      row('c2', 'cred-1', 'ETH/USDT', 'LONG'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].configIds).toEqual(['c1', 'c2']);
  });

  it('splits configs with different direction into separate groups', () => {
    const out = groupConfigsByRobot([
      row('c1', 'cred-1', 'ETH/USDT', 'LONG'),
      row('c2', 'cred-1', 'ETH/USDT', 'SHORT'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('splits configs from different credentials into separate groups', () => {
    const out = groupConfigsByRobot([
      row('c1', 'cred-1', 'ETH/USDT', 'LONG'),
      row('c2', 'cred-2', 'ETH/USDT', 'LONG'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('preserves first-seen group order', () => {
    const out = groupConfigsByRobot([
      row('c1', 'cred-2', 'BTC/USDT', 'SHORT'),
      row('c2', 'cred-1', 'ETH/USDT', 'LONG'),
    ]);
    expect(out[0].credentialId).toBe('cred-2');
    expect(out[1].credentialId).toBe('cred-1');
  });
});

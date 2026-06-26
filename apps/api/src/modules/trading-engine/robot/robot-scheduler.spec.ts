import { describe, it, expect, vi } from 'vitest';
import { RobotScheduler } from './robot-scheduler';
import type { BoxCandidate } from './decide-box-activation';

const box = (overrides?: Partial<BoxCandidate>): BoxCandidate => ({
  configId: 'box-1',
  direction: 'LONG',
  takeProfitPrice: 2800,
  mainGridCount: 200,
  mainGridStep: 2,
  stopLossGridCount: 4,
  stopLossGridStep: 2,
  isolationStep: 2,
  activationPrice: 0,
  trailingEntry: true,
  ...overrides,
});

function makeScheduler(boxes: BoxCandidate[], activate = vi.fn().mockResolvedValue(undefined)) {
  const scheduler = new RobotScheduler({
    loadBoxes: () => boxes,
    activateBox: activate,
  });
  return { scheduler, activate };
}

describe('RobotScheduler', () => {
  it('does not activate when price is outside the window', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    await scheduler.onTick(2700);
    expect(activate).not.toHaveBeenCalled();
    expect(scheduler.activeBox).toBeNull();
  });

  it('activates a box when price enters the window and tracks it as active', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    await scheduler.onTick(2550);
    expect(activate).toHaveBeenCalledWith('box-1', 'TRAILING_ENTRY');
    expect(scheduler.activeBox).toBe('box-1');
  });

  it('does not activate a second box while one is already active (single-active invariant)', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    await scheduler.onTick(2550);
    expect(activate).toHaveBeenCalledTimes(1);
    await scheduler.onTick(2520);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(scheduler.activeBox).toBe('box-1');
  });

  it('re-evaluates and activates again after the active box terminates (relay)', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    await scheduler.onTick(2550);
    expect(scheduler.activeBox).toBe('box-1');

    scheduler.onBoxTerminated('box-1');
    expect(scheduler.activeBox).toBeNull();

    await scheduler.onTick(2500);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(scheduler.activeBox).toBe('box-1');
  });

  it('ignores onBoxTerminated for a non-active box', async () => {
    const { scheduler } = makeScheduler([box()]);
    await scheduler.onTick(2550);
    scheduler.onBoxTerminated('some-other-box');
    expect(scheduler.activeBox).toBe('box-1');
  });

  it('uses RUNNING mode when price rises into the window (price >= lastPrice)', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    await scheduler.onTick(2450);
    scheduler.onBoxTerminated('box-1');
    await scheduler.onTick(2500);
    expect(activate).toHaveBeenLastCalledWith('box-1', 'RUNNING');
  });

  it('does not set active box if activateBox rejects, allowing retry after backoff', async () => {
    let now = 0;
    const activate = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const scheduler = new RobotScheduler({
      loadBoxes: () => [box()],
      activateBox: activate,
      now: () => now,
    });
    await expect(scheduler.onTick(2550)).rejects.toThrow('boom');
    expect(scheduler.activeBox).toBeNull();
    now = 5001;
    await scheduler.onTick(2500);
    expect(scheduler.activeBox).toBe('box-1');
    expect(activate).toHaveBeenCalledTimes(2);
  });

  describe('activation failure backoff', () => {
    function makeFailingScheduler(activate: ReturnType<typeof vi.fn>, onGivenUp = vi.fn()) {
      let now = 0;
      const scheduler = new RobotScheduler({
        loadBoxes: () => [box()],
        activateBox: activate,
        now: () => now,
        onActivationGivenUp: onGivenUp,
      });
      return { scheduler, onGivenUp, setNow: (t: number) => { now = t; } };
    }

    it('does not retry activation inside the backoff window', async () => {
      const activate = vi.fn().mockRejectedValue(new Error('boom'));
      const { scheduler, setNow } = makeFailingScheduler(activate);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom');
      setNow(1000);
      await scheduler.onTick(2550);
      expect(activate).toHaveBeenCalledTimes(1);
      setNow(4999);
      await scheduler.onTick(2550);
      expect(activate).toHaveBeenCalledTimes(1);
    });

    it('doubles the backoff window after each consecutive failure', async () => {
      const activate = vi.fn().mockRejectedValue(new Error('boom'));
      const { scheduler, setNow } = makeFailingScheduler(activate);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom'); // 失败#1，退避 5s
      setNow(5001);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom'); // 失败#2，退避 10s
      setNow(10000); // 5001 + 4999 < 5001 + 10000
      await scheduler.onTick(2550);
      expect(activate).toHaveBeenCalledTimes(2);
      setNow(15002);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom'); // 失败#3
      expect(activate).toHaveBeenCalledTimes(3);
    });

    it('a successful activation resets the failure counter', async () => {
      const activate = vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(undefined);
      const { scheduler, setNow } = makeFailingScheduler(activate);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom'); // 失败#1
      setNow(5001);
      await scheduler.onTick(2550); // 成功，计数清零
      scheduler.onBoxTerminated('box-1');
      setNow(6000);
      await expect(scheduler.onTick(2550)).rejects.toThrow('boom'); // 失败，重新从 5s 退避起步
      setNow(11001); // 6000 + 5001：若未重置（10s 窗口）此时不会重试
      await scheduler.onTick(2550);
      expect(scheduler.activeBox).toBe('box-1');
      expect(activate).toHaveBeenCalledTimes(4);
    });

    it('gives up after 5 consecutive failures and notifies via onActivationGivenUp', async () => {
      const activate = vi.fn().mockRejectedValue(new Error('boom'));
      const { scheduler, onGivenUp, setNow } = makeFailingScheduler(activate);
      let t = 0;
      for (let i = 0; i < 5; i++) {
        setNow(t);
        await expect(scheduler.onTick(2550)).rejects.toThrow('boom');
        t += 5000 * 2 ** i + 1;
      }
      expect(activate).toHaveBeenCalledTimes(5);
      expect(onGivenUp).toHaveBeenCalledTimes(1);
      expect(onGivenUp).toHaveBeenCalledWith('box-1', expect.any(Error));

      // 放弃后即使时间继续推进也不再尝试
      setNow(t + 1_000_000);
      await scheduler.onTick(2550);
      expect(activate).toHaveBeenCalledTimes(5);
    });
  });

  it('markActive presets the active box so a subsequent in-window tick does not re-activate', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    scheduler.markActive('box-1');
    expect(scheduler.activeBox).toBe('box-1');
    await scheduler.onTick(2550);
    expect(activate).not.toHaveBeenCalled();
  });

  it('after markActive, onBoxTerminated releases the slot and next tick can activate', async () => {
    const { scheduler, activate } = makeScheduler([box()]);
    scheduler.markActive('box-1');
    scheduler.onBoxTerminated('box-1');
    expect(scheduler.activeBox).toBeNull();
    await scheduler.onTick(2500);
    expect(activate).toHaveBeenCalledTimes(1);
  });
});

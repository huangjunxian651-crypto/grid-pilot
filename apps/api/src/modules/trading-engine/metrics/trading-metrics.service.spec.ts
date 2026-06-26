import { describe, it, expect, beforeEach } from 'vitest';
import { TradingMetricsService } from './trading-metrics.service';

describe('TradingMetricsService', () => {
  let metrics: TradingMetricsService;

  beforeEach(() => {
    metrics = new TradingMetricsService();
  });

  it('should record position deviation', () => {
    metrics.recordPositionDeviation('bot1', 2.5);
    const report = metrics.getMetricsReport();
    expect(report.positionDeviation).toBe(2.5);
  });

  it('should record sentinel coverage ratio', () => {
    metrics.recordSentinelCoverage('bot1', 0.75);
    const report = metrics.getMetricsReport();
    expect(report.sentinelCoverage).toBe(0.75);
  });

  it('should record active order count', () => {
    metrics.recordActiveOrderCount('bot1', 1);
    const report = metrics.getMetricsReport();
    expect(report.activeOrderCount).toBe(1);
  });

  it('should record cache stale seconds', () => {
    metrics.recordCacheStaleSeconds('bot1', 5.2);
    const report = metrics.getMetricsReport();
    expect(report.cacheStaleSeconds).toBe(5.2);
  });

  it('should record event queue depth', () => {
    metrics.recordQueueDepth('bot1', 15);
    const report = metrics.getMetricsReport();
    expect(report.queueDepth).toBe(15);
  });

  it('should record API errors', () => {
    metrics.recordApiError('BINANCE', 'RATE_LIMIT');
    metrics.recordApiError('BINANCE', 'TIMEOUT');
    const report = metrics.getMetricsReport();
    expect(report.apiErrors).toHaveLength(2);
    expect(report.apiErrors[0].exchange).toBe('BINANCE');
    expect(report.apiErrors[0].error).toBe('RATE_LIMIT');
    expect(report.apiErrors[0].timestamp).toBeGreaterThan(0);
  });

  it('should increment order placed counter', () => {
    metrics.incrementOrderPlaced('bot1');
    metrics.incrementOrderPlaced('bot1');
    const report = metrics.getMetricsReport();
    expect(report.totalOrdersPlaced).toBe(2);
  });

  it('should increment fill counter', () => {
    metrics.incrementFill('bot1');
    metrics.incrementFill('bot1');
    metrics.incrementFill('bot1');
    const report = metrics.getMetricsReport();
    expect(report.totalFills).toBe(3);
  });

  it('should increment reorder counter', () => {
    metrics.incrementReorder('bot1');
    const report = metrics.getMetricsReport();
    expect(report.totalReorders).toBe(1);
  });

  it('should record FSM state', () => {
    metrics.recordFsmState('bot1', 'RUNNING');
    const report = metrics.getMetricsReport();
    expect(report.fsmState).toBe('RUNNING');
  });

  it('should return default values for unrecorded metrics', () => {
    const report = metrics.getMetricsReport();
    expect(report.positionDeviation).toBeUndefined();
    expect(report.apiErrors).toEqual([]);
    expect(report.totalOrdersPlaced).toBe(0);
    expect(report.totalFills).toBe(0);
    expect(report.totalReorders).toBe(0);
  });

  it('should reset all metrics', () => {
    metrics.recordPositionDeviation('bot1', 3.0);
    metrics.recordApiError('GATE', 'DISCONNECT');
    metrics.incrementOrderPlaced('bot1');

    metrics.reset();

    const report = metrics.getMetricsReport();
    expect(report.positionDeviation).toBeUndefined();
    expect(report.apiErrors).toEqual([]);
    expect(report.totalOrdersPlaced).toBe(0);
    expect(report.totalFills).toBe(0);
  });

  it('should overwrite previous values on subsequent records', () => {
    metrics.recordPositionDeviation('bot1', 1.0);
    metrics.recordPositionDeviation('bot1', 2.5);
    const report = metrics.getMetricsReport();
    expect(report.positionDeviation).toBe(2.5);
  });
});

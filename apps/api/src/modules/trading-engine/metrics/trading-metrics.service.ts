export interface MetricsReport {
  positionDeviation?: number;
  sentinelCoverage?: number;
  activeOrderCount?: number;
  cacheStaleSeconds?: number;
  queueDepth?: number;
  apiErrors: Array<{ exchange: string; error: string; timestamp: number }>;
  totalOrdersPlaced: number;
  totalFills: number;
  totalReorders: number;
  fsmState?: string;
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class TradingMetricsService {
  private metrics: Partial<MetricsReport> = {
    apiErrors: [],
    totalOrdersPlaced: 0,
    totalFills: 0,
    totalReorders: 0,
  };

  recordPositionDeviation(botId: string, deviation: number): void {
    this.metrics.positionDeviation = deviation;
  }

  recordSentinelCoverage(botId: string, ratio: number): void {
    this.metrics.sentinelCoverage = ratio;
  }

  recordActiveOrderCount(botId: string, count: number): void {
    this.metrics.activeOrderCount = count;
  }

  recordCacheStaleSeconds(botId: string, seconds: number): void {
    this.metrics.cacheStaleSeconds = seconds;
  }

  recordQueueDepth(botId: string, depth: number): void {
    this.metrics.queueDepth = depth;
  }

  recordApiError(exchange: string, error: string): void {
    this.metrics.apiErrors!.push({ exchange, error, timestamp: Date.now() });
  }

  incrementOrderPlaced(botId: string): void {
    this.metrics.totalOrdersPlaced = (this.metrics.totalOrdersPlaced || 0) + 1;
  }

  incrementFill(botId: string): void {
    this.metrics.totalFills = (this.metrics.totalFills || 0) + 1;
  }

  incrementReorder(botId: string): void {
    this.metrics.totalReorders = (this.metrics.totalReorders || 0) + 1;
  }

  recordFsmState(botId: string, state: string): void {
    this.metrics.fsmState = state;
  }

  getMetricsReport(): MetricsReport {
    return {
      apiErrors: [],
      totalOrdersPlaced: 0,
      totalFills: 0,
      totalReorders: 0,
      ...this.metrics,
    };
  }

  reset(): void {
    this.metrics = {
      apiErrors: [],
      totalOrdersPlaced: 0,
      totalFills: 0,
      totalReorders: 0,
    };
  }
}

import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { TradingEngineModule } from './trading-engine.module';
import { TradingMetricsService } from './metrics/trading-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialService } from '../credential/credential.service';
import { AuthGuard } from '../auth/auth.guard';

class MockAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

const mockPrisma = {
  stateSnapshot: { create: vi.fn(), findFirst: vi.fn() },
  eventLog: { create: vi.fn(), findMany: vi.fn() },
  robotSession: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  box: { findUnique: vi.fn() },
} as unknown as PrismaService;

const mockCredentialService = {
  findOneWithSecrets: vi.fn(),
} as unknown as CredentialService;

describe('TradingEngineModule', () => {
  it('should be defined', () => {
    expect(TradingEngineModule).toBeDefined();
  });

  it('should be a NestJS module class', () => {
    expect(typeof TradingEngineModule).toBe('function');
  });

  it('should compile as a NestJS module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TradingEngineModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(CredentialService)
      .useValue(mockCredentialService)
      .overrideGuard(AuthGuard)
      .useClass(MockAuthGuard)
      .compile();

    expect(moduleRef).toBeDefined();
  });

  it('should provide TradingMetricsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TradingEngineModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(CredentialService)
      .useValue(mockCredentialService)
      .overrideGuard(AuthGuard)
      .useClass(MockAuthGuard)
      .compile();

    const service = moduleRef.get<TradingMetricsService>(TradingMetricsService);
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(TradingMetricsService);
  });
});

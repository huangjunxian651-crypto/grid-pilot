import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../../prisma/prisma.service';
import { ExchangeAdapterFactory } from '../../exchange/exchange-adapter.factory';
import { CredentialService } from '../../credential/credential.service';
import { PersistenceService } from '../persistence/persistence.service';
import { TradingMetricsService } from '../metrics/trading-metrics.service';
import { AccountSnapshotService } from '../account/account-snapshot.service';
import { FillIngestionService } from '../fills/fill-ingestion.service';
import { FillReconcileService } from '../fills/fill-reconcile.service';
import { NotificationService } from '../../notification/notification.service';
import { TradingEngineService } from '../trading-engine.service';
import { BotManagerService, type RunnerLauncher, type TickerSource } from './bot-manager.service';
import { PnlLedgerService } from '../savings/pnl-ledger.service';

/**
 * R1 解耦契约:TradingEngineService 不再静态依赖 BotManagerService。
 * 反向边(runner 自动终止 → 通知管理器)改为回调注册,依赖图变为单向 DAG。
 * 这组测试守护「环被消除后,反向通知仍然成立」这一不变量。
 */

function makeTes(prisma: unknown): TradingEngineService {
  // 仅注入 handleAutoTermination 路径需要的依赖,其余传 stub。
  return new TradingEngineService(
    prisma as never,
    {} as never, // adapterFactory
    {} as never, // credentialService
    {} as never, // persistence
    {} as never, // metrics
    { stopPolling: vi.fn() } as never, // accountSnapshot
    {} as never, // moduleRef
    { ingest: vi.fn().mockResolvedValue(undefined) } as never, // fillIngestion
    { reconcileRun: vi.fn().mockResolvedValue(undefined) } as never, // fillReconcile
    { createAndBroadcast: vi.fn().mockResolvedValue({}) } as never, // notificationService
  );
}

describe('R1: TradingEngineService ↔ BotManagerService 解耦', () => {
  it('注册的回调会在 runner 自动终止时收到 (robotId, configId)', async () => {
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', boxId: 'config-1', endedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      box: {
        findUnique: vi.fn().mockResolvedValue({ robotId: 'robot-1' }),
      },
    };
    const tes = makeTes(prisma);

    const received: Array<[string, string]> = [];
    tes.setOnBoxTerminated((robotId, configId) => {
      received.push([robotId, configId]);
    });

    // 触发自动终止路径(私有方法,通过 cast 调用——这是反向边的唯一来源)。
    await (tes as unknown as {
      handleAutoTermination(s: string, k: string): Promise<void>;
    }).handleAutoTermination('SESS_CODE', 'TAKE_PROFIT');

    expect(received).toEqual([['robot-1', 'config-1']]);
  });

  it('未注册回调时,自动终止不应抛错(回调可选)', async () => {
    const prisma = {
      run: {
        findUnique: vi.fn().mockResolvedValue({ id: 'sess-1', boxId: 'config-1', endedAt: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      box: { findUnique: vi.fn().mockResolvedValue({ robotId: 'robot-1' }) },
    };
    const tes = makeTes(prisma);
    await expect(
      (tes as unknown as {
        handleAutoTermination(s: string, k: string): Promise<void>;
      }).handleAutoTermination('SESS_CODE', 'TAKE_PROFIT'),
    ).resolves.toBeUndefined();
  });

  it('BotManagerService 构造时把自己的 onBoxTerminated 注册到 launcher', () => {
    const setOnBoxTerminated = vi.fn();
    const launcher: RunnerLauncher = {
      startBot: vi.fn().mockResolvedValue({ runCode: 'x' }),
      stopBot: vi.fn().mockResolvedValue(undefined),
      detachBot: vi.fn().mockResolvedValue(undefined),
      pauseBot: vi.fn().mockResolvedValue(undefined),
      setOnBoxTerminated,
    };
    const ticker: TickerSource = { subscribe: vi.fn().mockReturnValue(() => {}) };

    const manager = new BotManagerService({} as never, launcher, ticker, { getSnapshot: vi.fn() } as never, { createAndBroadcast: vi.fn().mockResolvedValue({}) } as never, { getBoxesLedger: vi.fn().mockResolvedValue(new Map()) } as never);

    expect(setOnBoxTerminated).toHaveBeenCalledTimes(1);
    // 注册的回调应路由到 manager.onBoxTerminated。
    const registered = setOnBoxTerminated.mock.calls[0][0] as (r: string, c: string) => unknown;
    const spy = vi.spyOn(manager, 'onBoxTerminated').mockResolvedValue(undefined);
    void registered('robot-1', 'config-1');
    expect(spy).toHaveBeenCalledWith('robot-1', 'config-1');
  });

  it('Nest DI 能解析 BotManagerService,且 launcher 是非 null 的真实 TES(守护:launcher 不再为 null)', async () => {
    // 用真实的 @Inject 装饰器走一遍 Nest DI——旧的「两个 useFactory 循环」会让 launcher 为 null。
    const moduleRef = await Test.createTestingModule({
      providers: [
        TradingEngineService,
        BotManagerService,
        { provide: 'BOT_MANAGER_TICKER_SOURCE', useValue: { subscribe: () => () => {} } satisfies TickerSource },
        // TES 的依赖全部用 stub 顶替,只为让 DI 图能完整解析。
        { provide: PrismaService, useValue: {} },
        { provide: ExchangeAdapterFactory, useValue: {} },
        { provide: CredentialService, useValue: {} },
        { provide: PersistenceService, useValue: {} },
        { provide: TradingMetricsService, useValue: {} },
        { provide: AccountSnapshotService, useValue: { setOnChanged: vi.fn(), stopPolling: vi.fn() } },
        { provide: ModuleRef, useValue: { get: vi.fn() } },
        { provide: FillIngestionService, useValue: { ingest: vi.fn() } },
        { provide: FillReconcileService, useValue: { reconcileRun: vi.fn().mockResolvedValue(undefined) } },
        { provide: NotificationService, useValue: { createAndBroadcast: vi.fn().mockResolvedValue({}) } },
        { provide: PnlLedgerService, useValue: { getBoxesLedger: vi.fn().mockResolvedValue(new Map()) } },
      ],
    }).compile();

    const manager = moduleRef.get(BotManagerService);
    const tes = moduleRef.get(TradingEngineService);
    const launcher = (manager as unknown as { launcher: RunnerLauncher | null }).launcher;

    expect(launcher).not.toBeNull();
    expect(launcher).toBe(tes);
  });
});

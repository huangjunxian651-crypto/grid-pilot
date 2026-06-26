import { Module, Logger } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { CredentialModule } from '../credential/credential.module';
import { NotificationModule } from '../notification/notification.module';
import { TradingEngineService } from './trading-engine.service';
import { TradingEngineController } from './trading-engine.controller';
import { TradingEngineGateway } from './trading-engine.gateway';
import { SessionService } from './session/session.service';
import { PersistenceService } from './persistence/persistence.service';
import { FillIngestionService } from './fills/fill-ingestion.service';
import { FillReconcileService } from './fills/fill-reconcile.service';
import { TradingMetricsService } from './metrics/trading-metrics.service';
import { AccountSnapshotService } from './account/account-snapshot.service';
import { RunBalanceSnapshotService } from './account/run-balance-snapshot.service';
import { FundingIngestionService } from './account/funding-ingestion.service';
import { SavingsService } from './savings/savings.service';
import { PnlLedgerService } from './savings/pnl-ledger.service';
import { BotManagerService } from './robot/bot-manager.service';
import type { TickerSource } from './robot/bot-manager.service';
import { pumpTickerWithReconnect } from './robot/ticker-pump';
import { ExchangeAdapterBridge } from './adapters/exchange-adapter.bridge';
import { ExchangeAdapterFactory } from '../exchange/exchange-adapter.factory';
import { CredentialService } from '../credential/credential.service';

@Module({
  imports: [PrismaModule, ExchangeModule, CredentialModule, NotificationModule],
  controllers: [TradingEngineController],
  providers: [
    TradingEngineService,
    TradingEngineGateway,
    SessionService,
    PersistenceService,
    FillIngestionService,
    FillReconcileService,
    TradingMetricsService,
    AccountSnapshotService,
    RunBalanceSnapshotService,
    FundingIngestionService,
    SavingsService,
    PnlLedgerService,
    {
      provide: 'BOT_MANAGER_TICKER_SOURCE',
      useFactory: (factory: ExchangeAdapterFactory, credentials: CredentialService): TickerSource => {
        const logger = new Logger('BotManagerTickerSource');
        return {
          subscribe(robotId, credentialId, symbol, onPrice) {
            let active = true;
            void (async () => {
              const cred = await credentials.findOneWithSecrets(credentialId);
              if (!cred) {
                throw new Error(`Credential ${credentialId} not found for robot ${robotId}`);
              }
              const legacy = factory.createAdapter({
                exchangeId: cred.exchangeId,
                accountId: cred.accountId,
                apiKey: cred.apiKey,
                apiSecret: cred.apiSecret,
                passphrase: cred.passphrase ?? undefined,
              });
              const adapter = new ExchangeAdapterBridge(legacy);
              try {
                // 自愈重连：流干净结束或抛错都重订，否则 WS 一断 latestPrice Map 永久冻结
                // → /robots 列表标记价不再更新（详情页因 runner 自带重连仍实时）。
                await pumpTickerWithReconnect({
                  subscribe: () => adapter.subscribeTicker(symbol),
                  onPrice,
                  isActive: () => active,
                  onError: (err) =>
                    logger.warn(`[${robotId}] ticker stream error (will resubscribe): ${(err as Error).message}`),
                });
              } finally {
                await adapter.disconnect();
              }
            })().catch((err) => {
              // 不静默吞错：凭证缺失/适配器创建失败等"不可重连"的致命错仍要可见。
              logger.error(`[${robotId}] ticker subscription failed: ${(err as Error).message}`);
            });
            return () => { active = false; };
          },
        };
      },
      inject: [ExchangeAdapterFactory, CredentialService],
    },
    BotManagerService,
  ],
  exports: [TradingEngineService, PersistenceService, TradingMetricsService, PnlLedgerService],
})
export class TradingEngineModule {}

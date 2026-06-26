import { Module } from "@nestjs/common";
import { ExchangeModule } from "./modules/exchange/exchange.module";
import { CredentialModule } from "./modules/credential/credential.module";
import { ProfileModule } from "./modules/profile/profile.module";
import { AuthModule } from "./modules/auth/auth.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TradingEngineModule } from "./modules/trading-engine/trading-engine.module";
import { AiModule } from "./modules/ai/ai.module";
import { DiagnosticsService } from "./common/diagnostics.service";

@Module({
  imports: [PrismaModule, ExchangeModule, CredentialModule, ProfileModule, AuthModule, NotificationModule, TradingEngineModule, AiModule],
  controllers: [],
  providers: [DiagnosticsService],
})
export class AppModule {}

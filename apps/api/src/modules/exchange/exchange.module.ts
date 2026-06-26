import { Module } from "@nestjs/common";
import { ExchangeRegistryService } from "./exchange-registry.service";
import { ExchangeAdapterFactory } from "./exchange-adapter.factory";

@Module({
  providers: [ExchangeRegistryService, ExchangeAdapterFactory],
  exports: [ExchangeRegistryService, ExchangeAdapterFactory],
})
export class ExchangeModule {}

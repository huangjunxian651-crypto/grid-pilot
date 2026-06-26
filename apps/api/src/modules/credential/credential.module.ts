import { Module } from "@nestjs/common";
import { CredentialController } from "./credential.controller";
import { CredentialService } from "./credential.service";
import { CredentialCrypto } from "./credential-crypto";

@Module({
  controllers: [CredentialController],
  providers: [
    {
      provide: CredentialCrypto,
      useFactory: () => new CredentialCrypto(process.env.ENCRYPTION_KEY ?? ""),
    },
    CredentialService,
  ],
  exports: [CredentialService],
})
export class CredentialModule {}

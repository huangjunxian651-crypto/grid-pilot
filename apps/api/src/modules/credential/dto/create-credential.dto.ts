import { IsString, IsOptional, IsBoolean, IsIn } from "class-validator";
import { ExchangeId, ExchangeEnvironment } from "@gridpilot/shared-types";

export class CreateCredentialDto {
  @IsString()
  exchangeId: ExchangeId;

  @IsIn(["demo", "live"])
  environment: ExchangeEnvironment;

  @IsString()
  accountId: string;

  @IsString()
  label: string;

  @IsString()
  apiKey: string;

  @IsString()
  apiSecret: string;

  @IsOptional()
  @IsString()
  passphrase?: string;
}

export class UpdateCredentialDto {
  @IsOptional()
  @IsString()
  exchangeId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  passphrase?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

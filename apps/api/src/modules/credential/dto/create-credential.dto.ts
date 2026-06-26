import { IsString, IsOptional, IsBoolean } from "class-validator";
import { ExchangeId } from "@gridpilot/shared-types";

export class CreateCredentialDto {
  @IsString()
  exchangeId: ExchangeId;

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

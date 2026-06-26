import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { CredentialCrypto } from "./credential-crypto";

@Injectable()
export class CredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CredentialCrypto,
  ) {}

  async create(data: Prisma.ExchangeAccountCreateInput) {
    const enc = {
      ...data,
      apiKey: this.crypto.encrypt(data.apiKey as string),
      apiSecret: this.crypto.encrypt(data.apiSecret as string),
      ...(data.passphrase ? { passphrase: this.crypto.encrypt(data.passphrase as string) } : {}),
    };
    return this.prisma.exchangeAccount.create({ data: enc });
  }

  async findAll() {
    return this.prisma.exchangeAccount.findMany({
      select: {
        id: true,
        exchangeId: true,
        accountId: true,
        label: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async findOnePublic(id: string) {
    const credential = await this.prisma.exchangeAccount.findUnique({
      where: { id },
      select: {
        id: true,
        exchangeId: true,
        accountId: true,
        label: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!credential) {
      throw new NotFoundException(`Credential ${id} not found`);
    }
    return credential;
  }

  async findOneMasked(id: string) {
    const credential = await this.prisma.exchangeAccount.findUnique({
      where: { id },
    });
    if (!credential) {
      throw new NotFoundException(`Credential ${id} not found`);
    }
    const plainKey = this.crypto.decrypt(credential.apiKey);
    const plainSecret = this.crypto.decrypt(credential.apiSecret);
    return {
      id: credential.id,
      exchangeId: credential.exchangeId,
      accountId: credential.accountId,
      label: credential.label,
      isActive: credential.isActive,
      createdAt: credential.createdAt,
      apiKeyMasked: CredentialService.mask(plainKey),
      apiSecretMasked: CredentialService.mask(plainSecret),
    };
  }

  async findOneWithSecrets(id: string) {
    const credential = await this.prisma.exchangeAccount.findUnique({
      where: { id },
    });
    if (!credential) {
      throw new NotFoundException(`Credential ${id} not found`);
    }
    return {
      ...credential,
      apiKey: this.crypto.decrypt(credential.apiKey),
      apiSecret: this.crypto.decrypt(credential.apiSecret),
      passphrase: credential.passphrase ? this.crypto.decrypt(credential.passphrase) : credential.passphrase,
    };
  }

  async update(id: string, data: Record<string, any>) {
    await this.findOnePublic(id);
    const enc: Record<string, any> = { ...data };
    if ('apiKey' in data && data.apiKey) {
      enc.apiKey = this.crypto.encrypt(data.apiKey);
    }
    if ('apiSecret' in data && data.apiSecret) {
      enc.apiSecret = this.crypto.encrypt(data.apiSecret);
    }
    if ('passphrase' in data) {
      enc.passphrase = data.passphrase ? this.crypto.encrypt(data.passphrase) : null;
    }
    return this.prisma.exchangeAccount.update({
      where: { id },
      data: enc,
    });
  }

  static mask(value: string): string {
    if (!value) return '';
    if (value.length >= 8) {
      return value.slice(0, 4) + '***' + value.slice(-4);
    }
    const head = value.slice(0, 2);
    const tail = value.length > 2 ? value.slice(-1) : '';
    return head + '***' + tail;
  }

  async remove(id: string) {
    await this.findOnePublic(id);
    try {
      return await this.prisma.exchangeAccount.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ConflictException("Cannot delete credential: it is referenced by existing bot configurations");
      }
      throw err;
    }
  }
}

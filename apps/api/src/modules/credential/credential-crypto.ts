import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const VERSION = 'v1';
const KEY_SALT = 'gridpilot-credential-crypto-v1';

export class CredentialCrypto {
  private readonly key: Buffer;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 16 || encryptionKey.startsWith('your-')) {
      throw new Error('ENCRYPTION_KEY is missing or a placeholder; set a real key');
    }
    this.key = scryptSync(encryptionKey, KEY_SALT, 32);
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(cipherText: string): string {
    if (!this.isEncrypted(cipherText)) {
      throw new Error('decrypt: input is not an encrypted v1 string');
    }
    const [, ivB64, tagB64, dataB64] = cipherText.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  isEncrypted(value: string): boolean {
    return typeof value === 'string' && value.startsWith(`${VERSION}:`);
  }
}

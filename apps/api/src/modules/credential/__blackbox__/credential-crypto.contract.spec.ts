import { describe, it, expect } from 'vitest';
import { CredentialCrypto } from '../credential-crypto';

const crypto = new CredentialCrypto('test-encryption-key-deterministic-1234');

describe('CredentialCrypto (contract)', () => {
  it('round-trips: decrypt(encrypt(x)) === x', () => {
    const plain = 'my-secret-api-key-VQVg1234567890';
    const cipher = crypto.encrypt(plain);
    expect(cipher).not.toBe(plain);
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(crypto.decrypt(cipher)).toBe(plain);
  });

  it('produces different ciphertext each call (random IV) but both decrypt to same plain', () => {
    const plain = 'same-input';
    const c1 = crypto.encrypt(plain);
    const c2 = crypto.encrypt(plain);
    expect(c1).not.toBe(c2);
    expect(crypto.decrypt(c1)).toBe(plain);
    expect(crypto.decrypt(c2)).toBe(plain);
  });

  it('throws on tampered ciphertext (GCM auth tag)', () => {
    const cipher = crypto.encrypt('secret');
    const tampered = cipher.slice(0, -2) + (cipher.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('throws on non-encrypted input (no v1: prefix)', () => {
    expect(() => crypto.decrypt('plaintext-no-prefix')).toThrow();
  });

  it('isEncrypted distinguishes ciphertext from plaintext', () => {
    expect(crypto.isEncrypted(crypto.encrypt('x'))).toBe(true);
    expect(crypto.isEncrypted('raw-plaintext')).toBe(false);
  });

  it('different keys cannot decrypt each other', () => {
    const other = new CredentialCrypto('a-totally-different-key-9876543210');
    const cipher = crypto.encrypt('secret');
    expect(() => other.decrypt(cipher)).toThrow();
  });

  it('rejects placeholder/empty key in constructor', () => {
    expect(() => new CredentialCrypto('')).toThrow();
    expect(() => new CredentialCrypto('your-32-byte-aes-key-here-change-this')).toThrow();
  });
});

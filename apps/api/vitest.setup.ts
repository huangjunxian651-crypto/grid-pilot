// Global test setup.
// Provide a deterministic ENCRYPTION_KEY so modules that construct CredentialCrypto
// (e.g. CredentialModule via TradingEngineModule) can compile in tests without a
// real .env. This is a test-only key, never used against real credentials.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "test-only-encryption-key-do-not-use-in-prod-0000";

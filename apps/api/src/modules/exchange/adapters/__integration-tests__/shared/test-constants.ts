/**
 * Shared test constants for exchange integration tests.
 */

// Test symbol used across all exchanges
export const TEST_SYMBOL = "ETH/USDT";

// Minimum quantity for test orders (safe small amount)
export const MIN_QTY = 0.01;

// Test price reference (will be adjusted per exchange based on market info)
export const TEST_PRICE_BASE = 2400;

// Order client ID prefix for test isolation
export const TEST_CLIENT_ID_PREFIX = `test-${Date.now()}`;

// Default leverage for testing
export const TEST_LEVERAGE = 5;

// Timeout for individual API calls (ms)
export const API_TIMEOUT = 15000;

// Timeout for entire test suite (ms)
export const TEST_TIMEOUT = 120000;

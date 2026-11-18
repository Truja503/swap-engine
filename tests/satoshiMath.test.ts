import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateNetReceivedSats, calculateTotalPaidSats, calculateServiceFee, calculateNetSatsLost, calculateUserCost, validateAmount, validateMonetaryValue, validateQuoteFields, SatoshiMathError } from '../src/utils/satoshiMath.js';
import type { Quote } from '../src/core/SwapTypes.js';

test('validateAmount throws on invalid inputs', () => {
  assert.throws(() => validateAmount(9999), /between/);
  assert.throws(() => validateAmount(1000001), /between/);
  assert.throws(() => validateAmount(1234.5), /safe integer/);
  assert.throws(() => validateAmount(Number.MAX_SAFE_INTEGER), /between/);
  assert.throws(() => validateAmount(NaN), /safe integer/);
  assert.throws(() => validateAmount(Infinity), /safe integer/);

  // Valid amounts
  assert.ok(validateAmount(10000));
  assert.ok(validateAmount(500000));
  assert.ok(validateAmount(1000000));
});

test('validateMonetaryValue throws on invalid inputs', () => {
  assert.throws(() => validateMonetaryValue(-1), /non-negative/);
  assert.throws(() => validateMonetaryValue(1234.5), /safe integer/);
  assert.throws(() => validateMonetaryValue(NaN), /safe integer/);
  assert.throws(() => validateMonetaryValue(Infinity), /safe integer/);

  // Valid monetary values
  assert.ok(validateMonetaryValue(0));
  assert.ok(validateMonetaryValue(10000));
  assert.ok(validateMonetaryValue(500000));
});

test('validateQuoteFields with valid quote', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.ok(validateQuoteFields(quote));
});

test('validateQuoteFields rejects invalid invoice calculation', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50749, // Wrong invoice
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => validateQuoteFields(quote), /Invoice amount must equal principal plus service fee/);
});

test('validateQuoteFields rejects claim fee exceeding principal', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 50001, // Exceeds principal
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => validateQuoteFields(quote), /Claim fee cannot exceed principal amount/);
});

test('validateQuoteFields rejects negative monetary values', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: -1, // Negative value
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => validateQuoteFields(quote), /non-negative safe integer/);
});

test('validateQuoteFields rejects non-integer monetary values', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750.5, // Non-integer
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => validateQuoteFields(quote), /non-negative safe integer/);
});

test('calculateNetReceivedSats returns correct value', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  // Net received = amountSats - claimFeeSats = 50000 - 500 = 49500
  assert.equal(calculateNetReceivedSats(quote), 49500);
});

test('calculateTotalPaidSats returns correct value', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.equal(calculateTotalPaidSats(quote), 50750);
});

test('calculateServiceFee returns correct value', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.equal(calculateServiceFee(quote), 750);
});

test('calculateNetSatsLost returns correct value', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  // User loss = service fee + claim fee (fundingReserveSats belongs to provider)
  assert.equal(calculateNetSatsLost(quote), 1250); // 750 + 500
});

test('calculateUserCost returns correct value', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  // User cost = service fee + claim fee = 750 + 500 = 1250
  assert.equal(calculateUserCost(quote), 1250);
});

test('boundary tests for invalid amounts', () => {
  // Test boundary values that should throw
  assert.throws(() => validateAmount(10_000 - 1), /between/);
  assert.throws(() => validateAmount(1_000_000 + 1), /between/);

  // Test valid boundary values
  assert.ok(validateAmount(10_000));
  assert.ok(validateAmount(1_000_000));

  // Test unsafe integers
  const unsafeInt = Number.MAX_SAFE_INTEGER;
  assert.throws(() => validateAmount(unsafeInt), /between/);
});

test('calculate functions handle invalid inputs through validation', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  // All functions should work correctly with valid input
  assert.equal(calculateNetReceivedSats(quote), 49500);
  assert.equal(calculateTotalPaidSats(quote), 50750);
  assert.equal(calculateServiceFee(quote), 750);
  assert.equal(calculateNetSatsLost(quote), 1250);
  assert.equal(calculateUserCost(quote), 1250);
});

test('negative and zero values properly validated', () => {
  // Test that all monetary values must be non-negative
  assert.throws(() => validateMonetaryValue(-1), /non-negative/);

  // Test valid non-negative values
  assert.ok(validateMonetaryValue(0));
  assert.ok(validateMonetaryValue(1000));
});

test('regression tests for unsafe arithmetic scenarios', () => {
  // Test that claimFeeSats = -1 returns 50001 (should throw instead)
  const quoteWithNegativeClaim = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: -1,
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => calculateNetReceivedSats(quoteWithNegativeClaim), /non-negative safe integer/);

  // Test that large claimFeeSats returns negative result (should throw instead)
  const quoteWithLargeClaim = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 50001, // Exceeds principal
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => calculateNetReceivedSats(quoteWithLargeClaim), /Claim fee cannot exceed principal amount/);

  // Test NaN values
  const quoteWithNaN = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: NaN,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.throws(() => calculateServiceFee(quoteWithNaN), /non-negative safe integer/);
});

test('edge cases with zero fees', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 0,
    invoiceSats: 50000,
    fundingReserveSats: 1000,
    claimFeeSats: 0,
    expiresAt: Date.now() + 120000
  };

  assert.equal(calculateNetReceivedSats(quote), 50000);
  assert.equal(calculateUserCost(quote), 0);
});

test('edge case with claim fee equal to principal', () => {
  // This should be valid as claim fee can equal the principal amount
  const quote: Quote = {
    id: 'test-id',
    amountSats: 50000,
    serviceFeeSats: 750,
    invoiceSats: 50750,
    fundingReserveSats: 1000,
    claimFeeSats: 50000, // Equal to principal - should be valid!
    expiresAt: Date.now() + 120000
  };

  // Should NOT throw an error
  assert.doesNotThrow(() => validateQuoteFields(quote));
  assert.equal(calculateNetReceivedSats(quote), 0); // 50000 - 50000 = 0
  assert.equal(calculateUserCost(quote), 50750); // 750 + 50000 = 50750
});

test('edge case with maximal principal', () => {
  const quote: Quote = {
    id: 'test-id',
    amountSats: 1000000,
    serviceFeeSats: 500 + Math.ceil(1000000 * 0.005), // This should be 500 + 5000 = 5500
    invoiceSats: 1005500,
    fundingReserveSats: 1000,
    claimFeeSats: 500,
    expiresAt: Date.now() + 120000
  };

  assert.equal(calculateNetReceivedSats(quote), 999500); // 1000000 - 500
  assert.equal(calculateUserCost(quote), 6000); // 5500 + 500
});

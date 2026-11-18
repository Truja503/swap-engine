import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSwapState } from '../src/ui/swapStatus.js';

test('describeSwapState returns correct values for all known states', () => {
  // Test all known states
  assert.deepStrictEqual(describeSwapState('CREATED'), { label: 'Swap created', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('QUOTED'), { label: 'Quote generated', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('INVOICE_CREATED'), { label: 'Invoice created', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('INVOICE_ACCEPTED'), { label: 'Invoice accepted', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('LOCKUP_BROADCAST'), { label: 'Lockup broadcast', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('LOCKUP_CONFIRMED'), { label: 'Lockup confirmed', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('CLAIM_DETECTED'), { label: 'Claim detected', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('LIGHTNING_SETTLED'), { label: 'Lightning settled', tone: 'pending', terminal: false });
  assert.deepStrictEqual(describeSwapState('COMPLETED'), { label: 'Swap completed', tone: 'success', terminal: true });
  assert.deepStrictEqual(describeSwapState('EXPIRED'), { label: 'Swap expired', tone: 'error', terminal: true });
  assert.deepStrictEqual(describeSwapState('FAILED'), { label: 'Swap failed', tone: 'error', terminal: true });
  assert.deepStrictEqual(describeSwapState('REFUND_PENDING'), { label: 'Refund pending', tone: 'warning', terminal: false });
  assert.deepStrictEqual(describeSwapState('REFUNDED'), { label: 'Swap refunded', tone: 'warning', terminal: true });
  assert.deepStrictEqual(describeSwapState('MANUAL_REVIEW'), { label: 'Manual review', tone: 'warning', terminal: false });
});

test('describeSwapState handles unknown states correctly', () => {
  assert.deepStrictEqual(describeSwapState('UNKNOWN_STATE'), { label: 'Unknown status', tone: 'neutral', terminal: false });
  assert.deepStrictEqual(describeSwapState(''), { label: 'Unknown status', tone: 'neutral', terminal: false });
  assert.deepStrictEqual(describeSwapState('some_random_state'), { label: 'Unknown status', tone: 'neutral', terminal: false });
});

test('describeSwapState returns fresh objects', () => {
  const result1 = describeSwapState('COMPLETED');
  const result2 = describeSwapState('COMPLETED');

  // Ensure they are different object references
  assert.notStrictEqual(result1, result2);

  // But have same content
  assert.deepStrictEqual(result1, result2);
});

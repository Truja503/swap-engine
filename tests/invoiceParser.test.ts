import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLndInvoice } from '../src/lightning/InvoiceParser.js';
import { HoldInvoiceManager } from '../src/lightning/HoldInvoiceManager.js';

const hash = 'ab'.repeat(32);
const raw = () => ({ state: 'ACCEPTED', r_hash: Buffer.from(hash, 'hex').toString('base64'),
  value: '50750', amt_paid_sat: '0', payment_request: 'lnbcrt-fixture', r_preimage: 'must-be-stripped',
  htlcs: [{ state: 'ACCEPTED', expiry_height: 209, amt_msat: '50750000' }] });
const manager = new HoldInvoiceManager({ lookup: async () => { throw new Error('unused'); },
  settle: async () => { throw new Error('unused'); }, cancel: async () => { throw new Error('unused'); } });

test('actual LND expiry_height is normalized; exact accepted HTLCs support zero paid amount', () => {
  const invoice = parseLndInvoice(raw());
  assert.equal(invoice.htlcs![0]!.expiration_height, 209);
  assert.equal('r_preimage' in invoice, false);
  manager.assertAccepted(invoice, hash, 50750, 159, 50);
  assert.throws(() => manager.assertAccepted(invoice, hash, 50750, 160, 50));
  assert.throws(() => manager.assertSettled(invoice, hash, 50750));
});

test('accepted amounts and wire deadline fields fail closed', () => {
  for (const amt_msat of ['50749999', '50750001', '-1', '050750000']) {
    const value = raw(); value.htlcs[0]!.amt_msat = amt_msat;
    assert.throws(() => manager.assertAccepted(parseLndInvoice(value), hash, 50750, 159, 50));
  }
  const value = raw(); value.amt_paid_sat = '1';
  assert.throws(() => manager.assertAccepted(parseLndInvoice(value), hash, 50750, 159, 50));
  const wrongField = { ...raw(), htlcs: [{ state: 'ACCEPTED', expiration_height: 209, amt_msat: '50750000' }] };
  assert.throws(() => parseLndInvoice(wrongField));
});

test('settled evidence requires exact paid sats, without requiring accepted HTLCs', () => {
  const value = { ...raw(), state: 'SETTLED', amt_paid_sat: '50750',
    htlcs: [{ state: 'SETTLED', expiry_height: 209, amt_msat: '50750000' }] };
  manager.assertSettled(parseLndInvoice(value), hash, 50750);
  value.amt_paid_sat = '0';
  assert.throws(() => manager.assertSettled(parseLndInvoice(value), hash, 50750));
});

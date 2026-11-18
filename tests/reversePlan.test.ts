import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.js';
import { createReverseTestPlan, verifyReverseTestPlan } from '../src/core/ReverseTestPlan.js';

function plan() {
  const f = fixture();
  return createReverseTestPlan({ id: randomUUID(), amountSats: 50000, serviceFeeSats: 750, invoiceSats: 50750,
    claimFeeSats: 500, fundingReserveSats: 1000, expiresAt: Date.now() + 120000 }, 129,
    { paymentHash: f.contract.paymentHash, claimPublicKey: f.contract.claimPublicKey }, f.contract.refundPublicKey,
    { claim: f.destination, refund: f.destination }, { provider: f.contract.claimPublicKey, payer: f.contract.refundPublicKey });
}
test('reverse test plan reconstructs exact contract and stays unapproved without secrets', () => {
  const p = plan(); assert.equal(p.contract.timeoutHeight, 159); assert.match(p.address, /^bcrt1/);
  assert.equal(p.executionApproved, false); assert.equal(p.quote.invoiceSats - (p.quote.amountSats - p.quote.claimFeeSats), 1250);
  assert.doesNotMatch(JSON.stringify(p), /privateKey|preimage|password|macaroon/);
});
test('reverse plan rejects altered amounts, keys, scripts, destination networks and implicit approval', () => {
  const p = plan();
  for (const changed of [{ ...p, network: 'mainnet' }, { ...p, executionApproved: true },
    { ...p, quote: { ...p.quote, invoiceSats: 50749 } }, { ...p, address: p.claimDestination },
    { ...p, contract: { ...p.contract, timeoutHeight: 160 } }, { ...p, providerNode: p.payerNode },
    { ...p, claimDestination: 'bc1-invalid-mainnet' }, { ...p, contract: { ...p.contract, refundPublicKey: p.contract.claimPublicKey } }]) {
    assert.throws(() => verifyReverseTestPlan(changed));
  }
});

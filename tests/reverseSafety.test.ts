import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { createClaim } from '../src/bitcoin/ClaimManager.js';
import { createRefund } from '../src/bitcoin/RefundManager.js';
import { SwapCoordinator } from '../src/core/SwapCoordinator.js';
import { HoldInvoiceManager } from '../src/lightning/HoldInvoiceManager.js';
import { available } from '../src/liquidity/LiquidityManager.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('durable store detaches adapter-owned and returned objects from committed state', async () => {
  const f = await setup(); try {
    const external = { ...f.quote };
    const returned = await f.store.transaction(db => { db.quotes[external.id] = external; return external; });
    external.amountSats = 1; returned.invoiceSats = 2;
    assert.equal(f.store.read().quotes[f.quote.id]!.amountSats, 50000);
    assert.equal(f.store.read().quotes[f.quote.id]!.invoiceSats, 50750);
    const disk = JSON.parse(await readFile(join(f.directory, 'state.json'), 'utf8'));
    assert.deepEqual(f.store.read().quotes[f.quote.id], disk.quotes[f.quote.id]);
  } finally { await f.cleanup(); }
});

test('regtest verification is required immediately before every irreversible port action', async () => {
  const f = await setup(); try {
    let checks = 0;
    f.ports.assertRegtest = async () => { if (++checks === 3) throw new Error('Wrong network'); };
    const c = new SwapCoordinator(f.store, f.ports);
    await c.issueInvoice(f.swap.id);
    await assert.rejects(c.fundAccepted(f.swap.id), /Wrong network/);
    assert.equal(f.calls.funding, 1); assert.equal(f.calls.broadcast, 0);
    assert.equal(f.manager.get(f.swap.id)!.pendingAction, 'BROADCAST_LOCKUP');
    await c.recover();
    await c.fundAccepted(f.swap.id);
    assert.equal(f.calls.funding, 1); assert.equal(f.calls.broadcast, 0);
    assert.equal(f.manager.get(f.swap.id)!.state, 'MANUAL_REVIEW');
  } finally { await f.cleanup(); }
});

test('forged witness from a fake confirmed port never reveals a secret to LND', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    f.ledger.get(f.tx.getId())!.confirmations = 1; await c.confirmLockup(f.swap.id);
    const tx = createClaim(f.spend, f.preimage);
    const sig = Buffer.from(tx.ins[0]!.witness[0]!); sig[10] = sig[10]! ^ 1; tx.ins[0]!.witness[0] = sig;
    f.ledger.set(tx.getId(), { hex: tx.toHex(), confirmations: 1 });
    await assert.rejects(c.observeClaim(f.swap.id, tx.getId()));
    assert.equal(f.calls.settle, 0);
  } finally { await f.cleanup(); }
});

test('claim losing confirmation just before settlement leaves durable uncertainty and never settles', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    f.ledger.get(f.tx.getId())!.confirmations = 1; await c.confirmLockup(f.swap.id);
    const tx = createClaim(f.spend, f.preimage);
    let observations = 0;
    const original = f.ports.confirmed;
    f.ports.confirmed = async id => id === tx.getId() ? { hex: tx.toHex(), confirmations: ++observations === 1 ? 1 : 0 } : original(id);
    await assert.rejects(c.observeClaim(f.swap.id, tx.getId()), /confirmation lost/);
    assert.equal(f.calls.settle, 0);
    assert.equal(f.manager.get(f.swap.id)!.pendingAction, 'SETTLE');
    await c.recover(); assert.equal(f.manager.get(f.swap.id)!.state, 'MANUAL_REVIEW');
  } finally { await f.cleanup(); }
});

test('confirmed signed refund requires observed invoice cancellation and a second chain check', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    f.ledger.get(f.tx.getId())!.confirmations = 1;
    const tx = createRefund({ ...f.spend, privateKey: f.refundKey.privateKey! }, 130);
    f.ledger.set(tx.getId(), { hex: tx.toHex(), confirmations: 0 });
    await assert.rejects(c.observeRefund(f.swap.id, tx.getId()));
    assert.equal(f.manager.get(f.swap.id)!.state, 'LOCKUP_BROADCAST');
    f.ledger.get(tx.getId())!.confirmations = 1;
    const result = await c.observeRefund(f.swap.id, tx.getId());
    assert.equal(result.state, 'REFUNDED'); assert.equal(result.refundTxid, tx.getId());
    assert.equal((await f.ports.invoice(f.contract.paymentHash)).state, 'CANCELED');
    assert.equal(f.calls.settle, 0);
    f.ledger.get(tx.getId())!.confirmations = 0;
    await c.auditEvidence(f.swap.id);
    assert.equal(f.manager.get(f.swap.id)!.state, 'MANUAL_REVIEW');
  } finally { await f.cleanup(); }
});

test('uncertain refund cancellation is journaled and never retried blindly on restart', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    const tx = createRefund({ ...f.spend, privateKey: f.refundKey.privateKey! }, 130);
    f.ledger.set(tx.getId(), { hex: tx.toHex(), confirmations: 1 });
    let canceled = 0;
    f.ports.cancel = async () => { canceled++; throw new Error('Response lost'); };
    await assert.rejects(c.observeRefund(f.swap.id, tx.getId()), /Response lost/);
    assert.equal(f.manager.get(f.swap.id)!.pendingAction, 'CANCEL_INVOICE');
    await new SwapCoordinator(f.store, f.ports).recover();
    await c.observeRefund(f.swap.id, tx.getId());
    assert.equal(canceled, 1); assert.equal(f.manager.get(f.swap.id)!.state, 'MANUAL_REVIEW');
  } finally { await f.cleanup(); }
});

test('completed swap with lost chain evidence returns to manual review and retains reservations', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    f.ledger.get(f.tx.getId())!.confirmations = 1; await c.confirmLockup(f.swap.id);
    const tx = createClaim(f.spend, f.preimage); f.ledger.set(tx.getId(), { hex: tx.toHex(), confirmations: 1 });
    await c.observeClaim(f.swap.id, tx.getId()); await c.complete(f.swap.id);
    assert.equal(f.manager.get(f.swap.id)!.state, 'COMPLETED');
    f.ledger.get(tx.getId())!.confirmations = 0;
    await c.auditEvidence(f.swap.id);
    assert.equal(f.manager.get(f.swap.id)!.state, 'MANUAL_REVIEW');
    const remaining = available(f.store.read(), { onchainSats: 1000000, incomingSats: 1000000 });
    assert.ok(remaining.incomingSats < 1000000);
  } finally { await f.cleanup(); }
});

test('invoice acceptance and settlement reject malformed quantities, NaN deadlines and hash substitution', async () => {
  const f = await setup(); try {
    const m = new HoldInvoiceManager({ lookup: f.ports.invoice, settle: f.ports.settle, cancel: f.ports.cancel });
    const invoice = await f.ports.invoice(f.contract.paymentHash);
    for (const bad of [{ ...invoice, value: '50750.0' }, { ...invoice, amt_paid_sat: '-1' },
      { ...invoice, r_hash: invoice.r_hash + '!' },
      { ...invoice, htlcs: [{ state: 'ACCEPTED', expiration_height: NaN, amt_msat: '50750000' }] },
      { ...invoice, htlcs: [{ state: 'ACCEPTED', expiration_height: 210, amt_msat: '-1' }] }]) {
      assert.throws(() => m.assertAccepted(bad, f.contract.paymentHash, f.quote.invoiceSats, 130, 40));
    }
    const substituted = new HoldInvoiceManager({ lookup: async () => ({ ...invoice, r_hash: Buffer.alloc(32).toString('base64') }), settle: f.ports.settle, cancel: f.ports.cancel });
    await assert.rejects(substituted.settleVerified(f.contract.paymentHash, f.preimage, f.quote.invoiceSats), /hash mismatch/);
    assert.equal(f.calls.settle, 0);
  } finally { await f.cleanup(); }
});

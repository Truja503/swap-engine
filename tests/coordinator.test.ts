import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { SwapCoordinator } from '../src/core/SwapCoordinator.js';
import { createClaim } from '../src/bitcoin/ClaimManager.js';
import { transition } from '../src/core/SwapStateMachine.js';
import { Store } from '../src/persistence/Store.js';
import { HoldInvoiceManager } from '../src/lightning/HoldInvoiceManager.js';

test('50,000 sat OFFLINE contract/coordinator flow; no real nodes', async () => {
  const f = await setup(); try {
    const coordinator = new SwapCoordinator(f.store, f.ports);
    await coordinator.issueInvoice(f.swap.id); await coordinator.fundAccepted(f.swap.id);
    await coordinator.confirmLockup(f.swap.id);
    assert.equal(f.manager.get(f.swap.id)!.state, 'LOCKUP_BROADCAST');
    f.ledger.get(f.tx.getId())!.confirmations = 1;
    await coordinator.confirmLockup(f.swap.id);
    const claim = createClaim(f.spend, f.preimage);
    f.ledger.set(claim.getId(), { hex: claim.toHex(), confirmations: 1 });
    await coordinator.observeClaim(f.swap.id, claim.getId());
    assert.equal(f.manager.get(f.swap.id)!.state, 'LIGHTNING_SETTLED');
    await coordinator.complete(f.swap.id);
    assert.equal(f.manager.get(f.swap.id)!.state, 'COMPLETED');
    assert.equal(f.calls.funding, 1); assert.equal(f.calls.settle, 1);
    await coordinator.observeClaim(f.swap.id, claim.getId()); await coordinator.complete(f.swap.id);
    assert.equal(f.calls.settle, 1);
  } finally { await f.cleanup(); }
});
test('duplicate and concurrent accepted events only fund once', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id);
    await Promise.all([c.fundAccepted(f.swap.id), c.fundAccepted(f.swap.id)]);
    assert.equal(f.calls.funding, 1); assert.equal(f.calls.broadcast, 1);
  } finally { await f.cleanup(); }
});
test('failed/expired Lightning payment cannot trigger funding', async () => {
  const f = await setup(); try {
    const original = f.ports.invoice;
    f.ports.invoice = async h => ({ ...await original(h), state: 'CANCELED' });
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id);
    await assert.rejects(c.fundAccepted(f.swap.id), /not fully accepted/); assert.equal(f.calls.funding, 0);
  } finally { await f.cleanup(); }
});
test('unsafe incoming HTLC deadline cannot trigger funding', async () => {
  const f = await setup(); try {
    const original = f.ports.invoice;
    f.ports.invoice = async h => ({ ...await original(h), htlcs: [{ state: 'ACCEPTED', expiration_height: 169, amt_msat: String(f.quote.invoiceSats * 1000) }] });
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id);
    await assert.rejects(c.fundAccepted(f.swap.id), /Unsafe/); assert.equal(f.calls.funding, 0);
  } finally { await f.cleanup(); }
});
test('failed broadcast leaves durable intent and restart retains funds', async () => {
  const f = await setup(); try {
    f.ports.broadcast = async () => { throw new Error('Connection lost'); };
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id);
    await assert.rejects(c.fundAccepted(f.swap.id));
    assert.equal(f.manager.get(f.swap.id)!.pendingAction, 'BROADCAST_LOCKUP');
    await f.store.close();
    const restored = await Store.open(f.directory);
    try {
      await new SwapCoordinator(restored, f.ports).recover();
      const s = restored.read().swaps[f.swap.id]!;
      assert.equal(s.state, 'MANUAL_REVIEW'); assert.equal(s.lockup!.txid, f.tx.getId());
    } finally { await restored.close(); }
    // Reacquire for shared cleanup.
    f.store = await Store.open(f.directory);
  } finally {
    // cleanup captures original store; close directly for this restart test.
    await f.store.close();
    const { rm } = await import('node:fs/promises'); await rm(f.directory, { recursive: true, force: true });
  }
});
test('claim failures and unconfirmed claims never settle Lightning', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    f.ledger.get(f.tx.getId())!.confirmations = 1; await c.confirmLockup(f.swap.id);
    await c.observeClaim(f.swap.id, '00'.repeat(32)); assert.equal(f.calls.settle, 0);
    await assert.rejects(c.observeClaim(f.swap.id, f.tx.getId())); assert.equal(f.calls.settle, 0);
  } finally { await f.cleanup(); }
});
test('settlement RPC acknowledgement alone does not mean settled', async () => {
  const f = await setup(); try {
    const manager = new HoldInvoiceManager({ lookup: f.ports.invoice, settle: async () => ({}), cancel: f.ports.cancel });
    assert.equal(await manager.settleVerified(f.contract.paymentHash, f.preimage), false);
    await assert.rejects(manager.settleVerified(f.contract.paymentHash, '00'.repeat(32)), /Preimage/);
  } finally { await f.cleanup(); }
});
test('refund becomes pending only after CLTV; funded swap cannot expire', async () => {
  const f = await setup(); try {
    const c = new SwapCoordinator(f.store, f.ports); await c.issueInvoice(f.swap.id); await c.fundAccepted(f.swap.id);
    await assert.rejects(c.markRefundPending(f.swap.id), /not available/);
    await assert.rejects(c.expireUnfunded(f.swap.id), /Cannot expire/);
    f.ports.tip = async () => 130;
    assert.equal((await c.markRefundPending(f.swap.id)).state, 'REFUND_PENDING');
  } finally { await f.cleanup(); }
});
test('illegal and post-terminal transitions are rejected', async () => {
  const f = await setup(); try {
    assert.throws(() => transition(f.swap, 'COMPLETED'), /Illegal/);
    transition(f.swap, 'FAILED'); assert.throws(() => transition(f.swap, 'INVOICE_CREATED'), /Illegal/);
  } finally { await f.cleanup(); }
});

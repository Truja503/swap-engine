import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from 'bitcoinjs-lib';
import { setup } from './helpers.js';
import { SwapCoordinator } from '../src/core/SwapCoordinator.js';
import { runControlledReverse, type ReverseTestControls, type PaymentEvidence } from '../src/core/ReverseTestRunner.js';
import { createClaim } from '../src/bitcoin/ClaimManager.js';

async function runnerFixture() {
  const f = await setup(); await new SwapCoordinator(f.store, f.ports).issueInvoice(f.swap.id);
  const lookup = f.ports.invoice;
  let beforePayment = true;
  f.ports.invoice = async hash => beforePayment ? { ...(await lookup(hash)), state: 'OPEN', amt_paid_sat: '0', htlcs: [] } : lookup(hash);
  let resolve!: (value: PaymentEvidence) => void; const payment = new Promise<PaymentEvidence>(r => { resolve = r; });
  let started = 0; let stopped = 0; let mined = 0; let wrongEvidence = false; let wrongClaim = false;
  const settle = f.ports.settle;
  f.ports.settle = async preimage => {
    await settle(preimage);
    resolve({ hash: wrongEvidence ? '00'.repeat(32) : f.contract.paymentHash, status: 'SUCCEEDED', valueSats: f.quote.invoiceSats, feeSats: 0 });
  };
  const controls: ReverseTestControls = {
    claimDestination: f.destination,
    startPayment: async () => {
      assert.equal(f.store.read().swaps[f.swap.id]!.clientPayment!.status, 'INTENT'); started++;
      beforePayment = false;
      return { result: payment, stopClient: () => { stopped++; } };
    },
    waitAccepted: async () => {},
    mineFor: async txid => { mined++; f.ledger.get(txid)!.confirmations = 1; },
    signClaim: async () => {
      const claim = createClaim({ ...f.spend, feeSats: wrongClaim ? 501 : 500 }, f.preimage);
      return claim;
    },
    broadcastClaim: async raw => {
      const tx = Transaction.fromHex(raw);
      assert.equal(f.store.read().swaps[f.swap.id]!.clientClaimIntent!.txid, tx.getId());
      f.ledger.set(tx.getId(), { hex: raw, confirmations: 0 }); return tx.getId();
    },
    findClaim: async () => f.store.read().swaps[f.swap.id]!.clientClaimIntent!.txid,
  };
  return { f, controls, started: () => started, stopped: () => stopped, mined: () => mined,
    wrongEvidence: () => { wrongEvidence = true; }, wrongClaim: () => { wrongClaim = true; } };
}

test('controlled reverse requires both actual payer completion and confirmed claim before completion', async () => {
  const x = await runnerFixture(); try {
    const result = await runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id);
    assert.equal(result.state, 'COMPLETED'); assert.equal(result.clientPayment!.status, 'SUCCEEDED');
    assert.equal(result.clientPayment!.feeSats, 0); assert.equal(x.started(), 1); assert.equal(x.mined(), 2);
    assert.equal(x.f.calls.settle, 1);
    await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /reconcile/);
    assert.equal(x.started(), 1);
  } finally { await x.f.cleanup(); }
});

test('canceled or substituted invoice is rejected before any payment intent or payer action', async () => {
  for (const change of [{ state: 'CANCELED' as const }, { value: '50751' }, { payment_request: 'another-invoice' }, { amt_paid_sat: '1' }]) {
    const x = await runnerFixture(); try {
      const lookup = x.f.ports.invoice;
      x.f.ports.invoice = async hash => ({ ...await lookup(hash), ...change });
      await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /unpaid open/);
      assert.equal(x.started(), 0);
      assert.equal(x.f.manager.get(x.f.swap.id)!.clientPayment, undefined);
      assert.equal(x.f.calls.funding, 0);
    } finally { await x.f.cleanup(); }
  }
});

test('payer evidence mismatch cannot become completed even after provider settlement', async () => {
  const x = await runnerFixture(); try {
    x.wrongEvidence(); await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /Payer completion/);
    assert.equal(x.f.manager.get(x.f.swap.id)!.state, 'MANUAL_REVIEW'); assert.equal(x.stopped(), 1);
    assert.equal(x.f.manager.get(x.f.swap.id)!.clientPayment!.status, 'UNKNOWN');
  } finally { await x.f.cleanup(); }
});

test('unknown broadcast outcome preserves funding intent and blocks a second payment', async () => {
  const x = await runnerFixture(); try {
    x.f.ports.broadcast = async () => { throw new Error('Broadcast reply lost'); };
    await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /reply lost/);
    assert.equal(x.f.manager.get(x.f.swap.id)!.pendingAction, 'BROADCAST_LOCKUP');
    assert.equal(x.f.manager.get(x.f.swap.id)!.state, 'MANUAL_REVIEW');
    await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /reconcile/);
    assert.equal(x.started(), 1);
  } finally { await x.f.cleanup(); }
});

test('client fee substitution is rejected before claiming or settling', async () => {
  const x = await runnerFixture(); try {
    x.wrongClaim(); await assert.rejects(runControlledReverse(x.f.store, x.f.ports, x.controls, x.f.swap.id), /destination or fee/);
    assert.equal(x.f.calls.settle, 0); assert.equal(x.mined(), 1);
    assert.equal(x.f.manager.get(x.f.swap.id)!.state, 'MANUAL_REVIEW');
  } finally { await x.f.cleanup(); }
});

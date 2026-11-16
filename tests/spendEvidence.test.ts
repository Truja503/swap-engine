import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction, script } from 'bitcoinjs-lib';
import { fixture } from './helpers.js';
import { createClaim } from '../src/bitcoin/ClaimManager.js';
import { createRefund } from '../src/bitcoin/RefundManager.js';
import { verifyHtlcSpend } from '../src/bitcoin/SpendEvidence.js';

test('independent spend verifier validates claim and refund signatures against actual prevout', () => {
  const f = fixture();
  const claim = createClaim(f.spend, f.preimage);
  assert.deepEqual(verifyHtlcSpend(claim.toHex(), claim.getId(), f.tx.toHex(), 0, f.contract), { kind: 'claim', txid: claim.getId(), preimage: f.preimage });
  const refund = createRefund({ ...f.spend, privateKey: f.refundKey.privateKey! }, 130);
  assert.deepEqual(verifyHtlcSpend(refund.toHex(), refund.getId(), f.tx.toHex(), 0, f.contract), { kind: 'refund', txid: refund.getId() });
});

test('valid-looking claim witnesses with forged signatures, secrets, selectors or extra stack items fail', () => {
  const f = fixture(); const original = createClaim(f.spend, f.preimage);
  for (const mutate of [
    (tx: Transaction) => { const sig = Buffer.from(tx.ins[0]!.witness[0]!); sig[10] = sig[10]! ^ 1; tx.ins[0]!.witness[0] = sig; },
    (tx: Transaction) => { tx.ins[0]!.witness[1] = Buffer.alloc(32); },
    (tx: Transaction) => { tx.ins[0]!.witness[2] = Buffer.from([2]); },
    (tx: Transaction) => { tx.ins[0]!.witness.push(Buffer.from([1])); },
    (tx: Transaction) => { tx.ins[0]!.script = Buffer.from([0]); },
    (tx: Transaction) => { tx.outs[0]!.value -= 1n; },
    (tx: Transaction) => { tx.ins[0]!.index = 1; },
    (tx: Transaction) => { tx.addInput(f.tx.getHash(), 0); },
    (tx: Transaction) => { const sig = script.signature.decode(tx.ins[0]!.witness[0]!); tx.ins[0]!.witness[0] = script.signature.encode(sig.signature, Transaction.SIGHASH_NONE); },
  ]) {
    const tx = Transaction.fromHex(original.toHex()); mutate(tx);
    assert.throws(() => verifyHtlcSpend(tx.toHex(), tx.getId(), f.tx.toHex(), 0, f.contract));
  }
  assert.throws(() => verifyHtlcSpend(original.toHex(), '00'.repeat(32), f.tx.toHex(), 0, f.contract));
  const wrongAmount = Transaction.fromHex(f.tx.toHex()); wrongAmount.outs[0]!.value -= 1n;
  assert.throws(() => verifyHtlcSpend(original.toHex(), original.getId(), wrongAmount.toHex(), 0, f.contract));
});

test('refund verifier rejects early, final-sequence, time-based, wrong-script and forged spends', () => {
  const f = fixture(); const original = createRefund({ ...f.spend, privateKey: f.refundKey.privateKey! }, 130);
  for (const mutate of [
    (tx: Transaction) => { tx.locktime = 129; },
    (tx: Transaction) => { tx.locktime = 500_000_000; },
    (tx: Transaction) => { tx.ins[0]!.sequence = 0xffffffff; },
    (tx: Transaction) => { tx.ins[0]!.witness[1] = Buffer.from([1]); },
    (tx: Transaction) => { tx.ins[0]!.witness[2] = Buffer.from([1]); },
    (tx: Transaction) => { tx.outs[0]!.value -= 1n; },
  ]) {
    const tx = Transaction.fromHex(original.toHex()); mutate(tx);
    assert.throws(() => verifyHtlcSpend(tx.toHex(), tx.getId(), f.tx.toHex(), 0, f.contract));
  }
});

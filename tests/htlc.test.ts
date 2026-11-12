import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as btc from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { fixture } from './helpers.js';
import { buildHtlc, verifyHtlc } from '../src/bitcoin/HtlcBuilder.js';
import { createClaim, extractClaimPreimage } from '../src/bitcoin/ClaimManager.js';
import { createRefund } from '../src/bitcoin/RefundManager.js';

test('deterministic P2WSH and independent contract verification', () => {
  const f = fixture(); assert.match(f.htlc.address, /^bcrt1/);
  assert(verifyHtlc(f.contract, f.htlc.address, f.htlc.witnessScript.toString('hex')));
  assert(!verifyHtlc({ ...f.contract, timeoutHeight: 131 }, f.htlc.address, f.htlc.witnessScript.toString('hex')));
});
test('claim signs actual prevout value and commits to the destination', () => {
  const f = fixture(); const tx = createClaim(f.spend, f.preimage);
  const witness = tx.ins[0]!.witness;
  const signature = btc.script.signature.decode(witness[0]!);
  assert(ecc.verify(tx.hashForWitnessV0(0, f.htlc.witnessScript, 50_000n, signature.hashType), f.claimKey.publicKey, signature.signature));
  assert.equal(tx.outs[0]!.value, 49_500n);
  assert.equal(extractClaimPreimage(tx.toHex(), f.tx.getId(), 0, f.contract), f.preimage);
  assert.equal(extractClaimPreimage(tx.toHex(), '00'.repeat(32), 0, f.contract), undefined);
});
test('incorrect preimage, wrong key and wrong funding script are rejected', () => {
  const f = fixture(); assert.throws(() => createClaim(f.spend, '00'.repeat(32)), /Preimage/);
  assert.throws(() => createClaim({ ...f.spend, privateKey: f.refundKey.privateKey! }, f.preimage), /signing key/);
  assert.throws(() => createClaim({ ...f.spend, contract: { ...f.contract, timeoutHeight: 131 } }, f.preimage), /script mismatch/);
});
test('refund requires height and provider key, sets CLTV and nonfinal sequence', () => {
  const f = fixture(); const input = { ...f.spend, privateKey: f.refundKey.privateKey! };
  assert.throws(() => createRefund(input, 129), /timelock/);
  const tx = createRefund(input, 130);
  assert.equal(tx.locktime, 130); assert.equal(tx.ins[0]!.sequence, 0xfffffffe);
  const signature = btc.script.signature.decode(tx.ins[0]!.witness[0]!);
  assert(ecc.verify(tx.hashForWitnessV0(0, f.htlc.witnessScript, 50_000n, signature.hashType), f.refundKey.publicKey, signature.signature));
  assert.equal(extractClaimPreimage(tx.toHex(), f.tx.getId(), 0, f.contract), undefined);
});
test('invalid keys, hashes and timestamp timelocks fail', () => {
  const { contract } = fixture();
  for (const patch of [{ paymentHash: 'xx'.repeat(32) }, { claimPublicKey: '02' + '00'.repeat(32) }, { timeoutHeight: 500_000_000 }, { timeoutHeight: -1 }, { refundPublicKey: contract.claimPublicKey }]) assert.throws(() => buildHtlc({ ...contract, ...patch }));
});
test('negative, fractional and excessive claim fees fail', () => {
  const f = fixture(); for (const feeSats of [-1, 0, 0.5, 49_500, 50_000]) assert.throws(() => createClaim({ ...f.spend, feeSats }, f.preimage));
});
test('wrong vout and non-regtest destination fail', () => {
  const f = fixture(); assert.throws(() => createClaim({ ...f.spend, vout: 1 }, f.preimage));
  const destination = btc.payments.p2wpkh({ pubkey: f.claimKey.publicKey, network: btc.networks.bitcoin }).address!;
  assert.throws(() => createClaim({ ...f.spend, destination }, f.preimage));
});

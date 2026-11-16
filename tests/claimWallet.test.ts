import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from 'bitcoinjs-lib';
import { ClaimWallet } from '../src/client/ClaimWallet.js';
import { fixture } from './helpers.js';
import { buildHtlc } from '../src/bitcoin/HtlcBuilder.js';
import { verifyHtlcSpend } from '../src/bitcoin/SpendEvidence.js';

test('client generates isolated hash/key identities; JSON and enumeration expose no private fields', () => {
  const a = ClaimWallet.generate(); const b = ClaimWallet.generate();
  try {
    assert.notEqual(a.paymentHash, b.paymentHash); assert.notEqual(a.claimPublicKey, b.claimPublicKey);
    assert.deepEqual(Object.keys(a).sort(), ['claimPublicKey', 'paymentHash']);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), { claimPublicKey: a.claimPublicKey, paymentHash: a.paymentHash });
  } finally { a.destroy(); b.destroy(); }
});

test('client signs an offline claim for its own contract and refuses substituted identities or destroyed custody', () => {
  const f = fixture(); const client = ClaimWallet.generate();
  const contract = { ...f.contract, ...client.toJSON() };
  const funding = Transaction.fromHex(f.tx.toHex()); funding.outs[0]!.script = buildHtlc(contract).output;
  const input = { contract, lockupTxHex: funding.toHex(), vout: 0, destination: f.destination, feeSats: 500 };
  try {
    const claim = client.signClaim(input);
    assert.equal(verifyHtlcSpend(claim.toHex(), claim.getId(), funding.toHex(), 0, contract).kind, 'claim');
    assert.throws(() => client.signClaim({ ...input, contract: f.contract }), /identity/);
    client.destroy();
    assert.throws(() => client.signClaim(input), /destroyed/);
  } finally { client.destroy(); }
});

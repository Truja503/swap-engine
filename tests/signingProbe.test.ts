import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Psbt, Transaction, address, networks } from 'bitcoinjs-lib';
import { fixture } from './helpers.js';
import { runSigningProbe, verifySigningProbe, type SigningPlan } from '../src/bitcoin/SigningProbe.js';

function signingFixture() {
  const f = fixture(); const script = address.toOutputScript(f.destination, networks.regtest);
  const funding = Transaction.fromHex(f.tx.toHex()); funding.outs[0]!.value = 60000n; funding.outs[0]!.script = script;
  const plan: SigningPlan = { network: 'regtest', wallet: 'lqwd-lab', txid: funding.getId(), vout: 0,
    destination: f.destination, amountSats: 50000, maxFeeSats: 1000, broadcast: false };
  const tx = new Transaction(); tx.addInput(funding.getHash(), 0); tx.addOutput(script, 50000n); tx.addOutput(script, 9000n);
  const psbt = new Psbt({ network: networks.regtest }).addInput({ hash: funding.getId(), index: 0, witnessUtxo: { script, value: 60000n } })
    .addOutput({ script, value: 50000n }).addOutput({ script, value: 9000n });
  const calls: string[] = [];
  let foreign = false; let approved = true; let owned = true;
  const blockHash = 'ab'.repeat(32); const tipHash = 'cd'.repeat(32);
  const rpc = { async call<T>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
    calls.push(method);
    if (method === 'getblockchaininfo') return { chain: foreign ? 'main' : 'regtest', blocks: 129, bestblockhash: tipHash, initialblockdownload: false } as T;
    if (method === 'getaddressinfo') { assert.equal(wallet, true); return { ismine: owned } as T; }
    if (method === 'getrawtransaction') return { txid: funding.getId(), hex: funding.toHex(), blockhash: blockHash, in_active_chain: true, confirmations: 30 } as T;
    if (method === 'getblockheader') return { hash: blockHash, height: 100, confirmations: 30 } as T;
    if (method === 'getblockhash') return blockHash as T;
    if (method === 'gettxout') return { scriptPubKey: { hex: Buffer.from(script).toString('hex') } } as T;
    if (method === 'listlockunspent' || method === 'getrawmempool') return [] as T;
    if (method === 'walletcreatefundedpsbt') {
      assert.equal(wallet, true);
      assert.deepEqual(params[0], [{ txid: funding.getId(), vout: 0 }]);
      assert.deepEqual(params[3], { add_inputs: false, lockUnspents: false, changeAddress: f.destination, fee_rate: 2, replaceable: false });
      assert.deepEqual(params.slice(4), [true, 2, 0]);
      return { psbt: psbt.toBase64() } as T;
    }
    if (method === 'walletprocesspsbt') return { psbt: psbt.toBase64() } as T;
    if (method === 'finalizepsbt') return { complete: true, hex: tx.toHex() } as T;
    // Deliberately mocked consensus; live Core is required to establish actual acceptance.
    if (method === 'testmempoolaccept') return [{ txid: tx.getId(), allowed: approved }] as T;
    throw new Error(`Unexpected test RPC ${method}`);
  } };
  return { f, funding, tx, psbt, plan, rpc, calls, setForeign: () => { foreign = true; }, rejectConsensus: () => { approved = false; }, setUnowned: () => { owned = false; } };
}

test('signing probe permits only the exact owned self-spend, amount and fee budget', () => {
  const f = signingFixture();
  assert.equal(verifySigningProbe(f.tx.toHex(), f.funding.toHex(), f.plan).feeSats, 1000);
  for (const mutate of [
    (tx: Transaction) => { tx.outs[0]!.value = 49000n; },
    (tx: Transaction) => { tx.outs[1]!.value = 8999n; },
    (tx: Transaction) => { tx.outs[1]!.script = Buffer.from([0x51]); },
    (tx: Transaction) => { tx.addInput(f.funding.getHash(), 1); },
    (tx: Transaction) => { tx.ins[0]!.index = 1; },
  ]) {
    const tx = Transaction.fromHex(f.tx.toHex()); mutate(tx);
    assert.throws(() => verifySigningProbe(tx.toHex(), f.funding.toHex(), f.plan));
  }
});

test('signing-only RPC sequence explicitly avoids new inputs, locks and broadcasts', async () => {
  const f = signingFixture(); const result = await runSigningProbe(f.rpc, f.plan);
  assert.equal(result.broadcast, false); assert.equal(result.consensusAccepted, true);
  assert.equal(f.calls.filter(method => method === 'walletprocesspsbt').length, 1);
  assert.equal(f.calls.filter(method => method === 'walletcreatefundedpsbt').length, 1);
  assert.ok(!f.calls.includes('sendrawtransaction') && !f.calls.includes('generatetoaddress'));
});

test('signing probe rejects a malicious unsigned PSBT before asking the wallet to sign', async () => {
  const f = signingFixture(); f.psbt.addOutput({ script: Buffer.from([0x51]), value: 1n });
  await assert.rejects(runSigningProbe(f.rpc, f.plan));
  assert.ok(!f.calls.includes('walletprocesspsbt'));
});

test('wrong network and unowned destination fail before any signing operation', async () => {
  for (const fault of ['network', 'ownership']) {
    const f = signingFixture(); if (fault === 'network') f.setForeign(); else f.setUnowned();
    await assert.rejects(runSigningProbe(f.rpc, f.plan));
    assert.ok(!f.calls.includes('walletcreatefundedpsbt') && !f.calls.includes('walletprocesspsbt'));
  }
});

test('RPC success without Core testmempoolaccept allowed=true is not signing consensus evidence', async () => {
  const f = signingFixture(); f.rejectConsensus();
  await assert.rejects(runSigningProbe(f.rpc, f.plan));
  assert.ok(!f.calls.includes('sendrawtransaction'));
});

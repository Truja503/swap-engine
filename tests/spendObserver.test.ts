import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transaction } from 'bitcoinjs-lib';
import { Store } from '../src/persistence/Store.js';
import { BitcoinSpendObserver } from '../src/bitcoin/BitcoinSpendObserver.js';
import { createClaim } from '../src/bitcoin/ClaimManager.js';
import { fixture } from './helpers.js';

async function context(t: TestContext, includeSpend = true) {
  const f = fixture(); const claim = createClaim(f.spend, f.preimage);
  await mkdir('data/tests', { recursive: true });
  const directory = await mkdtemp(join(process.cwd(), 'data/tests/observer-'));
  const holder = { store: await Store.open(directory) };
  t.after(async () => { await holder.store.close(); await rm(directory, { recursive: true, force: true }); });
  let epoch = 0; let present = includeSpend;
  const hashAt = (h: number) => (h + (epoch && h >= 101 ? 1000 : 0)).toString(16).padStart(64, '0');
  const calls: string[] = [];
  let hook: ((method: string, params: unknown[]) => void) | undefined;
  const transactions = (h: number) => h === 100 ? [f.tx] : h === 101 && present ? [claim] : [];
  const rpc = { async call<T>(method: string, params: unknown[] = []): Promise<T> {
    calls.push(method); hook?.(method, params);
    if (method === 'getblockchaininfo') return { chain: 'regtest', blocks: 102, bestblockhash: hashAt(102) } as T;
    if (method === 'getblockhash') return hashAt(params[0] as number) as T;
    const h = [100, 101, 102].find(h => hashAt(h) === (method === 'getrawtransaction' ? params[2] : params[0]));
    assert.notEqual(h, undefined, 'Unknown fixture block');
    if (method === 'getblock') return { hash: hashAt(h!), height: h, previousblockhash: hashAt(h! - 1), confirmations: 103 - h!,
      tx: transactions(h!).map(tx => ({ txid: tx.getId(), vin: tx.ins.map(input => ({ txid: Buffer.from(input.hash).reverse().toString('hex'), vout: input.index })) })) } as T;
    if (method === 'getblockheader') return { hash: hashAt(h!), height: h, confirmations: 103 - h! } as T;
    if (method === 'getrawtransaction') {
      const tx = transactions(h!).find(tx => tx.getId() === params[0]);
      assert.ok(tx, 'Unknown fixture transaction');
      return { txid: tx.getId(), hex: tx.toHex(), blockhash: hashAt(h!), confirmations: 103 - h!, in_active_chain: true } as T;
    }
    throw new Error(`Unexpected fixture RPC ${method}`);
  } };
  return { f, claim, holder, directory, rpc, calls, hashAt, observer: () => new BitcoinSpendObserver(rpc, holder.store),
    reorg: () => { epoch++; present = false; }, setHook: (fn: typeof hook) => { hook = fn; } };
}

test('observer finds the exact confirmed spender and persists only public cursor metadata', async t => {
  const f = await context(t);
  const result = await f.observer().scan(f.f.tx.getId(), 0, 100);
  assert.equal(result.status, 'spent');
  if (result.status !== 'spent') return;
  assert.equal(result.spend.txid, f.claim.getId()); assert.equal(result.spend.confirmations, 2);
  assert.equal(Transaction.fromHex(result.spend.hex).getId(), f.claim.getId());
  const disk = await readFile(join(f.directory, 'state.json'), 'utf8');
  assert.doesNotMatch(disk, new RegExp(f.f.preimage));
  assert.ok(disk.includes(f.claim.getId()));
  result.cursor.height = 0;
  assert.equal(f.holder.store.read().chainObservations![`${f.f.tx.getId()}:0`]!.height, 101);
});

test('bounded scan resumes from a durable checkpoint after an actual store reopen', async t => {
  const f = await context(t);
  assert.equal((await f.observer().scan(f.f.tx.getId(), 0, 100, 1)).status, 'scanning');
  await f.holder.store.close(); f.holder.store = await Store.open(f.directory);
  const result = await f.observer().scan(f.f.tx.getId(), 0, 100, 1);
  assert.equal(result.status, 'spent');
  assert.equal(result.cursor.height, 101);
});

test('same-height reorg invalidates a persisted spend and rescans the original window', async t => {
  const f = await context(t); const observer = f.observer();
  assert.equal((await observer.scan(f.f.tx.getId(), 0, 100)).status, 'spent');
  f.reorg();
  const result = await observer.scan(f.f.tx.getId(), 0, 100);
  assert.equal(result.status, 'not_found'); assert.equal(result.cursor.height, 102);
  assert.equal(result.cursor.spend, undefined);
  assert.equal(f.holder.store.read().chainObservations![`${f.f.tx.getId()}:0`]!.spend, undefined);
});

test('observer does not confuse another output spend with the watched outpoint', async t => {
  const f = await context(t);
  assert.equal((await f.observer().scan(f.f.tx.getId(), 1, 100)).status, 'not_found');
});

test('RPC interruption and a changing tip never advance durable checkpoints', async t => {
  const f = await context(t, false); const observer = f.observer();
  await observer.scan(f.f.tx.getId(), 0, 100, 1);
  const before = f.holder.store.read().chainObservations;
  f.setHook((method) => { if (method === 'getblock') throw new Error('Connection lost'); });
  await assert.rejects(observer.scan(f.f.tx.getId(), 0, 100), /Connection lost/);
  assert.deepEqual(f.holder.store.read().chainObservations, before);
  let changed = false;
  f.setHook((method, params) => { if (!changed && method === 'getblock' && params[0] === f.hashAt(102)) { changed = true; f.reorg(); } });
  await assert.rejects(observer.scan(f.f.tx.getId(), 0, 100));
  assert.deepEqual(f.holder.store.read().chainObservations, before);
});

test('persisted spend is freshly verified; RPC success from a previous scan is never cached', async t => {
  const f = await context(t); const observer = f.observer();
  await observer.scan(f.f.tx.getId(), 0, 100);
  f.setHook(method => { if (method === 'getrawtransaction') throw new Error('Evidence unavailable'); });
  await assert.rejects(observer.scan(f.f.tx.getId(), 0, 100), /Evidence unavailable/);
});

test('observer rejects foreign networks and invalid scan bounds without writing state', async t => {
  const f = await context(t);
  const foreign = { async call<T>(): Promise<T> { return { chain: 'main', blocks: 102, bestblockhash: f.hashAt(102) } as T; } };
  await assert.rejects(new BitcoinSpendObserver(foreign, f.holder.store).scan(f.f.tx.getId(), 0, 100));
  const observer = f.observer();
  for (const [vout, from, budget] of [[-1, 100, 1], [0, -1, 1], [0, 100, 0], [0, 100, 1001], [0, 103, 1]]) {
    await assert.rejects(observer.scan(f.f.tx.getId(), vout!, from!, budget!));
  }
  assert.equal(f.holder.store.read().chainObservations, undefined);
});

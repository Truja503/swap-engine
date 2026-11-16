import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { config } from '../src/config.js';
import { ReadOnlyBitcoinClient } from '../src/diagnostics/ReadOnlyClients.js';
import { BitcoinSpendObserver } from '../src/bitcoin/BitcoinSpendObserver.js';
import { Store } from '../src/persistence/Store.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const height = z.number().int().nonnegative().max(499_999_999);
const c = config();
const rpc = new ReadOnlyBitcoinClient(c.bitcoinUrl, c.cookie, c.wallet);
try {
  const tip = z.object({ chain: z.literal('regtest'), blocks: height, bestblockhash: hash, initialblockdownload: z.boolean() })
    .parse(await rpc.call('getblockchaininfo'));
  const block = z.object({ tx: z.array(hash).nonempty() }).parse(await rpc.call('getblock', [tip.bestblockhash, 1]));
  const txid = block.tx[0]!;
  const confirmed = await rpc.confirmed(txid);
  console.log(JSON.stringify({ check: 'confirmed_existing_transaction', status: 'passed', height: tip.blocks,
    tip: tip.bestblockhash, initialBlockDownload: tip.initialblockdownload, txid, confirmations: confirmed.confirmations }));
  try {
    await rpc.confirmed('00'.repeat(32));
    throw new Error('Unknown transaction unexpectedly confirmed');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Bitcoin RPC getrawtransaction error -5') throw error;
    console.log(JSON.stringify({ check: 'unknown_transaction', status: 'rejected', rpcCode: -5 }));
  }
  const pool = z.array(hash).parse(await rpc.call('getrawmempool'));
  if (pool[0]) {
    try {
      await rpc.confirmed(pool[0]);
      throw new Error('Mempool transaction became confirmed; rerun with a fresh sample');
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      console.log(JSON.stringify({ check: 'existing_unconfirmed_transaction', status: 'rejected', txid: pool[0] }));
    }
  } else console.log(JSON.stringify({ check: 'existing_unconfirmed_transaction', status: 'not_available', reason: 'empty_mempool' }));

  if (process.argv.includes('--find-spend')) {
    let found = false;
    // Inspect only existing history. Never generate a transaction to manufacture test evidence.
    for (let h = tip.blocks; h >= Math.max(1, tip.blocks - 127) && !found; h--) {
      const blockHash = hash.parse(await rpc.call('getblockhash', [h]));
      const raw = z.object({ tx: z.array(z.object({ txid: hash, vin: z.array(z.object({ txid: hash.optional(), vout: z.number().int().nonnegative().optional() })) })) })
        .parse(await rpc.call('getblock', [blockHash, 2]));
      const candidate = raw.tx.find(tx => tx.vin.some(input => input.txid !== undefined));
      const input = candidate?.vin.find(input => input.txid !== undefined);
      if (!candidate || !input || input.vout === undefined) continue;
      const funding = z.object({ blockhash: hash }).parse(await rpc.call('getrawtransaction', [input.txid, true]));
      const header = z.object({ height }).parse(await rpc.call('getblockheader', [funding.blockhash, true]));
      await mkdir(c.directory, { recursive: true, mode: 0o700 });
      const store = await Store.open(join(c.directory, 'read-only-verification'));
      try {
        const observed = await new BitcoinSpendObserver(rpc, store).scan(input.txid!, input.vout, header.height, 1000);
        if (observed.status !== 'spent' || observed.spend.txid !== candidate.txid) throw new Error('Existing spend observation mismatch');
        console.log(JSON.stringify({ check: 'existing_exact_outpoint_spend', status: 'passed',
          fundingTxid: input.txid, vout: input.vout, spendTxid: observed.spend.txid, blockHash: observed.spend.blockHash,
          confirmations: observed.spend.confirmations }));
        found = true;
      } finally { await store.close(); }
    }
    if (!found) console.log(JSON.stringify({ check: 'existing_exact_outpoint_spend', status: 'not_available', reason: 'no_spend_in_search_window' }));
  }
} catch (error) {
  console.log(JSON.stringify({ check: 'read_only_verification', status: 'failed', errorType: error instanceof Error ? error.name : 'Unknown' }));
  process.exitCode = 1;
}

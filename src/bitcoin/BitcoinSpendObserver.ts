import { Transaction } from 'bitcoinjs-lib';
import { z } from 'zod';
import { BitcoinConfirmationLookup, type ConfirmationRpc } from './BitcoinConfirmationLookup.js';
import type { Store } from '../persistence/Store.js';
import type { ChainObservation } from '../core/SwapTypes.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const height = z.number().int().min(0).max(499_999_999);
const snapshot = z.object({ chain: z.literal('regtest'), blocks: height, bestblockhash: hash });
const checkpoint = z.object({ fromHeight: height, height, blockHash: hash,
  spend: z.object({ txid: hash, blockHash: hash, height }).optional() });
const blockSchema = z.object({ hash, height, previousblockhash: hash.optional(),
  confirmations: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  tx: z.array(z.object({ txid: hash, vin: z.array(z.union([
    z.object({ txid: hash, vout: z.number().int().nonnegative().max(0xffffffff) }),
    z.object({ coinbase: z.string() }),
  ])) })) });
export type ObservedSpend = { txid: string; blockHash: string; height: number; hex: string; confirmations: number };
export type ScanResult = { status: 'spent'; spend: ObservedSpend; cursor: ChainObservation }
  | { status: 'scanning' | 'not_found'; cursor: ChainObservation };

/** Bounded, read-only block observer. Caller must start at the verified funding height. */
export class BitcoinSpendObserver {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly rpc: ConfirmationRpc, private readonly store: Store) {}

  scan(txid: string, vout: number, fromHeight: number, maxBlocks = 100): Promise<ScanResult> {
    const action = this.queue.then(() => this.scanExclusive(txid, vout, fromHeight, maxBlocks));
    this.queue = action.catch(() => {});
    return action;
  }

  private async scanExclusive(txid: string, vout: number, fromHeight: number, maxBlocks: number): Promise<ScanResult> {
    hash.parse(txid); height.parse(fromHeight);
    if (!Number.isSafeInteger(vout) || vout < 0 || vout > 0xffffffff || !Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 1000) throw new Error('Invalid observer bounds');
    const before = snapshot.parse(await this.rpc.call('getblockchaininfo'));
    if (fromHeight > before.blocks) throw new Error('Funding height is not available');
    const key = `${txid}:${vout}`;
    const stored = this.store.read().chainObservations?.[key];
    let cursor = stored ? checkpoint.parse(stored) : undefined;
    if (cursor && (cursor.fromHeight !== fromHeight || cursor.height < fromHeight ||
      (cursor.spend && (cursor.spend.height !== cursor.height || cursor.spend.blockHash !== cursor.blockHash)))) throw new Error('Observer checkpoint mismatch');
    // Never trust persisted confirmation after restart. Revalidate the checkpoint anchor.
    if (cursor && (cursor.height > before.blocks || await this.rpc.call('getblockhash', [cursor.height]) !== cursor.blockHash)) cursor = undefined;
    const verifySpend = async (found: NonNullable<ChainObservation['spend']>): Promise<ObservedSpend> => {
      const evidence = await new BitcoinConfirmationLookup(this.rpc).confirmed(found.txid, found.blockHash);
      const tx = Transaction.fromHex(evidence.hex);
      if (tx.ins.filter(input => Buffer.from(input.hash).reverse().toString('hex') === txid && input.index === vout).length !== 1) throw new Error('Candidate does not spend exact outpoint');
      return { ...found, ...evidence };
    };
    const stable = async () => {
      const after = snapshot.parse(await this.rpc.call('getblockchaininfo'));
      if (after.bestblockhash !== before.bestblockhash || after.blocks !== before.blocks) throw new Error('Chain changed during spend scan');
    };
    if (cursor?.spend) {
      const spend = await verifySpend(cursor.spend);
      await stable();
      return { status: 'spent', spend, cursor };
    }
    let previous = cursor?.blockHash;
    const start = cursor ? cursor.height + 1 : fromHeight;
    if (previous === undefined && start > 0) previous = hash.parse(await this.rpc.call('getblockhash', [start - 1]));
    const end = Math.min(before.blocks, start + maxBlocks - 1);
    let spend: ObservedSpend | undefined;
    for (let h = start; h <= end; h++) {
      const blockHash = hash.parse(await this.rpc.call('getblockhash', [h]));
      const block = blockSchema.parse(await this.rpc.call('getblock', [blockHash, 2]));
      if (block.hash !== blockHash || block.height !== h || (h > 0 && block.previousblockhash !== previous) || block.confirmations !== before.blocks - h + 1) throw new Error('Block evidence mismatch');
      cursor = { fromHeight, height: h, blockHash };
      previous = blockHash;
      const candidates = block.tx.filter(tx => tx.vin.some(input => 'txid' in input && input.txid === txid && input.vout === vout));
      if (candidates.length > 1) throw new Error('Conflicting block spends');
      if (candidates[0]) {
        cursor.spend = { txid: candidates[0].txid, blockHash, height: h };
        spend = await verifySpend(cursor.spend);
        break;
      }
    }
    if (!cursor) throw new Error('No observer checkpoint');
    await stable();
    // Do not advance durable state on RPC failure, malformed evidence, or a changed tip.
    const saved = cursor;
    await this.store.transaction(db => {
      if (JSON.stringify(db.chainObservations?.[key]) !== JSON.stringify(stored)) throw new Error('Observer checkpoint changed during scan');
      (db.chainObservations ??= {})[key] = saved;
    });
    return spend ? { status: 'spent', spend, cursor } : { status: cursor.height === before.blocks ? 'not_found' : 'scanning', cursor };
  }
}

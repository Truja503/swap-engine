import { Transaction } from 'bitcoinjs-lib';
import { z } from 'zod';
import type { SwapPorts } from '../core/SwapCoordinator.js';

/** Narrow transport boundary; BitcoinRpcClient supplies authenticated local RPC. */
export interface ConfirmationRpc {
  call<T>(method: string, params?: unknown[]): Promise<T>;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const height = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const confirmations = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const chain = z.object({ chain: z.literal('regtest'), blocks: height, bestblockhash: hash });
const transaction = z.object({
  txid: hash, hex: z.string().regex(/^(?:[a-f0-9]{2})+$/),
  blockhash: hash, confirmations,
});

/** Read-only evidence at lookup time, not a durable guarantee against future reorgs. */
export class BitcoinConfirmationLookup implements Pick<SwapPorts, 'confirmed'> {
  constructor(private readonly rpc: ConfirmationRpc) {}

  async confirmed(txid: string, knownBlockHash?: string): Promise<{ hex: string; confirmations: number }> {
    hash.parse(txid);
    if (knownBlockHash !== undefined) hash.parse(knownBlockHash);
    const before = chain.parse(await this.rpc.call('getblockchaininfo'));
    // Without a hint Core needs available txindex history. Never scan wallets or change indexes.
    let blockHash = knownBlockHash;
    if (blockHash === undefined) {
      const discovered = transaction.parse(await this.rpc.call('getrawtransaction', [txid, true]));
      this.verifyIdentity(discovered, txid);
      blockHash = discovered.blockhash;
    }
    const evidence = transaction.extend({ in_active_chain: z.literal(true) })
      .parse(await this.rpc.call('getrawtransaction', [txid, true, blockHash]));
    this.verifyIdentity(evidence, txid);
    if (evidence.blockhash !== blockHash) throw new Error('Transaction block mismatch');
    const header = z.object({ hash, height, confirmations })
      .parse(await this.rpc.call('getblockheader', [blockHash, true]));
    if (header.hash !== blockHash || header.confirmations !== evidence.confirmations
      || header.height > before.blocks || before.blocks - header.height + 1 !== evidence.confirmations) {
      throw new Error('Inconsistent confirmation evidence');
    }
    if (hash.parse(await this.rpc.call('getblockhash', [header.height])) !== blockHash) {
      throw new Error('Block is no longer in active chain');
    }
    const after = chain.parse(await this.rpc.call('getblockchaininfo'));
    if (before.bestblockhash !== after.bestblockhash || before.blocks !== after.blocks) {
      throw new Error('Chain changed during confirmation lookup; retry with fresh evidence');
    }
    return { hex: evidence.hex, confirmations: evidence.confirmations };
  }

  private verifyIdentity(tx: { txid: string; hex: string }, requested: string) {
    if (tx.txid !== requested || Transaction.fromHex(tx.hex).getId() !== requested) {
      throw new Error('Transaction ID mismatch');
    }
  }
}

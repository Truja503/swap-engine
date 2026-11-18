import { BitcoinRpcClient } from '../bitcoin/BitcoinRpcClient.js';
import { LndClient } from '../lightning/LndClient.js';

const bitcoinReads = new Set(['getblockchaininfo', 'getbalances', 'listunspent']);
const lndReads = new Set(['/v1/getinfo', '/v1/channels', '/v1/balance/blockchain']);

/** Runtime policy is unconditional, including when nodes later report synced. */
export class ReadOnlyBitcoinClient extends BitcoinRpcClient {
  override call<T>(method: string, params: unknown[] = [], wallet = false): Promise<T> {
    if (!bitcoinReads.has(method)) return Promise.reject(new Error('READ_ONLY_MODE: Bitcoin operation disabled'));
    return super.call<T>(method, params, wallet);
  }
}

export class ReadOnlyLndClient extends LndClient {
  override call<T>(path: string, body?: unknown): Promise<T> {
    if (body !== undefined || !lndReads.has(path)) return Promise.reject(new Error('READ_ONLY_MODE: Lightning operation disabled'));
    return super.call<T>(path);
  }
}

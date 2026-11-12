import { hex32, sha256 } from '../bitcoin/HtlcBuilder.js';
import type { Invoice, LndClient } from './LndClient.js';

export class HoldInvoiceManager {
  constructor(private lnd: Pick<LndClient, 'lookup' | 'settle' | 'cancel'>) {}
  assertAccepted(invoice: Invoice, hash: string, sats: number, refundHeight: number, safetyBlocks: number) {
    if (invoice.state !== 'ACCEPTED' || Buffer.from(invoice.r_hash, 'base64').toString('hex') !== hash ||
      Number(invoice.value) !== sats || Number(invoice.amt_paid_sat) !== sats) throw new Error('Invoice is not fully accepted for this swap');
    const held = invoice.htlcs?.filter(h => h.state === 'ACCEPTED') ?? [];
    if (!held.length || held.some(h => h.expiration_height < refundHeight + safetyBlocks) || held.reduce((n, h) => n + BigInt(h.amt_msat), 0n) !== BigInt(sats) * 1000n) throw new Error('Unsafe incoming HTLC deadline or amount');
  }
  async settleVerified(hash: string, preimage: string): Promise<boolean> {
    if (sha256(hex32(preimage)).toString('hex') !== hash) throw new Error('Preimage mismatch');
    const before = await this.lnd.lookup(hash);
    if (before.state !== 'SETTLED') {
      if (before.state !== 'ACCEPTED') throw new Error('Invoice no longer settleable');
      await this.lnd.settle(preimage);
    }
    // An RPC acknowledgement is not settlement evidence.
    return (await this.lnd.lookup(hash)).state === 'SETTLED';
  }
}

import { hex32, sha256 } from '../bitcoin/HtlcBuilder.js';
import type { Invoice, LndClient } from './LndClient.js';

export class HoldInvoiceManager {
  constructor(private lnd: Pick<LndClient, 'lookup' | 'settle' | 'cancel'>) {}
  private assertIdentity(invoice: Invoice, hash: string, sats?: number, requirePaid = true) {
    if (invoice.r_hash !== hex32(hash).toString('base64')) throw new Error('Invoice payment hash mismatch');
    if (sats !== undefined && (!Number.isSafeInteger(sats) || sats < 1 ||
      this.integer(invoice.value) !== BigInt(sats) || (requirePaid && this.integer(invoice.amt_paid_sat) !== BigInt(sats)))) {
      throw new Error('Invoice amount mismatch');
    }
  }
  assertSettled(invoice: Invoice, hash: string, sats: number) {
    this.assertIdentity(invoice, hash, sats);
    if (invoice.state !== 'SETTLED') throw new Error('Invoice settlement not observed');
  }
  assertCanceled(invoice: Invoice, hash: string, sats: number) {
    this.assertIdentity(invoice, hash, sats, false);
    if (invoice.state !== 'CANCELED') throw new Error('Invoice cancellation not observed');
  }
  private integer(value: string): bigint {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid invoice integer');
    return BigInt(value);
  }
  private assertHeldAmount(invoice: Invoice, sats: number) {
    const paid = this.integer(invoice.amt_paid_sat);
    const held = invoice.htlcs?.filter(h => h.state === 'ACCEPTED') ?? [];
    if ((paid !== 0n && paid !== BigInt(sats)) || !held.length || held.some(h => this.integer(h.amt_msat) <= 0n) ||
      held.reduce((sum, h) => sum + this.integer(h.amt_msat), 0n) !== BigInt(sats) * 1000n) throw new Error('Accepted HTLC amount mismatch');
  }
  assertAccepted(invoice: Invoice, hash: string, sats: number, refundHeight: number, safetyBlocks: number) {
    if (invoice.state !== 'ACCEPTED') throw new Error('Invoice is not fully accepted for this swap');
    this.assertIdentity(invoice, hash, sats, false);
    this.assertHeldAmount(invoice, sats);
    if (!Number.isSafeInteger(refundHeight) || refundHeight < 1 || !Number.isSafeInteger(safetyBlocks) || safetyBlocks < 1 ||
      !Number.isSafeInteger(refundHeight + safetyBlocks)) throw new Error('Unsafe incoming HTLC deadline or amount');
    const held = invoice.htlcs?.filter(h => h.state === 'ACCEPTED') ?? [];
    if (!held.length || held.some(h => !Number.isSafeInteger(h.expiration_height) || h.expiration_height < refundHeight + safetyBlocks || this.integer(h.amt_msat) <= 0n) ||
      held.reduce((n, h) => n + this.integer(h.amt_msat), 0n) !== BigInt(sats) * 1000n) throw new Error('Unsafe incoming HTLC deadline or amount');
  }
  async settleVerified(hash: string, preimage: string, sats?: number): Promise<boolean> {
    if (sha256(hex32(preimage)).toString('hex') !== hash) throw new Error('Preimage mismatch');
    const before = await this.lnd.lookup(hash);
    this.assertIdentity(before, hash, sats, before.state === 'SETTLED');
    if (before.state !== 'SETTLED') {
      if (before.state !== 'ACCEPTED') throw new Error('Invoice no longer settleable');
      if (sats !== undefined) this.assertHeldAmount(before, sats);
      await this.lnd.settle(preimage);
    }
    // An RPC acknowledgement is not settlement evidence.
    const after = await this.lnd.lookup(hash);
    this.assertIdentity(after, hash, sats, after.state === 'SETTLED');
    return after.state === 'SETTLED';
  }
}

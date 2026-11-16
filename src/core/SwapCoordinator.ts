import { transition } from './SwapStateMachine.js';
import { terminal, type Swap, type SwapState } from './SwapTypes.js';
import type { Store } from '../persistence/Store.js';
import type { Invoice } from '../lightning/LndClient.js';
import { HoldInvoiceManager } from '../lightning/HoldInvoiceManager.js';
import { verifyHtlcSpend } from '../bitcoin/SpendEvidence.js';
import { buildHtlc } from '../bitcoin/HtlcBuilder.js';
import { Transaction } from 'bitcoinjs-lib';

/** Adapters must independently verify consensus evidence. Never expose these events over HTTP. */
export interface SwapPorts {
  assertRegtest(): Promise<void>;
  invoice(hash: string): Promise<Invoice>;
  createInvoice(swap: Swap): Promise<string>;
  prepareLockup(swap: Swap): Promise<NonNullable<Swap['lockup']>>;
  broadcast(hex: string): Promise<string>;
  settle(preimage: string): Promise<unknown>;
  cancel(hash: string): Promise<unknown>;
  tip(): Promise<number>;
  confirmed(txid: string): Promise<{ hex: string; confirmations: number }>;
}

export class SwapCoordinator {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private ports: SwapPorts) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result;
  }
  private get(id: string): Swap {
    const swap = this.store.read().swaps[id]; if (!swap) throw new Error('Swap missing'); return swap;
  }
  private update(id: string, fn: (swap: Swap) => void) {
    return this.store.transaction(db => { const swap = db.swaps[id]; if (!swap) throw new Error('Swap missing'); fn(swap); return swap; });
  }
  private move(id: string, state: SwapState) { return this.update(id, s => { transition(s, state); }); }
  async issueInvoice(id: string): Promise<Swap> {
    return this.exclusive(async () => {
      let swap = this.get(id);
      if (swap.state !== 'QUOTED') return swap;
      if (swap.pendingAction) return this.move(id, 'MANUAL_REVIEW');
      await this.update(id, s => { s.pendingAction = 'CREATE_INVOICE'; });
      // Unknown remote outcome leaves a durable intent; never create a second invoice blindly.
      await this.ports.assertRegtest();
      const invoice = await this.ports.createInvoice(swap);
      return this.update(id, s => { s.invoice = invoice; delete s.pendingAction; transition(s, 'INVOICE_CREATED'); });
    });
  }
  async fundAccepted(id: string): Promise<Swap> {
    return this.exclusive(async () => {
      let swap = this.get(id);
      if (!['INVOICE_CREATED', 'INVOICE_ACCEPTED'].includes(swap.state)) return swap;
      if (swap.pendingAction) return this.move(id, 'MANUAL_REVIEW');
      const invoice = await this.ports.invoice(swap.contract.paymentHash);
      new HoldInvoiceManager({ lookup: this.ports.invoice, settle: this.ports.settle, cancel: this.ports.cancel })
        .assertAccepted(invoice, swap.contract.paymentHash, swap.quote.invoiceSats, swap.contract.timeoutHeight, 40);
      if (await this.ports.tip() > swap.contract.timeoutHeight - 10) throw new Error('Insufficient on-chain claim window');
      await this.move(id, 'INVOICE_ACCEPTED');
      await this.update(id, s => { s.pendingAction = 'PREPARE_LOCKUP'; });
      await this.ports.assertRegtest();
      const lockup = await this.ports.prepareLockup(swap);
      const funding = Transaction.fromHex(lockup.hex);
      const output = funding.outs[lockup.vout];
      if (funding.getId() !== lockup.txid || !Number.isInteger(lockup.vout) || lockup.vout < 0 || !output ||
        output.value !== BigInt(swap.quote.amountSats) || !Buffer.from(output.script).equals(buildHtlc(swap.contract).output)) {
        return this.move(id, 'MANUAL_REVIEW');
      }
      swap = await this.update(id, s => { s.lockup = lockup; s.pendingAction = 'BROADCAST_LOCKUP'; });
      // Funding might be slow: recheck both deadlines immediately before broadcast.
      new HoldInvoiceManager({ lookup: this.ports.invoice, settle: this.ports.settle, cancel: this.ports.cancel })
        .assertAccepted(await this.ports.invoice(swap.contract.paymentHash), swap.contract.paymentHash, swap.quote.invoiceSats, swap.contract.timeoutHeight, 40);
      if (await this.ports.tip() > swap.contract.timeoutHeight - 10) return this.move(id, 'MANUAL_REVIEW');
      await this.ports.assertRegtest();
      const txid = await this.ports.broadcast(lockup.hex);
      if (txid !== lockup.txid) return this.move(id, 'MANUAL_REVIEW');
      return this.update(id, s => { delete s.pendingAction; transition(s, 'LOCKUP_BROADCAST'); });
    });
  }
  async confirmLockup(id: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (swap.state !== 'LOCKUP_BROADCAST' || !swap.lockup) return swap;
      const tx = await this.ports.confirmed(swap.lockup.txid);
      if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < 1) return swap;
      if (tx.hex !== swap.lockup.hex) return this.move(id, 'MANUAL_REVIEW');
      return this.move(id, 'LOCKUP_CONFIRMED');
    });
  }
  async observeClaim(id: string, txid: string) {
    return this.exclusive(async () => {
      let swap = this.get(id);
      if (!['LOCKUP_CONFIRMED', 'REFUND_PENDING', 'CLAIM_DETECTED'].includes(swap.state) || !swap.lockup) return swap;
      if (swap.claimTxid && swap.claimTxid !== txid) return this.move(id, 'MANUAL_REVIEW');
      const tx = await this.ports.confirmed(txid);
      if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < 1) return swap;
      const evidence = verifyHtlcSpend(tx.hex, txid, swap.lockup.hex, swap.lockup.vout, swap.contract);
      if (evidence.kind !== 'claim') throw new Error('Not a verified claim');
      swap = await this.update(id, s => { s.claimTxid = txid; s.pendingAction = 'SETTLE'; transition(s, 'CLAIM_DETECTED'); });
      const manager = new HoldInvoiceManager({ lookup: h => this.ports.invoice(h), settle: async p => {
        // Revalidate consensus immediately before revealing the secret to LND.
        const current = await this.ports.confirmed(txid);
        if (!Number.isSafeInteger(current.confirmations) || current.confirmations < 1) throw new Error('Claim confirmation lost');
        const checked = verifyHtlcSpend(current.hex, txid, swap.lockup!.hex, swap.lockup!.vout, swap.contract);
        if (checked.kind !== 'claim' || checked.preimage !== p) throw new Error('Claim evidence changed');
        await this.ports.assertRegtest();
        return this.ports.settle(p);
      }, cancel: h => this.ports.cancel(h) });
      if (!(await manager.settleVerified(swap.contract.paymentHash, evidence.preimage, swap.quote.invoiceSats))) return swap;
      return this.update(id, s => { delete s.pendingAction; transition(s, 'LIGHTNING_SETTLED'); });
    });
  }
  async complete(id: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (swap.state !== 'LIGHTNING_SETTLED' || !swap.claimTxid) return swap;
      const tx = await this.ports.confirmed(swap.claimTxid);
      if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < 1 || !swap.lockup) return this.move(id, 'MANUAL_REVIEW');
      if (verifyHtlcSpend(tx.hex, swap.claimTxid, swap.lockup.hex, swap.lockup.vout, swap.contract).kind !== 'claim') return this.move(id, 'MANUAL_REVIEW');
      // This path only verifies a lookup; it never initiates settlement.
      const observed = new HoldInvoiceManager({ lookup: h => this.ports.invoice(h), settle: p => this.ports.settle(p), cancel: h => this.ports.cancel(h) });
      const invoice = await this.ports.invoice(swap.contract.paymentHash);
      try { observed.assertSettled(invoice, swap.contract.paymentHash, swap.quote.invoiceSats); }
      catch { return this.move(id, 'MANUAL_REVIEW'); }
      const final = await this.ports.confirmed(swap.claimTxid);
      if (!Number.isSafeInteger(final.confirmations) || final.confirmations < 1 || final.hex !== tx.hex) return this.move(id, 'MANUAL_REVIEW');
      return this.move(id, 'COMPLETED');
    });
  }
  async expireUnfunded(id: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (!['QUOTED', 'INVOICE_CREATED', 'INVOICE_ACCEPTED'].includes(swap.state) || swap.lockup || swap.pendingAction) throw new Error('Cannot expire a funded or uncertain swap');
      if (Date.now() < swap.quote.expiresAt) throw new Error('Swap not expired');
      if (swap.state !== 'QUOTED') {
        await this.update(id, s => { s.pendingAction = 'CANCEL_INVOICE'; });
        await this.ports.assertRegtest();
        await this.ports.cancel(swap.contract.paymentHash);
        new HoldInvoiceManager({ lookup: h => this.ports.invoice(h), settle: p => this.ports.settle(p), cancel: h => this.ports.cancel(h) })
          .assertCanceled(await this.ports.invoice(swap.contract.paymentHash), swap.contract.paymentHash, swap.quote.invoiceSats);
        await this.update(id, s => { delete s.pendingAction; });
      }
      return this.move(id, 'EXPIRED');
    });
  }
  async markRefundPending(id: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (!['LOCKUP_BROADCAST', 'LOCKUP_CONFIRMED', 'REFUND_PENDING'].includes(swap.state)) return swap;
      if (await this.ports.tip() < swap.contract.timeoutHeight) throw new Error('Refund not available');
      return this.move(id, 'REFUND_PENDING');
    });
  }
  /** Observe a confirmed refund, reconcile cancellation, and recheck chain evidence. */
  async observeRefund(id: string, txid: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (!['LOCKUP_BROADCAST', 'LOCKUP_CONFIRMED', 'REFUND_PENDING'].includes(swap.state) || !swap.lockup) return swap;
      if (swap.pendingAction || (swap.refundTxid && swap.refundTxid !== txid)) return this.move(id, 'MANUAL_REVIEW');
      const verify = async () => {
        const tx = await this.ports.confirmed(txid);
        if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < 1 ||
          verifyHtlcSpend(tx.hex, txid, swap.lockup!.hex, swap.lockup!.vout, swap.contract).kind !== 'refund') throw new Error('Refund not confirmed and verified');
      };
      await verify();
      await this.update(id, s => { s.refundTxid = txid; transition(s, 'REFUND_PENDING'); });
      const invoice = await this.ports.invoice(swap.contract.paymentHash);
      if (invoice.r_hash !== Buffer.from(swap.contract.paymentHash, 'hex').toString('base64') || invoice.state === 'SETTLED') return this.move(id, 'MANUAL_REVIEW');
      if (invoice.state !== 'CANCELED') {
        if (!['OPEN', 'ACCEPTED'].includes(invoice.state)) return this.move(id, 'MANUAL_REVIEW');
        await this.update(id, s => { s.pendingAction = 'CANCEL_INVOICE'; });
        await this.ports.assertRegtest();
        await this.ports.cancel(swap.contract.paymentHash);
      }
      const after = await this.ports.invoice(swap.contract.paymentHash);
      try { new HoldInvoiceManager({ lookup: h => this.ports.invoice(h), settle: p => this.ports.settle(p), cancel: h => this.ports.cancel(h) })
        .assertCanceled(after, swap.contract.paymentHash, swap.quote.invoiceSats); }
      catch { return this.move(id, 'MANUAL_REVIEW'); }
      try { await verify(); } catch { return this.move(id, 'MANUAL_REVIEW'); }
      return this.update(id, s => { delete s.pendingAction; transition(s, 'REFUNDED'); });
    });
  }
  /** Periodic/restart audit only. Missing evidence retains funds for manual review. */
  async auditEvidence(id: string) {
    return this.exclusive(async () => {
      const swap = this.get(id);
      if (!swap.lockup || ['FAILED', 'EXPIRED', 'MANUAL_REVIEW'].includes(swap.state)) return swap;
      try {
        const funding = await this.ports.confirmed(swap.lockup.txid);
        if (!Number.isSafeInteger(funding.confirmations) || funding.confirmations < 1 || funding.hex !== swap.lockup.hex) throw new Error('Funding evidence lost');
        for (const [txid, kind] of [[swap.claimTxid, 'claim'], [swap.refundTxid, 'refund']] as const) {
          if (!txid) continue;
          const tx = await this.ports.confirmed(txid);
          if (!Number.isSafeInteger(tx.confirmations) || tx.confirmations < 1 || verifyHtlcSpend(tx.hex, txid, swap.lockup.hex, swap.lockup.vout, swap.contract).kind !== kind) throw new Error('Spend evidence lost');
        }
        const invoice = await this.ports.invoice(swap.contract.paymentHash);
        if (invoice.r_hash !== Buffer.from(swap.contract.paymentHash, 'hex').toString('base64') ||
          (swap.state === 'COMPLETED' && invoice.state !== 'SETTLED') || (swap.state === 'REFUNDED' && invoice.state !== 'CANCELED')) throw new Error('Invoice evidence changed');
        const observed = new HoldInvoiceManager({ lookup: h => this.ports.invoice(h), settle: p => this.ports.settle(p), cancel: h => this.ports.cancel(h) });
        if (swap.state === 'COMPLETED') observed.assertSettled(invoice, swap.contract.paymentHash, swap.quote.invoiceSats);
        if (swap.state === 'REFUNDED') observed.assertCanceled(invoice, swap.contract.paymentHash, swap.quote.invoiceSats);
        return swap;
      } catch { return this.move(id, 'MANUAL_REVIEW'); }
    });
  }
  /** Safe fallback until remote action reconciliation and a reorg-aware observer are installed. */
  async recover(): Promise<void> {
    await this.store.transaction(db => {
      for (const swap of Object.values(db.swaps)) {
        if (terminal.has(swap.state)) continue;
        if (swap.pendingAction || ['LOCKUP_BROADCAST', 'LOCKUP_CONFIRMED', 'CLAIM_DETECTED', 'LIGHTNING_SETTLED', 'REFUND_PENDING'].includes(swap.state)) transition(swap, 'MANUAL_REVIEW');
      }
    });
  }
}

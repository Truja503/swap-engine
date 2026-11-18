import { Transaction, address, networks } from 'bitcoinjs-lib';
import type { Store } from '../persistence/Store.js';
import type { Swap } from './SwapTypes.js';
import { SwapCoordinator, type SwapPorts } from './SwapCoordinator.js';
import { transition } from './SwapStateMachine.js';
import { verifyHtlcSpend } from '../bitcoin/SpendEvidence.js';

export type PaymentEvidence = { hash: string; status: 'SUCCEEDED'; valueSats: number; feeSats: number };
export interface ReverseTestControls {
  claimDestination: string;
  startPayment(swap: Swap): Promise<{ result: Promise<PaymentEvidence>; stopClient(): void }>;
  waitAccepted(swap: Swap): Promise<void>;
  mineFor(txid: string): Promise<void>;
  signClaim(swap: Swap): Promise<Transaction>;
  broadcastClaim(hex: string): Promise<string>;
  findClaim(swap: Swap): Promise<string>;
}

/** One approved happy-path run. Ambiguous/failed runs stop with durable context. */
export async function runControlledReverse(store: Store, ports: SwapPorts, controls: ReverseTestControls, id: string) {
  const initial = store.read().swaps[id];
  if (!initial || initial.state !== 'INVOICE_CREATED' || !initial.invoice || initial.pendingAction || initial.clientPayment || initial.lockup || initial.fundingIntent) {
    throw new Error('Run has existing/uncertain actions; reconcile instead of retrying payment or funding');
  }
  await ports.assertRegtest();
  // Refuse expired/canceled, already-held or substituted invoices before starting
  // a payer client or writing a payment intent. A prior invoice-create RPC is
  // not evidence that the invoice remains payable now.
  const invoice = await ports.invoice(initial.contract.paymentHash);
  if (invoice.state !== 'OPEN' || invoice.r_hash !== Buffer.from(initial.contract.paymentHash, 'hex').toString('base64') ||
    invoice.value !== String(initial.quote.invoiceSats) || invoice.amt_paid_sat !== '0' ||
    invoice.payment_request !== initial.invoice || invoice.htlcs?.some(h => h.state === 'ACCEPTED' || h.state === 'SETTLED')) {
    throw new Error('Invoice is not the exact unpaid open invoice; reconcile before payment');
  }
  const tip = await ports.tip();
  if (!Number.isSafeInteger(tip) || tip < 0 || tip > initial.contract.timeoutHeight - 10) throw new Error('Insufficient on-chain claim window before payment');
  await store.transaction(db => { db.swaps[id]!.clientPayment = { hash: initial.contract.paymentHash, status: 'INTENT', feeLimitSats: 100 }; });
  let payment: Awaited<ReturnType<ReverseTestControls['startPayment']>> | undefined;
  const coordinator = new SwapCoordinator(store, ports);
  try {
    payment = await controls.startPayment(initial);
    void payment.result.catch(() => {}); // Awaited later; do not leak raw payment/preimage responses.
    await controls.waitAccepted(initial);
    await store.transaction(db => { db.swaps[id]!.clientPayment!.status = 'IN_FLIGHT'; });
    const funded = await coordinator.fundAccepted(id);
    if (!funded.lockup || funded.state !== 'LOCKUP_BROADCAST') throw new Error('Funding outcome unverified');
    await controls.mineFor(funded.lockup.txid);
    const confirmed = await coordinator.confirmLockup(id);
    if (confirmed.state !== 'LOCKUP_CONFIRMED') throw new Error('Funding confirmation unverified');
    const claim = await controls.signClaim(confirmed);
    const checked = verifyHtlcSpend(claim.toHex(), claim.getId(), confirmed.lockup!.hex, confirmed.lockup!.vout, confirmed.contract);
    if (checked.kind !== 'claim') throw new Error('Client claim verification failed');
    const expectedOutput = address.toOutputScript(controls.claimDestination, networks.regtest);
    if (claim.outs.length !== 1 || claim.outs[0]!.value !== BigInt(confirmed.quote.amountSats - confirmed.quote.claimFeeSats) ||
      !Buffer.from(claim.outs[0]!.script).equals(expectedOutput)) throw new Error('Claim differs from approved destination or fee');
    await store.transaction(db => { db.swaps[id]!.clientClaimIntent = { txid: claim.getId(), destination: controls.claimDestination, feeSats: confirmed.quote.claimFeeSats, status: 'INTENT' }; });
    const txid = await controls.broadcastClaim(claim.toHex());
    if (txid !== claim.getId()) throw new Error('Claim RPC identity mismatch');
    await store.transaction(db => { db.swaps[id]!.clientClaimIntent!.status = 'BROADCAST'; });
    await controls.mineFor(txid);
    if (await controls.findClaim(store.read().swaps[id]!) !== txid) throw new Error('Observed spend is not the client claim');
    await coordinator.observeClaim(id, txid);
    if (store.read().swaps[id]!.state !== 'LIGHTNING_SETTLED') throw new Error('Provider settlement not observed');
    const paid = await payment.result;
    if (paid.status !== 'SUCCEEDED' || paid.hash !== initial.contract.paymentHash || paid.valueSats !== initial.quote.invoiceSats ||
      !Number.isSafeInteger(paid.feeSats) || paid.feeSats < 0 || paid.feeSats > 100) throw new Error('Payer completion evidence invalid');
    await store.transaction(db => { const p = db.swaps[id]!.clientPayment!; p.status = 'SUCCEEDED'; p.feeSats = paid.feeSats; });
    const complete = await coordinator.complete(id);
    if (complete.state !== 'COMPLETED') throw new Error('Final confirmation/settlement evidence missing');
    return complete;
  } catch (error) {
    payment?.stopClient();
    await store.transaction(db => {
      const swap = db.swaps[id]!;
      if (swap.clientPayment && swap.clientPayment.status !== 'SUCCEEDED') swap.clientPayment.status = 'UNKNOWN';
      if (swap.clientClaimIntent?.status === 'INTENT') swap.clientClaimIntent.status = 'UNKNOWN';
      if (!['FAILED', 'EXPIRED'].includes(swap.state)) transition(swap, 'MANUAL_REVIEW');
    });
    throw error;
  }
}

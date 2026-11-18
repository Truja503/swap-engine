import { z } from 'zod';
import type { SwapPorts } from './SwapCoordinator.js';
import type { Swap } from './SwapTypes.js';
import type { BitcoinRpcClient } from '../bitcoin/BitcoinRpcClient.js';
import type { LndClient } from '../lightning/LndClient.js';
import { verifyDecodedHoldInvoice } from '../lightning/InvoiceVerification.js';
import { verifyReverseTestPlan, type ReverseTestPlan } from './ReverseTestPlan.js';

/** Controlled invoice-only test capability. All money-moving methods are denied. */
export function invoiceOnlyPorts(bitcoin: Pick<BitcoinRpcClient, 'call' | 'confirmed'>,
  provider: Pick<LndClient, 'assertRegtest' | 'call' | 'addHoldInvoice' | 'lookup'>,
  payer: Pick<LndClient, 'assertRegtest' | 'call'>, approved: ReverseTestPlan): SwapPorts {
  const plan = verifyReverseTestPlan(approved);
  const blocked = async (): Promise<never> => { throw new Error('Invoice-only test: funding/payment/settlement/cancellation disabled'); };
  const tip = async () => z.object({ chain: z.literal('regtest'), blocks: z.number().int().nonnegative(), initialblockdownload: z.literal(false) })
    .parse(await bitcoin.call('getblockchaininfo'));
  const assertRegtest = async () => {
    const [core] = await Promise.all([tip(), provider.assertRegtest(), payer.assertRegtest()]);
    const schema = z.object({ identity_pubkey: z.string(), wallet_synced: z.literal(true) });
    const p = schema.parse(await provider.call('/v1/getinfo')); const a = schema.parse(await payer.call('/v1/getinfo'));
    if (p.identity_pubkey !== plan.providerNode || a.identity_pubkey !== plan.payerNode ||
      plan.contract.timeoutHeight < core.blocks + 20 || plan.contract.timeoutHeight > core.blocks + 40) throw new Error('Invoice-only readiness or identity changed');
  };
  return { assertRegtest, tip: async () => (await tip()).blocks,
    invoice: hash => provider.lookup(hash), confirmed: id => bitcoin.confirmed(id),
    prepareLockup: blocked, broadcast: blocked, settle: blocked, cancel: blocked,
    createInvoice: async (swap: Swap) => {
      for (const key of ['paymentHash', 'claimPublicKey', 'refundPublicKey', 'timeoutHeight'] as const) {
        if (swap.contract[key] !== plan.contract[key]) throw new Error('Swap contract differs from approved plan');
      }
      for (const key of ['amountSats', 'invoiceSats', 'serviceFeeSats', 'claimFeeSats', 'fundingReserveSats'] as const) {
        if (swap.quote[key] !== plan.quote[key]) throw new Error('Swap quote differs from approved plan');
      }
      // Coordinator has already persisted CREATE_INVOICE; never retry this POST after an unknown outcome.
      await assertRegtest();
      const invoice = await provider.addHoldInvoice(swap.contract.paymentHash, swap.quote.invoiceSats, plan.invoiceExpirySeconds, plan.invoiceCltvDelta);
      if (!/^lnbcrt[0-9a-z]{20,4096}$/.test(invoice.payment_request)) throw new Error('Invoice network or encoding invalid');
      const decoded = await payer.call(`/v1/payreq/${invoice.payment_request}`);
      verifyDecodedHoldInvoice(invoice.payment_request, decoded, { paymentHash: swap.contract.paymentHash,
        payeePublicKey: plan.providerNode, invoiceSats: swap.quote.invoiceSats, minFinalCltv: plan.invoiceCltvDelta });
      const observed = await provider.lookup(swap.contract.paymentHash);
      if (observed.state !== 'OPEN' || observed.r_hash !== Buffer.from(swap.contract.paymentHash, 'hex').toString('base64') ||
        observed.value !== String(swap.quote.invoiceSats) || observed.amt_paid_sat !== '0' || observed.payment_request !== invoice.payment_request) throw new Error('Unpaid hold invoice not independently observed');
      return invoice.payment_request;
    },
  };
}

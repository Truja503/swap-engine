import { address, networks } from 'bitcoinjs-lib';
import { z } from 'zod';
import type { Quote } from './SwapTypes.js';
import { buildHtlc, type Contract } from '../bitcoin/HtlcBuilder.js';
import { validateQuoteFields } from '../utils/satoshiMath.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pubkey = z.string().regex(/^(02|03)[a-f0-9]{64}$/);
const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const reverseTestPlanSchema = z.object({ network: z.literal('regtest'), wallet: z.literal('lqwd-lab'),
  createdAt: amount, tipHeight: z.number().int().min(1).max(499_999_969),
  providerNode: pubkey, payerNode: pubkey, claimDestination: z.string(), refundDestination: z.string(),
  contract: z.object({ paymentHash: hash, claimPublicKey: pubkey, refundPublicKey: pubkey, timeoutHeight: amount }).strict(),
  address: z.string(), witnessScript: z.string().regex(/^[a-f0-9]+$/),
  quote: z.object({ id: z.uuid(), amountSats: amount, serviceFeeSats: amount, invoiceSats: amount,
    fundingReserveSats: amount, claimFeeSats: amount, expiresAt: amount }).strict(),
  invoiceExpirySeconds: z.literal(3600), invoiceCltvDelta: z.literal(80),
  routingFeeLimitSats: z.literal(100), fundingFeeLimitSats: z.literal(1000),
  executionApproved: z.literal(false),
}).strict();
export type ReverseTestPlan = z.infer<typeof reverseTestPlanSchema>;

export function verifyReverseTestPlan(value: unknown): ReverseTestPlan {
  const plan = reverseTestPlanSchema.parse(value);
  validateQuoteFields(plan.quote);
  if (plan.quote.amountSats !== 50000 || plan.quote.invoiceSats !== 50750 || plan.quote.claimFeeSats !== 500 ||
    plan.quote.fundingReserveSats !== plan.fundingFeeLimitSats || plan.contract.timeoutHeight !== plan.tipHeight + 30 ||
    plan.providerNode === plan.payerNode) throw new Error('Reverse plan differs from test contract');
  const contract = buildHtlc(plan.contract);
  if (contract.address !== plan.address || contract.witnessScript.toString('hex') !== plan.witnessScript) throw new Error('Reverse contract reconstruction failed');
  address.toOutputScript(plan.claimDestination, networks.regtest);
  address.toOutputScript(plan.refundDestination, networks.regtest);
  if (!plan.claimDestination.startsWith('bcrt1') || !plan.refundDestination.startsWith('bcrt1')) throw new Error('Only regtest witness destinations supported');
  return plan;
}

export function createReverseTestPlan(quote: Quote, tipHeight: number, client: { paymentHash: string; claimPublicKey: string },
  refundPublicKey: string, destinations: { claim: string; refund: string }, nodes: { provider: string; payer: string }): ReverseTestPlan {
  const contract: Contract = { ...client, refundPublicKey, timeoutHeight: tipHeight + 30 };
  const htlc = buildHtlc(contract);
  return verifyReverseTestPlan({ network: 'regtest', wallet: 'lqwd-lab', createdAt: Date.now(), tipHeight,
    providerNode: nodes.provider, payerNode: nodes.payer, claimDestination: destinations.claim, refundDestination: destinations.refund,
    contract, address: htlc.address, witnessScript: htlc.witnessScript.toString('hex'), quote,
    invoiceExpirySeconds: 3600, invoiceCltvDelta: 80, routingFeeLimitSats: 100, fundingFeeLimitSats: 1000, executionApproved: false });
}

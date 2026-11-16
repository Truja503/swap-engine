import { z } from 'zod';
import { states } from '../core/SwapTypes.js';

export const QuoteRequest = z.object({ amountSats: z.number().int().min(10_000).max(1_000_000) }).strict();
export const QuoteResponse = z.object({ id: z.uuid(), amountSats: z.number().int(), serviceFeeSats: z.number().int(), invoiceSats: z.number().int(), fundingReserveSats: z.number().int(), claimFeeSats: z.number().int(), expiresAt: z.number().int() }).strict();
export const ReverseRequest = z.object({ quoteId: z.uuid(), paymentHash: z.string().regex(/^[0-9a-f]{64}$/), claimPublicKey: z.string().regex(/^(02|03)[0-9a-f]{64}$/) }).strict();
export const SwapResponse = z.object({ id: z.uuid(), state: z.enum(states), display: z.object({ label: z.string(), tone: z.enum(['neutral', 'pending', 'success', 'warning', 'error']), terminal: z.boolean() }), quote: QuoteResponse, paymentHash: z.string(), claimPublicKey: z.string(), refundPublicKey: z.string(), timeoutHeight: z.number().int(), address: z.string(), witnessScript: z.string(), invoice: z.string().optional(), lockupTxid: z.string().optional(), lockupVout: z.number().int().optional(), claimTxid: z.string().optional(), refundTxid: z.string().optional() }).strict();
export const ErrorResponse = z.object({ error: z.string() }).strict();
export const HealthResponse = z.object({ status: z.literal('components-only'), liveSwapsEnabled: z.literal(false), network: z.literal('regtest') }).strict();
export const LiquidityResponse = z.object({ onchainSats: z.number().int().nonnegative(), incomingSats: z.number().int().nonnegative() }).strict();

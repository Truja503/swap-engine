import type { Contract } from '../bitcoin/HtlcBuilder.js';

export const states = ['CREATED', 'QUOTED', 'INVOICE_CREATED', 'INVOICE_ACCEPTED', 'LOCKUP_BROADCAST', 'LOCKUP_CONFIRMED', 'CLAIM_DETECTED', 'LIGHTNING_SETTLED', 'COMPLETED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED', 'FAILED', 'MANUAL_REVIEW'] as const;
export type SwapState = typeof states[number];
export const terminal = new Set<SwapState>(['COMPLETED', 'EXPIRED', 'REFUNDED', 'FAILED']);
export type Quote = { id: string; amountSats: number; serviceFeeSats: number; invoiceSats: number; fundingReserveSats: number; claimFeeSats: number; expiresAt: number };
export type Swap = {
  id: string; idempotencyKey: string; fingerprint: string; quote: Quote; contract: Contract;
  state: SwapState; revision: number; createdAt: number; updatedAt: number;
  invoice?: string; lockup?: { txid: string; hex: string; vout: number };
  claimTxid?: string; refundTxid?: string;
  pendingAction?: 'CREATE_INVOICE' | 'PREPARE_LOCKUP' | 'BROADCAST_LOCKUP' | 'SETTLE' | 'BROADCAST_REFUND';
  history: Array<{ state: SwapState; at: number }>;
};
export type Database = { schema: 1; quotes: Record<string, Quote>; swaps: Record<string, Swap> };

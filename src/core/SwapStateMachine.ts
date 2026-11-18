import { terminal, type Swap, type SwapState } from './SwapTypes.js';

const allowed: Record<SwapState, SwapState[]> = {
  CREATED: ['QUOTED', 'FAILED'], QUOTED: ['INVOICE_CREATED', 'EXPIRED', 'FAILED'],
  INVOICE_CREATED: ['INVOICE_ACCEPTED', 'EXPIRED', 'FAILED'],
  INVOICE_ACCEPTED: ['LOCKUP_BROADCAST', 'EXPIRED', 'FAILED'],
  LOCKUP_BROADCAST: ['LOCKUP_CONFIRMED', 'REFUND_PENDING'],
  LOCKUP_CONFIRMED: ['CLAIM_DETECTED', 'REFUND_PENDING'],
  CLAIM_DETECTED: ['LIGHTNING_SETTLED'], LIGHTNING_SETTLED: ['COMPLETED'],
  REFUND_PENDING: ['REFUNDED', 'CLAIM_DETECTED'], MANUAL_REVIEW: [],
  COMPLETED: [], EXPIRED: [], REFUNDED: [], FAILED: [],
};
export function transition(swap: Swap, next: SwapState, now = Date.now()): boolean {
  if (swap.state === next) return false;
  if (['FAILED', 'EXPIRED'].includes(next) && (swap.lockup || swap.pendingAction)) throw new Error('Cannot release a funded or uncertain swap');
  const evidenceLost = ['COMPLETED', 'REFUNDED'].includes(swap.state) && next === 'MANUAL_REVIEW';
  if ((terminal.has(swap.state) && !evidenceLost) || (!allowed[swap.state].includes(next) && next !== 'MANUAL_REVIEW')) throw new Error(`Illegal transition ${swap.state} -> ${next}`);
  swap.state = next; swap.revision++; swap.updatedAt = now; swap.history.push({ state: next, at: now });
  return true;
}

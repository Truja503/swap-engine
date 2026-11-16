/**
 * Utility functions for swap status presentation
 */
export function describeSwapState(state: string): {label: string; tone: 'neutral'|'pending'|'success'|'warning'|'error'; terminal: boolean} {
  switch (state) {
    case 'CREATED':
      return { label: 'Swap created', tone: 'pending', terminal: false };
    case 'QUOTED':
      return { label: 'Quote generated', tone: 'pending', terminal: false };
    case 'INVOICE_CREATED':
      return { label: 'Invoice created', tone: 'pending', terminal: false };
    case 'INVOICE_ACCEPTED':
      return { label: 'Invoice accepted', tone: 'pending', terminal: false };
    case 'LOCKUP_BROADCAST':
      return { label: 'Lockup broadcast', tone: 'pending', terminal: false };
    case 'LOCKUP_CONFIRMED':
      return { label: 'Lockup confirmed', tone: 'pending', terminal: false };
    case 'CLAIM_DETECTED':
      return { label: 'Claim detected', tone: 'pending', terminal: false };
    case 'LIGHTNING_SETTLED':
      return { label: 'Lightning settled', tone: 'pending', terminal: false };
    case 'COMPLETED':
      return { label: 'Swap completed', tone: 'success', terminal: true };
    case 'EXPIRED':
      return { label: 'Swap expired', tone: 'error', terminal: true };
    case 'FAILED':
      return { label: 'Swap failed', tone: 'error', terminal: true };
    case 'REFUND_PENDING':
      return { label: 'Refund pending', tone: 'warning', terminal: false };
    case 'REFUNDED':
      return { label: 'Swap refunded', tone: 'warning', terminal: true };
    case 'MANUAL_REVIEW':
      return { label: 'Manual review', tone: 'warning', terminal: false };
    default:
      return { label: 'Unknown status', tone: 'neutral', terminal: false };
  }
}

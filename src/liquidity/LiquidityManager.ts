import { terminal, type Database } from '../core/SwapTypes.js';

export type Balances = { onchainSats: number; incomingSats: number };
export const RESERVE_SATS = 10_000;
export function available(db: Database, balances: Balances): Balances {
  let onchainSats = balances.onchainSats - RESERVE_SATS;
  let incomingSats = balances.incomingSats;
  for (const swap of Object.values(db.swaps)) {
    if (terminal.has(swap.state)) continue;
    // Conservative double accounting after external UTXO/HTLC reservation is acceptable.
    onchainSats -= swap.quote.amountSats + swap.quote.fundingReserveSats;
    incomingSats -= swap.quote.invoiceSats;
  }
  return { onchainSats: Math.max(0, onchainSats), incomingSats: Math.max(0, incomingSats) };
}
export function assertLiquidity(db: Database, balances: Balances, amountSats: number, invoiceSats: number, fundingReserveSats: number) {
  if (![balances.onchainSats, balances.incomingSats].every(x => Number.isSafeInteger(x) && x >= 0)) throw new Error('Invalid liquidity snapshot');
  const free = available(db, balances);
  if (free.onchainSats < amountSats + fundingReserveSats) throw new Error('Insufficient on-chain liquidity');
  if (free.incomingSats < invoiceSats) throw new Error('Insufficient incoming Lightning liquidity');
}

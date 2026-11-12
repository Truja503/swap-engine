import { constructSpend, type Spend } from './ClaimManager.js';

export function createRefund(input: Spend, tipHeight: number) {
  // Bitcoin requires nLockTime < next block height, so broadcast at tip >= timeout.
  if (!Number.isSafeInteger(tipHeight) || tipHeight < input.contract.timeoutHeight) throw new Error('Refund timelock not reached');
  return constructSpend(input, 'refund');
}

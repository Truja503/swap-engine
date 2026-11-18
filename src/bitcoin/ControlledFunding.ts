import { Transaction, Psbt, address, networks } from 'bitcoinjs-lib';
import { z } from 'zod';
import type { Store } from '../persistence/Store.js';
import type { Swap } from '../core/SwapTypes.js';
import { buildHtlc } from './HtlcBuilder.js';
import { BitcoinConfirmationLookup } from './BitcoinConfirmationLookup.js';
import { validateQuoteFields } from '../utils/satoshiMath.js';

interface Rpc { call<T>(method: string, params?: unknown[], wallet?: boolean): Promise<T> }
export type ApprovedFundingInput = { txid: string; vout: number };

export function verifyControlledFunding(raw: string, previousHex: string, swap: Swap, input: ApprovedFundingInput, changeAddress: string) {
  validateQuoteFields(swap.quote);
  const tx = Transaction.fromHex(raw); const previous = Transaction.fromHex(previousHex);
  const value = previous.outs[input.vout]?.value;
  const htlc = buildHtlc(swap.contract); const change = address.toOutputScript(changeAddress, networks.regtest);
  if (previous.getId() !== input.txid || value === undefined || !Number.isSafeInteger(input.vout) || input.vout < 0 || tx.ins.length !== 1 ||
    Buffer.from(tx.ins[0]!.hash).reverse().toString('hex') !== input.txid || tx.ins[0]!.index !== input.vout ||
    tx.outs.length < 1 || tx.outs.length > 2) throw new Error('Funding input differs from approved selection');
  const matches = tx.outs.map((out, vout) => ({ out, vout })).filter(({ out }) => out.value === BigInt(swap.quote.amountSats) && Buffer.from(out.script).equals(htlc.output));
  if (matches.length !== 1 || tx.outs.some((out, index) => index !== matches[0]!.vout && !Buffer.from(out.script).equals(change))) throw new Error('Funding outputs differ from approved contract');
  const fee = value - tx.outs.reduce((sum, out) => sum + out.value, 0n);
  if (fee < 1n || fee > BigInt(swap.quote.fundingReserveSats) || fee > 1000n) throw new Error('Funding fee exceeds approved reserve');
  return { txid: tx.getId(), hex: raw, vout: matches[0]!.vout, feeSats: Number(fee) };
}

/** One-shot preparation. Exact inputs are journaled before wallet locking or signing. */
export async function prepareControlledFunding(rpc: Rpc, store: Store, swap: Swap, input: ApprovedFundingInput,
  changeAddress: string, assertReady: () => Promise<void>) {
  validateQuoteFields(swap.quote);
  if (swap.fundingIntent || swap.lockup || store.read().swaps[swap.id]?.fundingIntent) throw new Error('Existing funding intent requires reconciliation, not another preparation');
  await assertReady();
  const verified = await new BitcoinConfirmationLookup(rpc).confirmed(input.txid);
  const previous = Transaction.fromHex(verified.hex); const prevout = previous.outs[input.vout];
  if (!prevout || prevout.script.length !== 22 || prevout.script[0] !== 0 || prevout.script[1] !== 20 ||
    prevout.value > BigInt(Number.MAX_SAFE_INTEGER) || prevout.value <= BigInt(swap.quote.amountSats)) throw new Error('Approved test input must be a safe native P2WPKH output');
  const unspent = z.object({ scriptPubKey: z.object({ hex: z.string() }) }).parse(await rpc.call('gettxout', [input.txid, input.vout, true]));
  if (unspent.scriptPubKey.hex !== Buffer.from(prevout.script).toString('hex')) throw new Error('Funding input unavailable');
  const available = z.array(z.object({ txid: z.string(), vout: z.number().int(), safe: z.boolean(), spendable: z.boolean() }))
    .parse(await rpc.call('listunspent', [1], true));
  if (!available.some(x => x.txid === input.txid && x.vout === input.vout && x.safe && x.spendable)) throw new Error('Funding input not owned and spendable');
  const locks = z.array(z.object({ txid: z.string(), vout: z.number() })).parse(await rpc.call('listlockunspent', [], true));
  if (locks.some(x => x.txid === input.txid && x.vout === input.vout)) throw new Error('Approved input already locked');
  z.object({ ismine: z.literal(true) }).parse(await rpc.call('getaddressinfo', [changeAddress], true));
  await store.transaction(db => {
    const current = db.swaps[swap.id];
    if (!current || current.pendingAction !== 'PREPARE_LOCKUP' || current.fundingIntent) throw new Error('Funding intent state changed');
    current.fundingIntent = { ...input, valueSats: Number(prevout.value), scriptPubKey: Buffer.from(prevout.script).toString('hex'),
      changeAddress, principalSats: swap.quote.amountSats, maxFeeSats: swap.quote.fundingReserveSats };
  });
  await assertReady();
  const htlc = buildHtlc(swap.contract);
  const funded = z.object({ psbt: z.string() }).parse(await rpc.call('walletcreatefundedpsbt', [[input],
    [{ [htlc.address]: (swap.quote.amountSats / 1e8).toFixed(8) }], 0,
    { add_inputs: false, lockUnspents: true, changeAddress, fee_rate: 2, replaceable: false }, true, 2, 0], true));
  const unsignedHex = Buffer.from(Psbt.fromBase64(funded.psbt).data.globalMap.unsignedTx.toBuffer()).toString('hex');
  const unsigned = verifyControlledFunding(unsignedHex, verified.hex, swap, input, changeAddress);
  await store.transaction(db => { db.swaps[swap.id]!.fundingIntent!.unsignedHex = unsignedHex; });
  await assertReady();
  const signed = z.object({ psbt: z.string() }).parse(await rpc.call('walletprocesspsbt', [funded.psbt], true));
  const finalized = z.object({ complete: z.literal(true), hex: z.string() }).parse(await rpc.call('finalizepsbt', [signed.psbt]));
  const result = verifyControlledFunding(finalized.hex, verified.hex, swap, input, changeAddress);
  if (result.txid !== unsigned.txid) throw new Error('Wallet altered approved unsigned transaction');
  await store.transaction(db => {
    Object.assign(db.swaps[swap.id]!.fundingIntent!, { signedHex: result.hex, fundingTxid: result.txid, fundingVout: result.vout, feeSats: result.feeSats });
  });
  return { txid: result.txid, hex: result.hex, vout: result.vout };
}

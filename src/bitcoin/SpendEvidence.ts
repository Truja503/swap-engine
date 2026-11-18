import { Transaction, script } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { buildHtlc, hex32, sha256, type Contract } from './HtlcBuilder.js';

export type SpendEvidence = { kind: 'claim'; txid: string; preimage: string }
  | { kind: 'refund'; txid: string };

/** Cryptographic verification supplements, never replaces, Core active-chain evidence. */
export function verifyHtlcSpend(raw: string, expectedTxid: string, fundingHex: string,
  vout: number, contract: Contract): SpendEvidence {
  hex32(expectedTxid);
  const funding = Transaction.fromHex(fundingHex);
  const tx = Transaction.fromHex(raw);
  const htlc = buildHtlc(contract);
  if (tx.getId() !== expectedTxid || !Number.isSafeInteger(vout) || vout < 0) throw new Error('Spend identity mismatch');
  const output = funding.outs[vout];
  if (!output || !Buffer.from(output.script).equals(htlc.output) || output.value <= 0n) throw new Error('Funding contract mismatch');
  const matches = tx.ins.map((input, index) => ({ input, index })).filter(({ input }) =>
    Buffer.from(input.hash).reverse().toString('hex') === funding.getId() && input.index === vout);
  if (matches.length !== 1) throw new Error('Spend must reference exact funding outpoint once');
  const { input, index } = matches[0]!;
  if (input.script.length !== 0) throw new Error('Native P2WSH requires empty scriptSig');
  const witness = input.witness;
  const claim = witness.length === 4;
  if (!claim && witness.length !== 3) throw new Error('Unexpected HTLC witness');
  const witnessScript = witness.at(-1)!;
  if (!Buffer.from(witnessScript).equals(htlc.witnessScript)) throw new Error('Witness script mismatch');
  const selector = witness[claim ? 2 : 1]!;
  if (!Buffer.from(selector).equals(claim ? Buffer.from([1]) : Buffer.alloc(0))) throw new Error('Noncanonical branch selector');
  let preimage: string | undefined;
  if (claim) {
    const secret = witness[1]!;
    if (secret.length !== 32 || sha256(secret).toString('hex') !== contract.paymentHash) throw new Error('Claim preimage mismatch');
    preimage = Buffer.from(secret).toString('hex');
  } else if (tx.locktime < contract.timeoutHeight || tx.locktime >= 500_000_000 || input.sequence === 0xffffffff) {
    throw new Error('Refund does not satisfy block-height CLTV');
  }
  const decoded = script.signature.decode(witness[0]!);
  if (decoded.hashType !== Transaction.SIGHASH_ALL) throw new Error('Expected SIGHASH_ALL');
  const digest = tx.hashForWitnessV0(index, htlc.witnessScript, output.value, decoded.hashType);
  const publicKey = Buffer.from(claim ? contract.claimPublicKey : contract.refundPublicKey, 'hex');
  if (!ecc.verify(digest, publicKey, decoded.signature)) throw new Error('Invalid HTLC signature');
  return claim ? { kind: 'claim', txid: expectedTxid, preimage: preimage! } : { kind: 'refund', txid: expectedTxid };
}

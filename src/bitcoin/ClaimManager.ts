import * as btc from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { buildHtlc, hex32, sha256, type Contract } from './HtlcBuilder.js';

const ECPair = ECPairFactory(ecc);
export type Spend = {
  contract: Contract; lockupTxHex: string; vout: number; destination: string;
  feeSats: number; privateKey: Uint8Array;
};

/** Validates the actual funding transaction rather than trusting caller-provided amount/script. */
export function constructSpend(input: Spend, branch: 'claim' | 'refund', preimage?: string): btc.Transaction {
  const contract = buildHtlc(input.contract);
  const funding = btc.Transaction.fromHex(input.lockupTxHex);
  if (!Number.isInteger(input.vout) || input.vout < 0) throw new Error('Invalid vout');
  const output = funding.outs[input.vout];
  if (!output || !Buffer.from(output.script).equals(contract.output)) throw new Error('Lockup script mismatch');
  if (!Number.isSafeInteger(input.feeSats) || input.feeSats < 1 || BigInt(input.feeSats) >= output.value - 546n) throw new Error('Invalid fee or dust output');
  const key = ECPair.fromPrivateKey(input.privateKey, { network: btc.networks.regtest });
  const expectedKey = branch === 'claim' ? input.contract.claimPublicKey : input.contract.refundPublicKey;
  if (Buffer.from(key.publicKey).toString('hex') !== expectedKey) throw new Error('Wrong signing key');
  let secret: Buffer | undefined;
  if (branch === 'claim') {
    secret = hex32(preimage ?? '');
    if (sha256(secret).toString('hex') !== input.contract.paymentHash) throw new Error('Preimage mismatch');
  }
  const tx = new btc.Transaction();
  tx.version = 2;
  tx.locktime = branch === 'refund' ? input.contract.timeoutHeight : 0;
  tx.addInput(funding.getHash(), input.vout, 0xfffffffe);
  tx.addOutput(btc.address.toOutputScript(input.destination, btc.networks.regtest), output.value - BigInt(input.feeSats));
  const digest = tx.hashForWitnessV0(0, contract.witnessScript, output.value, btc.Transaction.SIGHASH_ALL);
  const signature = btc.script.signature.encode(key.sign(digest), btc.Transaction.SIGHASH_ALL);
  tx.setWitness(0, branch === 'claim'
    ? [signature, secret!, Buffer.from([1]), contract.witnessScript]
    : [signature, Buffer.alloc(0), contract.witnessScript]);
  return tx;
}

export const createClaim = (input: Spend, preimage: string): btc.Transaction => constructSpend(input, 'claim', preimage);

/** Only call with a confirmed, consensus-accepted transaction. This is structural extraction, not a script interpreter. */
export function extractClaimPreimage(rawTx: string, lockupTxid: string, vout: number, contract: Contract): string | undefined {
  const tx = btc.Transaction.fromHex(rawTx);
  const witnessScript = buildHtlc(contract).witnessScript;
  for (const input of tx.ins) {
    if (Buffer.from(input.hash).reverse().toString('hex') !== lockupTxid || input.index !== vout) continue;
    const [signature, preimage, selector, script] = input.witness;
    if (input.witness.length !== 4 || !signature?.length || preimage?.length !== 32 ||
      !selector || !Buffer.from(selector).equals(Buffer.from([1])) || !script || !Buffer.from(script).equals(witnessScript)) return undefined;
    if (sha256(preimage).toString('hex') === contract.paymentHash) return Buffer.from(preimage).toString('hex');
  }
  return undefined;
}

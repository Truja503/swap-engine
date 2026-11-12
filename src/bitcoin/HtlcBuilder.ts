import { createHash } from 'node:crypto';
import * as btc from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

export const sha256 = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();
export const hex32 = (value: string): Buffer => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected lowercase 32-byte hex');
  return Buffer.from(value, 'hex');
};
export type Contract = { paymentHash: string; claimPublicKey: string; refundPublicKey: string; timeoutHeight: number };

/** Native P2WSH: user signature + 32-byte preimage OR provider signature after CLTV. */
export function buildHtlc(contract: Contract) {
  const hash = hex32(contract.paymentHash);
  for (const key of [contract.claimPublicKey, contract.refundPublicKey]) {
    if (!/^(02|03)[0-9a-f]{64}$/.test(key) || !ecc.isPoint(Buffer.from(key, 'hex'))) throw new Error('Invalid compressed public key');
  }
  if (contract.claimPublicKey === contract.refundPublicKey) throw new Error('Claim and refund keys must differ');
  if (!Number.isSafeInteger(contract.timeoutHeight) || contract.timeoutHeight < 1 || contract.timeoutHeight >= 500_000_000) throw new Error('Expected block-height timelock');
  const op = btc.opcodes;
  const witnessScript = Buffer.from(btc.script.compile([
    op.OP_IF, op.OP_SIZE, btc.script.number.encode(32), op.OP_EQUALVERIFY,
    op.OP_SHA256, hash, op.OP_EQUALVERIFY, Buffer.from(contract.claimPublicKey, 'hex'), op.OP_CHECKSIG,
    op.OP_ELSE, btc.script.number.encode(contract.timeoutHeight), op.OP_CHECKLOCKTIMEVERIFY,
    op.OP_DROP, Buffer.from(contract.refundPublicKey, 'hex'), op.OP_CHECKSIG, op.OP_ENDIF,
  ]));
  const payment = btc.payments.p2wsh({ redeem: { output: witnessScript }, network: btc.networks.regtest });
  if (!payment.address || !payment.output) throw new Error('P2WSH construction failed');
  return { ...contract, witnessScript, output: payment.output, address: payment.address };
}

export function verifyHtlc(contract: Contract, address: string, witnessScriptHex: string): boolean {
  const expected = buildHtlc(contract);
  return expected.address === address && expected.witnessScript.toString('hex') === witnessScriptHex;
}

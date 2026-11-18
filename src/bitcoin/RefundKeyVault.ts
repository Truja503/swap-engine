import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { SecretVault } from '../persistence/SecretVault.js';
import { createRefund } from './RefundManager.js';
import type { Spend } from './ClaimManager.js';

const keys = ECPairFactory(ecc);
/** Key id is the client's public payment hash; provider never receives its preimage. */
export class RefundKeyVault {
  constructor(private readonly vault: SecretVault) {}
  async create(paymentHash: string) {
    const key = keys.makeRandom(); const privateKey = Buffer.from(key.privateKey!);
    try {
      await this.vault.create('refund', paymentHash, privateKey);
      return { keyId: paymentHash, publicKey: Buffer.from(key.publicKey).toString('hex') };
    } finally { privateKey.fill(0); }
  }
  async publicKey(paymentHash: string) {
    const privateKey = await this.vault.read('refund', paymentHash);
    try {
      if (privateKey.length !== 32 || !ecc.isPrivate(privateKey)) throw new Error('Refund key record invalid');
      return Buffer.from(keys.fromPrivateKey(privateKey).publicKey).toString('hex');
    }
    finally { privateKey.fill(0); }
  }
  async signRefund(paymentHash: string, input: Omit<Spend, 'privateKey'>, tip: number) {
    if (input.contract.paymentHash !== paymentHash) throw new Error('Refund key identity mismatch');
    const privateKey = await this.vault.read('refund', paymentHash);
    try {
      if (privateKey.length !== 32 || !ecc.isPrivate(privateKey)) throw new Error('Refund key record invalid');
      return createRefund({ ...input, privateKey }, tip);
    }
    finally { privateKey.fill(0); }
  }
}

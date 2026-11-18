import { randomBytes } from 'node:crypto';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { createClaim, type Spend } from '../bitcoin/ClaimManager.js';
import { sha256 } from '../bitcoin/HtlcBuilder.js';
import { SecretVault } from '../persistence/SecretVault.js';
import { z } from 'zod';

const keys = ECPairFactory(ecc);

/** Client-process custody only. Never instantiate this in the provider HTTP service. */
export class ClaimWallet {
  #preimage: Buffer;
  #privateKey: Buffer;
  #destroyed = false;
  readonly paymentHash: string;
  readonly claimPublicKey: string;
  private constructor(material?: { privateKey: Buffer; preimage: Buffer }) {
    this.#preimage = material ? Buffer.from(material.preimage) : randomBytes(32);
    if (this.#preimage.length !== 32) throw new Error('Invalid client secret');
    const key = material ? keys.fromPrivateKey(material.privateKey) : keys.makeRandom();
    this.#privateKey = Buffer.from(key.privateKey!);
    this.paymentHash = sha256(this.#preimage).toString('hex');
    this.claimPublicKey = Buffer.from(key.publicKey).toString('hex');
  }
  static generate() { return new ClaimWallet(); }
  async backup(vault: SecretVault) {
    if (this.#destroyed) throw new Error('Client claim wallet destroyed');
    const material = Buffer.from(JSON.stringify({ privateKey: this.#privateKey.toString('hex'), preimage: this.#preimage.toString('hex') }));
    try { await vault.create('client', this.paymentHash, material); } finally { material.fill(0); }
  }
  static async restore(vault: SecretVault, paymentHash: string) {
    const material = await vault.read('client', paymentHash);
    let wallet: ClaimWallet | undefined;
    try {
      const record = z.object({ privateKey: z.string().regex(/^[a-f0-9]{64}$/), preimage: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(material.toString()));
      const key = Buffer.from(record.privateKey, 'hex'); const secret = Buffer.from(record.preimage, 'hex');
      try { wallet = new ClaimWallet({ privateKey: key, preimage: secret }); } finally { key.fill(0); secret.fill(0); }
      if (wallet.paymentHash !== paymentHash) throw new Error();
      return wallet;
    } catch { wallet?.destroy(); throw new Error('Client backup identity invalid'); }
    finally { material.fill(0); }
  }
  toJSON() { return { paymentHash: this.paymentHash, claimPublicKey: this.claimPublicKey }; }
  signClaim(input: Omit<Spend, 'privateKey'>) {
    if (this.#destroyed) throw new Error('Client claim wallet destroyed');
    if (input.contract.paymentHash !== this.paymentHash || input.contract.claimPublicKey !== this.claimPublicKey) throw new Error('Client contract identity mismatch');
    return createClaim({ ...input, privateKey: this.#privateKey }, this.#preimage.toString('hex'));
  }
  destroy() {
    this.#preimage.fill(0); this.#privateKey.fill(0); this.#destroyed = true;
  }
}

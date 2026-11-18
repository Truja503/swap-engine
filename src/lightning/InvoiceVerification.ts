import { z } from 'zod';

const integer = z.string().regex(/^(0|[1-9][0-9]{0,19})$/);
const decodedSchema = z.object({ destination: z.string(), payment_hash: z.string(), num_satoshis: integer,
  num_msat: integer, timestamp: integer, expiry: integer, cltv_expiry: integer });

/** Caller must obtain decoding from the independently configured payer regtest node. */
export function verifyDecodedHoldInvoice(paymentRequest: string, decoded: unknown,
  expected: { paymentHash: string; payeePublicKey: string; invoiceSats: number; minFinalCltv: number }, now = Date.now()) {
  const invoice = decodedSchema.parse(decoded);
  if (!/^lnbcrt[0-9a-z]{20,4096}$/.test(paymentRequest) || !Number.isSafeInteger(expected.invoiceSats) || expected.invoiceSats < 1 ||
    !Number.isSafeInteger(expected.minFinalCltv) || expected.minFinalCltv < 1 ||
    invoice.destination !== expected.payeePublicKey || invoice.payment_hash !== expected.paymentHash ||
    BigInt(invoice.num_satoshis) !== BigInt(expected.invoiceSats) || BigInt(invoice.num_msat) !== BigInt(expected.invoiceSats) * 1000n ||
    BigInt(invoice.cltv_expiry) < BigInt(expected.minFinalCltv)) throw new Error('Decoded invoice differs from approved contract');
  const timestamp = BigInt(invoice.timestamp); const expiry = BigInt(invoice.expiry); const current = BigInt(Math.floor(now / 1000));
  if (timestamp > current + 60n || expiry < 60n || expiry > 3600n || timestamp + expiry <= current + 60n) throw new Error('Invoice expiration unsafe');
}
